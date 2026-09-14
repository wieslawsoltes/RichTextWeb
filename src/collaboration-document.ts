import {
  EventDispatcher,
  FlowDocument,
  TextPointer,
  elementFromJSON,
  type DocumentNode,
} from "./model.js";
import { plainText } from "./engine-tree.js";
import type { RichTextEngine } from "./engine.js";
import {
  CollaborativeTextSession,
  CollaborationConflictError,
  type TextOperation,
  type VersionVector,
} from "./collaboration.js";

export type DocumentCollection = "Children" | "Columns";
export type RichDocumentAction =
  | {
      Kind: "Insert";
      Node: DocumentNode;
      ParentId: string;
      Collection: DocumentCollection;
      After: string | null;
    }
  | {
      Kind: "Move";
      NodeId: string;
      ParentId: string;
      Collection: DocumentCollection;
      After: string | null;
    }
  | { Kind: "Remove" | "Restore"; NodeIds: string[] }
  | {
      Kind: "Property";
      NodeId: string;
      Name: string;
      Value?: unknown;
      Remove?: boolean;
    }
  | {
      Kind: "Entry";
      NodeId: string;
      Name: "Annotations";
      EntryId: string;
      Value?: unknown;
      Remove?: boolean;
    }
  | { Kind: "Text"; NodeId: string; Operation: TextOperation };
export interface RichDocumentOperation {
  Protocol: 2;
  DocumentId: string;
  Epoch: string;
  InitialHash: string;
  ActorId: string;
  Sequence: number;
  Clock: number;
  Dependencies: VersionVector;
  Actions: RichDocumentAction[];
}
export interface DocumentCheckpoint {
  PreviousEpoch: string;
  Frontier: VersionVector;
  Acknowledgements: Record<string, VersionVector>;
}
export interface RichDocumentSnapshot {
  Protocol: 2;
  DocumentId: string;
  Epoch: string;
  InitialDocument: DocumentNode;
  Operations: RichDocumentOperation[];
  Checkpoint?: DocumentCheckpoint;
}
export interface CollaborativeDocumentOptions {
  DocumentId: string;
  ActorId: string;
  Document: FlowDocument | DocumentNode;
  MaxPendingOperations?: number;
  CompactionOperationThreshold?: number;
}
interface Stamp {
  ActorId: string;
  Sequence: number;
  Clock: number;
  Index: number;
}
interface Point {
  Sequence: number;
  Index: number;
}
interface ValueRegister {
  Stamp: Stamp;
  Value?: unknown;
  Removed: boolean;
  Created: Stamp;
}
interface NodeRecord {
  Id: string;
  Type: string;
  Created: Stamp;
  Properties: Map<string, ValueRegister>;
  Entries: Map<string, ValueRegister>;
  Removed: Map<string, Point>;
  Restored: Map<string, Point>;
  Text?: CollaborativeTextSession;
}
interface Placement {
  Id: string;
  NodeId: string;
  ParentId: string;
  Collection: DocumentCollection;
  After: string | null;
  Stamp: Stamp;
}
interface State {
  Nodes: Map<string, NodeRecord>;
  Placements: Map<string, Placement>;
}
const copy = <T>(value: T): T => structuredClone(value);
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const safeActor = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,80}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const whole = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const safeId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 300;
const compare = (a: Stamp, b: Stamp) =>
  a.Clock - b.Clock ||
  (a.ActorId < b.ActorId ? -1 : a.ActorId > b.ActorId ? 1 : 0) ||
  a.Sequence - b.Sequence ||
  a.Index - b.Index;
const pointCompare = (a: Point, b: Point) =>
  a.Sequence - b.Sequence || a.Index - b.Index;
const seedStamp: Stamp = { ActorId: "", Sequence: 0, Clock: 0, Index: 0 };
function hash(text: string): string {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return `${text.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 256)
    throw new CollaborationConflictError("JSON nesting limit exceeded.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (
    !value ||
    typeof value !== "object" ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new CollaborationConflictError(
      "Collaboration values must be finite JSON data.",
    );
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new CollaborationConflictError("Reserved JSON property name.");
    jsonValue(item, depth + 1);
  }
}
function normalizeDocument(
  document: FlowDocument | DocumentNode,
): DocumentNode {
  const root = copy(
    document instanceof FlowDocument ? document.ToJSON() : document,
  );
  jsonValue(root);
  const walk = (node: DocumentNode) => {
    if (node.type === "Run")
      node.text = (node.text ?? "").replace(/\r\n?/g, "\n");
    for (const child of node.children ?? []) walk(child);
    for (const column of node.props?.Columns ?? []) walk(column);
  };
  walk(root);
  return FlowDocument.FromJSON(root).ToJSON();
}
function removed(node: NodeRecord): boolean {
  return [...node.Removed].some(
    ([actor, point]) =>
      pointCompare(
        point,
        node.Restored.get(actor) ?? { Sequence: 0, Index: 0 },
      ) > 0,
  );
}
function compatible(
  parent: string,
  child: string,
  collection: DocumentCollection,
): boolean {
  if (collection === "Columns")
    return parent === "Table" && child === "TableColumn";
  const blocks = ["Paragraph", "Section", "List", "Table", "BlockUIContainer"];
  const inlines = [
    "Run",
    "Span",
    "Bold",
    "Italic",
    "Underline",
    "Hyperlink",
    "LineBreak",
    "Equation",
    "Image",
    "InlineUIContainer",
    "Figure",
    "Floater",
  ];
  if (
    [
      "FlowDocument",
      "Section",
      "ListItem",
      "TableCell",
      "Figure",
      "Floater",
    ].includes(parent)
  )
    return blocks.includes(child);
  if (
    ["Paragraph", "Span", "Bold", "Italic", "Underline", "Hyperlink"].includes(
      parent,
    )
  )
    return inlines.includes(child);
  return (
    (
      {
        List: "ListItem",
        Table: "TableRowGroup",
        TableRowGroup: "TableRow",
        TableRow: "TableCell",
      } as Record<string, string>
    )[parent] === child
  );
}
function cloneNode(node: NodeRecord): NodeRecord {
  return {
    ...node,
    Properties: new Map(node.Properties),
    Entries: new Map(node.Entries),
    Removed: new Map(node.Removed),
    Restored: new Map(node.Restored),
  };
}
function difference(before: string, after: string) {
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  if (start && /[\uDC00-\uDFFF]/.test(before[start] ?? after[start] ?? ""))
    start--;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before.at(-suffix - 1) === after.at(-suffix - 1)
  )
    suffix++;
  if (
    suffix &&
    /[\uDC00-\uDFFF]/.test(
      before[before.length - suffix] ?? after[after.length - suffix] ?? "",
    )
  )
    suffix--;
  return {
    Start: start,
    End: before.length - suffix,
    Text: after.slice(start, after.length - suffix),
  };
}

/** Causally delivered rich tree transactions, replicated text, and explicit epoch checkpoints. */
export class CollaborativeDocumentSession {
  readonly DocumentId: string;
  readonly ActorId: string;
  readonly OperationGenerated = new EventDispatcher<RichDocumentOperation>();
  readonly Changed = new EventDispatcher<{
    Session: CollaborativeDocumentSession;
    Operation?: RichDocumentOperation;
    Remote: boolean;
    Checkpoint?: boolean;
  }>();
  readonly Conflict = new EventDispatcher<{
    Error: Error;
    Operation?: RichDocumentOperation;
  }>();
  private epoch: string;
  private initial: DocumentNode;
  private initialHash: string;
  private checkpoint?: DocumentCheckpoint;
  private state: State;
  private document: DocumentNode;
  private vector = new Map<string, number>();
  private accepted = new Map<string, RichDocumentOperation>();
  private pending = new Map<string, RichDocumentOperation>();
  private clock = 0;
  private resync = false;
  private readonly maxPending: number;
  private readonly threshold: number;
  constructor(options: CollaborativeDocumentOptions) {
    if (!options || !safeActor(options.ActorId) || !safeId(options.DocumentId))
      throw new TypeError(
        "A document identity and unique safe actor identity are required.",
      );
    this.DocumentId = options.DocumentId;
    this.ActorId = options.ActorId;
    this.maxPending = options.MaxPendingOperations ?? 1000;
    this.threshold = options.CompactionOperationThreshold ?? 10000;
    if (!whole(this.maxPending) || !whole(this.threshold) || !this.threshold)
      throw new RangeError("Invalid collaboration queue or compaction limits.");
    this.initial = normalizeDocument(options.Document);
    this.initialHash = hash(stable(this.initial));
    this.epoch = `initial-${this.initialHash}`;
    this.state = this.seed(this.initial);
    this.document = this.project(this.state);
  }
  get Epoch(): string {
    return this.epoch;
  }
  get Document(): FlowDocument {
    return FlowDocument.FromJSON(this.document);
  }
  get DocumentJSON(): DocumentNode {
    return copy(this.document);
  }
  get Text(): string {
    return plainText(this.document);
  }
  get VersionVector(): VersionVector {
    return Object.fromEntries(
      [...this.vector].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  get PendingCount(): number {
    return this.pending.size;
  }
  get ResyncRequired(): boolean {
    return this.resync;
  }
  get RequiresCompaction(): boolean {
    return (
      this.accepted.size >= this.threshold ||
      [...this.state.Nodes.values()].some(
        (node) => node.Text?.RequiresCompaction,
      )
    );
  }
  get Statistics(): {
    Operations: number;
    Nodes: number;
    TombstonedNodes: number;
    Placements: number;
    Characters: number;
    Pending: number;
  } {
    return {
      Operations: this.accepted.size,
      Nodes: this.state.Nodes.size,
      TombstonedNodes: [...this.state.Nodes.values()].filter(removed).length,
      Placements: this.state.Placements.size,
      Characters: [...this.state.Nodes.values()].reduce(
        (n, node) => n + (node.Text?.CharacterCount ?? 0),
        0,
      ),
      Pending: this.pending.size,
    };
  }
  private textSession(node: DocumentNode): CollaborativeTextSession {
    return new CollaborativeTextSession({
      DocumentId: `rich-${hash(`${this.DocumentId}/${this.epoch}/${node.id}`)}`,
      ActorId: this.ActorId,
      Text: node.text ?? "",
      MaxCharacters: Math.max(1000000, (node.text?.length ?? 0) * 2),
    });
  }
  private record(node: DocumentNode, stamp: Stamp): NodeRecord {
    const result: NodeRecord = {
      Id: node.id,
      Type: node.type,
      Created: stamp,
      Properties: new Map(),
      Entries: new Map(),
      Removed: new Map(),
      Restored: new Map(),
      ...(node.type === "Run" ? { Text: this.textSession(node) } : {}),
    };
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (name === "Columns") continue;
      if (name === "Annotations") {
        if (!Array.isArray(value))
          throw new CollaborationConflictError("Annotations must be an array.");
        value.forEach((entry, index) => {
          if (!safeId(entry?.Id) || result.Entries.has(entry.Id))
            throw new CollaborationConflictError(
              "Annotations require unique IDs.",
            );
          const entryStamp = { ...stamp, Index: stamp.Index + index };
          result.Entries.set(entry.Id, {
            Value: copy(entry),
            Removed: false,
            Stamp: entryStamp,
            Created: entryStamp,
          });
        });
      } else
        result.Properties.set(name, {
          Value: copy(value),
          Removed: false,
          Stamp: stamp,
          Created: stamp,
        });
    }
    return result;
  }
  private seed(root: DocumentNode): State {
    const state: State = { Nodes: new Map(), Placements: new Map() };
    let count = 0;
    const visit = (
      node: DocumentNode,
      parent?: string,
      collection: DocumentCollection = "Children",
      after: string | null = null,
    ): string => {
      const stamp = { ...seedStamp, Index: count++ },
        id = `seed:${count}`;
      state.Nodes.set(node.id, this.record(node, stamp));
      if (parent)
        state.Placements.set(id, {
          Id: id,
          NodeId: node.id,
          ParentId: parent,
          Collection: collection,
          After: after,
          Stamp: stamp,
        });
      let last: string | null = null;
      for (const child of node.children ?? [])
        last = visit(child, node.id, "Children", last);
      last = null;
      for (const column of node.props.Columns ?? [])
        last = visit(column, node.id, "Columns", last);
      return id;
    };
    visit(root);
    return state;
  }
  private chosen(state: State): Map<string, Placement> {
    const selected = new Map<string, Placement>();
    const placements = [...state.Placements.values()].sort(
      (a, b) => compare(b.Stamp, a.Stamp) || (a.Id < b.Id ? -1 : 1),
    );
    for (const placement of placements) {
      if (selected.has(placement.NodeId)) continue;
      let parent = placement.ParentId,
        cyclic = false;
      const seen = new Set<string>();
      while (parent) {
        if (parent === placement.NodeId || seen.has(parent)) {
          cyclic = true;
          break;
        }
        seen.add(parent);
        parent = selected.get(parent)?.ParentId ?? "";
      }
      if (!cyclic) selected.set(placement.NodeId, placement);
    }
    return selected;
  }
  private project(state: State): DocumentNode {
    const chosen = this.chosen(state),
      byAnchor = new Map<string, Placement[]>();
    const key = (
      parent: string,
      collection: DocumentCollection,
      anchor: string | null,
    ) => JSON.stringify([parent, collection, anchor]);
    for (const placement of state.Placements.values()) {
      const anchorKey = key(
          placement.ParentId,
          placement.Collection,
          placement.After,
        ),
        items = byAnchor.get(anchorKey) ?? [];
      items.push(placement);
      byAnchor.set(anchorKey, items);
    }
    for (const items of byAnchor.values())
      items.sort((a, b) => compare(b.Stamp, a.Stamp) || (a.Id < b.Id ? -1 : 1));
    const visit = (id: string, depth: number): DocumentNode => {
      if (depth > 256)
        throw new CollaborationConflictError(
          "The merged tree exceeds the document nesting limit.",
        );
      const node = state.Nodes.get(id)!;
      const props: Record<string, unknown> = Object.fromEntries(
        [...node.Properties]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .filter(([, value]) => !value.Removed)
          .map(([name, value]) => [name, copy(value.Value)]),
      );
      if (
        node.Entries.size ||
        (id === this.initial.id &&
          Object.hasOwn(this.initial.props, "Annotations"))
      )
        props.Annotations = [...node.Entries.values()]
          .filter((entry) => !entry.Removed)
          .sort(
            (a, b) =>
              compare(a.Created, b.Created) ||
              (String((a.Value as any).Id) < String((b.Value as any).Id)
                ? -1
                : 1),
          )
          .map((entry) => copy(entry.Value));
      const children = (collection: DocumentCollection): DocumentNode[] => {
        const output: DocumentNode[] = [],
          stack = [
            ...(byAnchor.get(key(id, collection, null)) ?? []),
          ].reverse();
        while (stack.length) {
          const placement = stack.pop()!;
          if (
            chosen.get(placement.NodeId)?.Id === placement.Id &&
            !removed(state.Nodes.get(placement.NodeId)!)
          )
            output.push(visit(placement.NodeId, depth + 1));
          const following =
            byAnchor.get(key(id, collection, placement.Id)) ?? [];
          for (let i = following.length - 1; i >= 0; i--)
            stack.push(following[i]);
        }
        return output;
      };
      if (node.Type === "Table") props.Columns = children("Columns");
      const childNodes = children("Children");
      return {
        type: node.Type,
        id: node.Id,
        props,
        ...(node.Type === "Run" ? { text: node.Text!.Text } : {}),
        ...(childNodes.length ||
        ![
          "Run",
          "LineBreak",
          "Equation",
          "Image",
          "InlineUIContainer",
          "BlockUIContainer",
          "TableColumn",
        ].includes(node.Type)
          ? { children: childNodes }
          : {}),
      };
    };
    return visit(this.initial.id, 0);
  }
  private next(): RichDocumentOperation {
    return {
      Protocol: 2,
      DocumentId: this.DocumentId,
      Epoch: this.epoch,
      InitialHash: this.initialHash,
      ActorId: this.ActorId,
      Sequence: (this.vector.get(this.ActorId) ?? 0) + 1,
      Clock: this.clock + 1,
      Dependencies: {
        ...this.VersionVector,
        [this.ActorId]: this.vector.get(this.ActorId) ?? 0,
      },
      Actions: [],
    };
  }
  private key(operation: RichDocumentOperation): string {
    return `${operation.ActorId}:${operation.Sequence}`;
  }
  private ready(operation: RichDocumentOperation): boolean {
    return (
      operation.Sequence === (this.vector.get(operation.ActorId) ?? 0) + 1 &&
      Object.entries(operation.Dependencies).every(
        ([actor, sequence]) => (this.vector.get(actor) ?? 0) >= sequence,
      )
    );
  }
  private validate(operation: RichDocumentOperation): void {
    jsonValue(operation);
    const keys = [
      "Protocol",
      "DocumentId",
      "Epoch",
      "InitialHash",
      "ActorId",
      "Sequence",
      "Clock",
      "Dependencies",
      "Actions",
    ];
    if (
      Object.keys(operation).some((key) => !keys.includes(key)) ||
      operation.Protocol !== 2 ||
      operation.DocumentId !== this.DocumentId ||
      operation.Epoch !== this.epoch ||
      operation.InitialHash !== this.initialHash
    )
      throw new CollaborationConflictError(
        "Protocol, document, initial content, or checkpoint epoch does not match.",
      );
    if (
      !safeActor(operation.ActorId) ||
      !whole(operation.Sequence) ||
      !operation.Sequence ||
      !whole(operation.Clock) ||
      !operation.Clock ||
      !operation.Dependencies ||
      Array.isArray(operation.Dependencies) ||
      typeof operation.Dependencies !== "object" ||
      Object.entries(operation.Dependencies).some(
        ([actor, sequence]) => !safeActor(actor) || !whole(sequence),
      ) ||
      (operation.Dependencies[operation.ActorId] ?? 0) !==
        operation.Sequence - 1
    )
      throw new CollaborationConflictError(
        "Malformed rich operation causal envelope.",
      );
    if (
      !Array.isArray(operation.Actions) ||
      !operation.Actions.length ||
      operation.Actions.length > 20000 ||
      stable(operation).length > 16 * 1024 * 1024
    )
      throw new CollaborationConflictError(
        "Rich transaction is empty or exceeds its payload limit.",
      );
  }
  private applyAction(
    state: State,
    operation: RichDocumentOperation,
    action: RichDocumentAction,
    index: number,
  ): void {
    const allowed: Record<string, string[]> = {
      Insert: ["Kind", "Node", "ParentId", "Collection", "After"],
      Move: ["Kind", "NodeId", "ParentId", "Collection", "After"],
      Remove: ["Kind", "NodeIds"],
      Restore: ["Kind", "NodeIds"],
      Property: ["Kind", "NodeId", "Name", "Value", "Remove"],
      Entry: ["Kind", "NodeId", "Name", "EntryId", "Value", "Remove"],
      Text: ["Kind", "NodeId", "Operation"],
    };
    if (
      !action ||
      typeof action !== "object" ||
      !allowed[action.Kind] ||
      Object.keys(action).some((key) => !allowed[action.Kind].includes(key)) ||
      ("Remove" in action && typeof action.Remove !== "boolean") ||
      ("Remove" in action && action.Remove === true && "Value" in action)
    )
      throw new CollaborationConflictError("Malformed rich action fields.");
    const stamp: Stamp = {
      ActorId: operation.ActorId,
      Sequence: operation.Sequence,
      Clock: operation.Clock,
      Index: index,
    };
    const observed = (created: Stamp) => {
      if (
        created.Sequence &&
        !(
          created.ActorId === operation.ActorId &&
          created.Sequence === operation.Sequence &&
          created.Index < index
        ) &&
        (operation.Dependencies[created.ActorId] ?? 0) < created.Sequence
      )
        throw new CollaborationConflictError(
          "A referenced object is absent from the causal dependencies.",
        );
    };
    const node = (id: string): NodeRecord => {
      const item = state.Nodes.get(id);
      if (!item)
        throw new CollaborationConflictError(
          `Unknown rich document node: ${id}`,
        );
      observed(item.Created);
      return item;
    };
    const mutable = (id: string): NodeRecord => {
      const result = cloneNode(node(id));
      state.Nodes.set(id, result);
      return result;
    };
    const place = (
      id: string,
      parentId: string,
      collection: DocumentCollection,
      after: string | null,
    ) => {
      const parent = node(parentId),
        item = state.Nodes.get(id)!;
      if (
        id === this.initial.id ||
        !["Children", "Columns"].includes(collection) ||
        !compatible(parent.Type, item.Type, collection)
      )
        throw new CollaborationConflictError(
          "Invalid parent or collection for a document node.",
        );
      if (after !== null) {
        const anchor = state.Placements.get(after);
        if (
          !anchor ||
          anchor.ParentId !== parentId ||
          anchor.Collection !== collection
        )
          throw new CollaborationConflictError(
            "Unknown or incompatible ordering anchor.",
          );
        observed(anchor.Stamp);
      }
      const idPlacement = `${operation.ActorId}:${operation.Sequence}:${index}`;
      state.Placements.set(idPlacement, {
        Id: idPlacement,
        NodeId: id,
        ParentId: parentId,
        Collection: collection,
        After: after,
        Stamp: stamp,
      });
    };
    switch (action.Kind) {
      case "Insert": {
        const input = action.Node;
        if (
          !input ||
          !safeId(input.id) ||
          state.Nodes.has(input.id) ||
          input.children?.length ||
          input.props?.Columns?.length ||
          input.type === "FlowDocument"
        )
          throw new CollaborationConflictError(
            "Insert requires one new, globally unique node without nested children.",
          );
        elementFromJSON(input);
        state.Nodes.set(input.id, this.record(input, stamp));
        place(input.id, action.ParentId, action.Collection, action.After);
        break;
      }
      case "Move":
        node(action.NodeId);
        place(action.NodeId, action.ParentId, action.Collection, action.After);
        break;
      case "Remove":
      case "Restore": {
        if (
          !Array.isArray(action.NodeIds) ||
          !action.NodeIds.length ||
          new Set(action.NodeIds).size !== action.NodeIds.length
        )
          throw new CollaborationConflictError(
            "Remove/restore requires distinct node IDs.",
          );
        for (const id of action.NodeIds) {
          if (id === this.initial.id)
            throw new CollaborationConflictError(
              "The document root cannot be removed.",
            );
          const target = mutable(id);
          if (action.Kind === "Remove")
            target.Removed.set(operation.ActorId, {
              Sequence: operation.Sequence,
              Index: index,
            });
          else {
            for (const [actor, sequence] of Object.entries(
              operation.Dependencies,
            )) {
              const point = {
                Sequence: sequence,
                Index: Number.MAX_SAFE_INTEGER,
              };
              if (
                pointCompare(
                  point,
                  target.Restored.get(actor) ?? { Sequence: 0, Index: 0 },
                ) > 0
              )
                target.Restored.set(actor, point);
            }
            target.Restored.set(operation.ActorId, {
              Sequence: operation.Sequence,
              Index: index,
            });
          }
        }
        break;
      }
      case "Property": {
        if (
          !safeId(action.Name) ||
          [
            "Columns",
            "Annotations",
            "__proto__",
            "prototype",
            "constructor",
          ].includes(action.Name) ||
          (action.Remove !== true && !Object.hasOwn(action, "Value"))
        )
          throw new CollaborationConflictError("Invalid property transaction.");
        const target = mutable(action.NodeId),
          old = target.Properties.get(action.Name);
        if (!action.Remove)
          elementFromJSON({
            type: target.Type,
            id: target.Id,
            props: { [action.Name]: action.Value },
            ...(target.Type === "Run" ? { text: "" } : {}),
          });
        if (!old || compare(old.Stamp, stamp) < 0) {
          target.Properties.set(action.Name, {
            Stamp: stamp,
            Created: old?.Created ?? stamp,
            Removed: action.Remove === true,
            ...(!action.Remove ? { Value: copy(action.Value) } : {}),
          });
        }
        break;
      }
      case "Entry": {
        if (
          action.Name !== "Annotations" ||
          !safeId(action.EntryId) ||
          (action.Remove !== true &&
            (action.Value as any)?.Id !== action.EntryId)
        )
          throw new CollaborationConflictError(
            "Annotation entry identity does not match.",
          );
        const target = mutable(action.NodeId),
          old = target.Entries.get(action.EntryId);
        const created =
          old && compare(old.Created, stamp) < 0 ? old.Created : stamp;
        if (!old || compare(old.Stamp, stamp) < 0)
          target.Entries.set(action.EntryId, {
            Stamp: stamp,
            Created: created,
            Removed: action.Remove === true,
            ...(!action.Remove ? { Value: copy(action.Value) } : {}),
          });
        else if (compare(created, old.Created) < 0)
          target.Entries.set(action.EntryId, { ...old, Created: created });
        break;
      }
      case "Text": {
        const target = mutable(action.NodeId);
        if (
          !target.Text ||
          action.Operation.ActorId !== operation.ActorId ||
          action.Operation.Kind === "Format"
        )
          throw new CollaborationConflictError(
            "Text actions require a Run and the transaction actor.",
          );
        target.Text = target.Text.Fork(this.ActorId);
        const result = target.Text.Receive(action.Operation);
        if (result !== "applied" || target.Text.PendingCount)
          throw new CollaborationConflictError(
            "A rich text action has missing or duplicate text dependencies.",
          );
        break;
      }
      default:
        throw new CollaborationConflictError(
          "Unknown rich transaction action.",
        );
    }
  }
  private draft(operation: RichDocumentOperation): State {
    let clock = 0;
    for (const [actor, sequence] of Object.entries(operation.Dependencies)) {
      if (!sequence) continue;
      const predecessor = this.accepted.get(`${actor}:${sequence}`);
      if (!predecessor)
        throw new CollaborationConflictError(
          "Missing rich causal predecessor.",
        );
      clock = Math.max(clock, predecessor.Clock);
    }
    if (operation.Clock !== clock + 1)
      throw new CollaborationConflictError(
        "Rich Lamport clock does not match its causal dependencies.",
      );
    const state = {
      Nodes: new Map(this.state.Nodes),
      Placements: new Map(this.state.Placements),
    };
    operation.Actions.forEach((action, index) =>
      this.applyAction(state, operation, action, index),
    );
    return state;
  }
  private report(error: unknown, operation?: RichDocumentOperation): void {
    try {
      this.Conflict.Emit({
        Error: error instanceof Error ? error : new Error(String(error)),
        Operation: operation,
      });
    } catch {
      /* A failing observer cannot roll back a committed protocol operation. */
    }
  }
  private notify(operation: RichDocumentOperation, remote: boolean): void {
    try {
      this.Changed.Emit({
        Session: this,
        Operation: copy(operation),
        Remote: remote,
      });
    } catch (error) {
      this.report(error, operation);
    }
    if (!remote)
      try {
        this.OperationGenerated.Emit(copy(operation));
      } catch (error) {
        this.report(error, operation);
      }
  }
  private accept(operation: RichDocumentOperation, remote: boolean): void {
    const state = this.draft(operation),
      document = this.project(state);
    FlowDocument.FromJSON(document);
    this.state = state;
    this.document = document;
    this.vector.set(operation.ActorId, operation.Sequence);
    this.clock = Math.max(this.clock, operation.Clock);
    this.accepted.set(this.key(operation), copy(operation));
    this.notify(operation, remote);
  }
  private commit(
    operation: RichDocumentOperation,
  ): RichDocumentOperation | undefined {
    if (!operation.Actions.length) return undefined;
    this.validate(operation);
    this.accept(operation, false);
    this.drain();
    return copy(operation);
  }
  Receive(input: RichDocumentOperation): "applied" | "queued" | "duplicate" {
    try {
      const operation = copy(input);
      this.validate(operation);
      const key = this.key(operation),
        old = this.accepted.get(key) ?? this.pending.get(key);
      if (old) {
        if (!equal(old, operation))
          throw new CollaborationConflictError(
            "A rich operation ID was reused with different contents.",
          );
        return "duplicate";
      }
      if (operation.Sequence <= (this.vector.get(operation.ActorId) ?? 0))
        throw new CollaborationConflictError(
          "Unknown replayed rich operation.",
        );
      if (!this.ready(operation)) {
        if (this.pending.size >= this.maxPending) {
          this.resync = true;
          throw new CollaborationConflictError(
            "Rich causal queue limit exceeded; obtain a complete snapshot.",
          );
        }
        this.pending.set(key, operation);
        return "queued";
      }
      this.accept(operation, true);
      this.drain();
      return "applied";
    } catch (error) {
      if (input?.Epoch !== this.epoch) this.resync = true;
      this.report(error, input);
      throw error;
    }
  }
  private drain(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [key, operation] of this.pending)
        if (this.ready(operation)) {
          this.pending.delete(key);
          try {
            this.accept(operation, true);
          } catch (error) {
            this.resync = true;
            this.report(error, operation);
          }
          progress = true;
        }
    }
  }
  private anchor(
    parentId: string,
    index: number,
    collection: DocumentCollection,
    state = this.state,
  ): string | null {
    if (!whole(index))
      throw new RangeError("A collection index must be a nonnegative integer.");
    const document = this.project(state),
      all = flatten(document),
      parent = all.get(parentId)?.Node;
    if (!parent) throw new RangeError("The target parent is not visible.");
    const children: DocumentNode[] =
      collection === "Columns"
        ? (parent.props.Columns ?? [])
        : (parent.children ?? []);
    if (index > children.length)
      throw new RangeError("Collection index is outside the parent.");
    return index ? this.chosen(state).get(children[index - 1].id)!.Id : null;
  }
  InsertNode(
    parentId: string,
    index: number,
    node: DocumentNode,
    collection: DocumentCollection = "Children",
  ): RichDocumentOperation {
    const operation = this.next(),
      state = {
        Nodes: new Map(this.state.Nodes),
        Placements: new Map(this.state.Placements),
      };
    const append = (action: RichDocumentAction) => {
      this.applyAction(state, operation, action, operation.Actions.length);
      operation.Actions.push(action);
    };
    const insert = (
      input: DocumentNode,
      parent: string,
      after: string | null,
      target: DocumentCollection,
    ): string => {
      const skeleton = copy(input);
      delete skeleton.children;
      delete skeleton.props.Columns;
      const index = operation.Actions.length;
      append({
        Kind: "Insert",
        Node: skeleton,
        ParentId: parent,
        Collection: target,
        After: after,
      });
      let last: string | null = null;
      for (const child of input.children ?? [])
        last = insert(child, input.id, last, "Children");
      last = null;
      for (const column of input.props.Columns ?? [])
        last = insert(column, input.id, last, "Columns");
      return `${operation.ActorId}:${operation.Sequence}:${index}`;
    };
    jsonValue(node);
    elementFromJSON(node);
    insert(
      node,
      parentId,
      this.anchor(parentId, index, collection),
      collection,
    );
    return this.commit(operation)!;
  }
  /** Move to a final zero-based index, excluding the moved node from its destination siblings. */
  MoveNode(
    nodeId: string,
    parentId: string,
    index: number,
    collection: DocumentCollection = "Children",
  ): RichDocumentOperation {
    const parent = flatten(this.document).get(parentId)?.Node;
    if (!parent || !whole(index))
      throw new RangeError("Invalid move destination.");
    const children: DocumentNode[] = (
      collection === "Columns"
        ? (parent.props.Columns ?? [])
        : (parent.children ?? [])
    ).filter((node: DocumentNode) => node.id !== nodeId);
    if (index > children.length)
      throw new RangeError("Move index is outside the destination.");
    const after = index
      ? this.chosen(this.state).get(children[index - 1].id)!.Id
      : null;
    const operation = this.next();
    operation.Actions.push({
      Kind: "Move",
      NodeId: nodeId,
      ParentId: parentId,
      Collection: collection,
      After: after,
    });
    return this.commit(operation)!;
  }
  RemoveNode(nodeId: string): RichDocumentOperation {
    const target = flatten(this.document).get(nodeId);
    if (!target) throw new RangeError("The removed node is not visible.");
    const operation = this.next();
    operation.Actions.push({
      Kind: "Remove",
      NodeIds: [...flatten(target.Node).keys()],
    });
    return this.commit(operation)!;
  }
  RestoreNodes(nodeIds: string[]): RichDocumentOperation {
    const operation = this.next();
    operation.Actions.push({ Kind: "Restore", NodeIds: [...nodeIds] });
    return this.commit(operation)!;
  }
  SetProperty(
    nodeId: string,
    name: string,
    value: unknown,
  ): RichDocumentOperation {
    const operation = this.next();
    operation.Actions.push({
      Kind: "Property",
      NodeId: nodeId,
      Name: name,
      Value: copy(value),
    });
    return this.commit(operation)!;
  }
  ClearProperty(nodeId: string, name: string): RichDocumentOperation {
    const operation = this.next();
    operation.Actions.push({
      Kind: "Property",
      NodeId: nodeId,
      Name: name,
      Remove: true,
    });
    return this.commit(operation)!;
  }
  ReplaceText(
    nodeId: string,
    start: number,
    end: number,
    text: string,
  ): RichDocumentOperation | undefined {
    const run = this.state.Nodes.get(nodeId)?.Text;
    if (!run) throw new TypeError("ReplaceText requires a Run node.");
    const operation = this.next();
    operation.Actions = replacementOperations(
      run,
      this.ActorId,
      start,
      end,
      text,
    ).map((Operation) => ({ Kind: "Text", NodeId: nodeId, Operation }));
    return this.commit(operation);
  }
  /** Capture a rich control transaction by stable identity; newly created nodes require globally unique IDs. */
  UpdateDocument(
    document: FlowDocument | DocumentNode,
  ): RichDocumentOperation | undefined {
    const next = normalizeDocument(document);
    if (next.id !== this.initial.id)
      throw new CollaborationConflictError(
        "An engine binding cannot replace the collaborative root identity.",
      );
    const wanted = flatten(next),
      before = flatten(this.document),
      operation = this.next(),
      state = {
        Nodes: new Map(this.state.Nodes),
        Placements: new Map(this.state.Placements),
      };
    const append = (action: RichDocumentAction) => {
      this.applyAction(state, operation, action, operation.Actions.length);
      operation.Actions.push(action);
    };
    const deleted = [...before.keys()].filter((id) => !wanted.has(id));
    if (deleted.length) append({ Kind: "Remove", NodeIds: deleted });
    const restored = [...wanted.keys()].filter(
      (id) => state.Nodes.has(id) && removed(state.Nodes.get(id)!),
    );
    if (restored.length) append({ Kind: "Restore", NodeIds: restored });
    const stableNodes = stableOrderNodes(wanted, before),
      placements = this.chosen(state),
      previous = new Map<string, string>();
    for (const [id, item] of wanted) {
      const current = state.Nodes.get(id),
        group = JSON.stringify([item.Parent, item.Collection]),
        preceding = previous.get(group),
        after = preceding ? placements.get(preceding)!.Id : null;
      if (!current) {
        const skeleton = copy(item.Node);
        delete skeleton.children;
        delete skeleton.props.Columns;
        const index = operation.Actions.length;
        append({
          Kind: "Insert",
          Node: skeleton,
          ParentId: item.Parent!,
          Collection: item.Collection,
          After: after,
        });
        placements.set(
          id,
          state.Placements.get(
            `${operation.ActorId}:${operation.Sequence}:${index}`,
          )!,
        );
      } else {
        if (current.Type !== item.Node.type)
          throw new CollaborationConflictError(
            "A stable node ID cannot change element type.",
          );
        if (item.Parent && !stableNodes.has(id)) {
          const index = operation.Actions.length;
          append({
            Kind: "Move",
            NodeId: id,
            ParentId: item.Parent,
            Collection: item.Collection,
            After: after,
          });
          placements.set(
            id,
            state.Placements.get(
              `${operation.ActorId}:${operation.Sequence}:${index}`,
            )!,
          );
        }
      }
      if (item.Parent) previous.set(group, id);
    }
    for (const [id, item] of wanted) {
      const current = state.Nodes.get(id)!;
      for (const name of new Set([
        ...current.Properties.keys(),
        ...Object.keys(item.Node.props),
      ])) {
        if (name === "Columns" || name === "Annotations") continue;
        const old = current.Properties.get(name),
          exists = Object.hasOwn(item.Node.props, name);
        if (
          exists
            ? !old || old.Removed || !equal(old.Value, item.Node.props[name])
            : old && !old.Removed
        )
          append({
            Kind: "Property",
            NodeId: id,
            Name: name,
            ...(exists
              ? { Value: copy(item.Node.props[name]) }
              : { Remove: true }),
          });
      }
      const entries = new Map<string, unknown>(
        (item.Node.props.Annotations ?? []).map((entry: any) => [
          entry.Id,
          entry,
        ]),
      );
      if (entries.size !== (item.Node.props.Annotations?.length ?? 0))
        throw new CollaborationConflictError("Annotation IDs must be unique.");
      for (const entryId of new Set([
        ...current.Entries.keys(),
        ...entries.keys(),
      ])) {
        const old = current.Entries.get(entryId),
          exists = entries.has(entryId);
        if (
          exists
            ? !old || old.Removed || !equal(old.Value, entries.get(entryId))
            : old && !old.Removed
        )
          append({
            Kind: "Entry",
            NodeId: id,
            Name: "Annotations",
            EntryId: entryId,
            ...(exists
              ? { Value: copy(entries.get(entryId)) }
              : { Remove: true }),
          });
      }
      if (current.Text && current.Text.Text !== (item.Node.text ?? "")) {
        const diff = difference(current.Text.Text, item.Node.text ?? "");
        for (const Operation of replacementOperations(
          current.Text,
          this.ActorId,
          diff.Start,
          diff.End,
          diff.Text,
        ))
          append({ Kind: "Text", NodeId: id, Operation });
      }
    }
    return this.commit(operation);
  }
  ExportSnapshot(): RichDocumentSnapshot {
    return {
      Protocol: 2,
      DocumentId: this.DocumentId,
      Epoch: this.epoch,
      InitialDocument: copy(this.initial),
      Operations: [...this.accepted.values()]
        .sort((a, b) => a.Clock - b.Clock || (a.ActorId < b.ActorId ? -1 : 1))
        .map(copy),
      ...(this.checkpoint ? { Checkpoint: copy(this.checkpoint) } : {}),
    };
  }
  static FromSnapshot(
    snapshot: RichDocumentSnapshot,
    actorId: string,
  ): CollaborativeDocumentSession {
    if (
      !snapshot ||
      snapshot.Protocol !== 2 ||
      !safeId(snapshot.Epoch) ||
      !Array.isArray(snapshot.Operations)
    )
      throw new CollaborationConflictError("Malformed rich document snapshot.");
    jsonValue(snapshot);
    const session = new CollaborativeDocumentSession({
      DocumentId: snapshot.DocumentId,
      ActorId: actorId,
      Document: snapshot.InitialDocument,
    });
    session.epoch = snapshot.Epoch;
    session.checkpoint = copy(snapshot.Checkpoint);
    session.state = session.seed(session.initial);
    session.document = session.project(session.state);
    for (const operation of [...snapshot.Operations].sort(
      (a, b) => a.Clock - b.Clock || (a.ActorId < b.ActorId ? -1 : 1),
    ))
      session.Receive(operation);
    if (session.PendingCount)
      throw new CollaborationConflictError(
        "The rich snapshot is missing causal operations.",
      );
    return session;
  }
  /** Start a new epoch only after every known participant acknowledges the same complete frontier. */
  CreateCheckpoint(
    acknowledgements: Record<string, VersionVector>,
  ): RichDocumentSnapshot {
    jsonValue(acknowledgements);
    if (this.pending.size)
      throw new CollaborationConflictError(
        "Cannot checkpoint with pending causal operations.",
      );
    const participants = new Set([
      this.ActorId,
      ...this.vector.keys(),
      ...Object.keys(this.checkpoint?.Acknowledgements ?? {}),
    ]);
    if (
      [...participants].some(
        (actor) => !equal(acknowledgements[actor], this.VersionVector),
      ) ||
      Object.entries(acknowledgements).some(
        ([actor, vector]) =>
          !safeActor(actor) || !equal(vector, this.VersionVector),
      )
    )
      throw new CollaborationConflictError(
        "Every known participant must acknowledge exactly the current version vector.",
      );
    return {
      Protocol: 2,
      DocumentId: this.DocumentId,
      Epoch: `checkpoint-${hash(stable([this.epoch, this.VersionVector, this.document]))}`,
      InitialDocument: copy(this.document),
      Operations: [],
      Checkpoint: {
        PreviousEpoch: this.epoch,
        Frontier: this.VersionVector,
        Acknowledgements: copy(acknowledgements),
      },
    };
  }
  AdoptCheckpoint(snapshot: RichDocumentSnapshot): void {
    if (
      this.pending.size ||
      snapshot.DocumentId !== this.DocumentId ||
      snapshot.Checkpoint?.PreviousEpoch !== this.epoch ||
      !equal(snapshot.Checkpoint.Frontier, this.VersionVector) ||
      !equal(
        normalizeDocument(snapshot.InitialDocument),
        normalizeDocument(this.document),
      ) ||
      snapshot.Operations.length
    )
      throw new CollaborationConflictError(
        "Checkpoint would discard pending, offline, or unacknowledged edits.",
      );
    const expected = this.CreateCheckpoint(
      snapshot.Checkpoint.Acknowledgements,
    );
    if (snapshot.Epoch !== expected.Epoch)
      throw new CollaborationConflictError(
        "Checkpoint epoch does not match its acknowledged frontier.",
      );
    const next = CollaborativeDocumentSession.FromSnapshot(
      snapshot,
      this.ActorId,
    );
    this.epoch = next.epoch;
    this.initial = next.initial;
    this.initialHash = next.initialHash;
    this.checkpoint = next.checkpoint;
    this.state = next.state;
    this.document = next.document;
    this.vector.clear();
    this.accepted.clear();
    this.pending.clear();
    this.clock = 0;
    this.resync = false;
    try {
      this.Changed.Emit({ Session: this, Remote: false, Checkpoint: true });
    } catch (error) {
      this.report(error);
    }
  }
  BindEngine(engine: RichTextEngine): RichDocumentBinding {
    return new RichDocumentBinding(this, engine);
  }
}
function flatten(root: DocumentNode): Map<
  string,
  {
    Node: DocumentNode;
    Parent?: string;
    Collection: DocumentCollection;
    Index: number;
  }
> {
  const result = new Map<
    string,
    {
      Node: DocumentNode;
      Parent?: string;
      Collection: DocumentCollection;
      Index: number;
    }
  >();
  const visit = (
    node: DocumentNode,
    parent?: string,
    collection: DocumentCollection = "Children",
    index = 0,
  ) => {
    if (result.has(node.id))
      throw new CollaborationConflictError(
        "Duplicate node identity in document.",
      );
    result.set(node.id, {
      Node: node,
      Parent: parent,
      Collection: collection,
      Index: index,
    });
    node.children?.forEach((child, index) =>
      visit(child, node.id, "Children", index),
    );
    (node.props.Columns ?? []).forEach((child: DocumentNode, index: number) =>
      visit(child, node.id, "Columns", index),
    );
  };
  visit(root);
  return result;
}

/** Chunk a large paste inside one atomic outer transaction without splitting surrogate pairs. */
function replacementOperations(
  source: CollaborativeTextSession,
  actor: string,
  start: number,
  end: number,
  value: string,
): TextOperation[] {
  if (typeof value !== "string")
    throw new TypeError("Replacement text must be a string.");
  const text = value.replace(/\r\n?/g, "\n"),
    replica = source.Fork(actor),
    operations: TextOperation[] = [];
  let cursor = 0;
  do {
    let limit = Math.min(text.length, cursor + 65536);
    if (limit < text.length && /[\uDC00-\uDFFF]/.test(text[limit])) limit--;
    const chunk = text.slice(cursor, limit);
    const operation =
      cursor === 0
        ? replica.Replace(start, end, chunk)
        : replica.Insert(start + cursor, chunk);
    if (operation) operations.push(operation);
    cursor = limit;
  } while (cursor < text.length);
  return operations;
}

/** Keep a longest increasing subsequence per collection, so a text edit never scans the full tree per node. */
function stableOrderNodes(
  wanted: ReturnType<typeof flatten>,
  before: ReturnType<typeof flatten>,
): Set<string> {
  const groups = new Map<string, Array<{ Id: string; Index: number }>>(),
    keep = new Set<string>();
  for (const [id, item] of wanted) {
    const old = before.get(id);
    if (
      !item.Parent ||
      !old ||
      old.Parent !== item.Parent ||
      old.Collection !== item.Collection
    )
      continue;
    const key = JSON.stringify([item.Parent, item.Collection]),
      values = groups.get(key) ?? [];
    values.push({ Id: id, Index: old.Index });
    groups.set(key, values);
  }
  for (const values of groups.values()) {
    const tails: number[] = [],
      predecessors = new Array<number>(values.length).fill(-1);
    values.forEach((value, index) => {
      let lo = 0,
        hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (values[tails[mid]].Index < value.Index) lo = mid + 1;
        else hi = mid;
      }
      if (lo) predecessors[index] = tails[lo - 1];
      tails[lo] = index;
    });
    let cursor = tails.at(-1) ?? -1;
    while (cursor >= 0) {
      keep.add(values[cursor].Id);
      cursor = predecessors[cursor];
    }
  }
  return keep;
}

/** Shares the full existing control engine; remote application retains live matching model objects. */
export class RichDocumentBinding {
  private subscriptions: Array<{ Dispose(): void }> = [];
  private applying = false;
  private disposed = false;
  get IsConnected(): boolean {
    return !this.disposed;
  }
  constructor(
    readonly Session: CollaborativeDocumentSession,
    readonly Engine: RichTextEngine,
  ) {
    if (
      !equal(
        normalizeDocument(Engine.Document),
        normalizeDocument(Session.DocumentJSON),
      )
    )
      throw new CollaborationConflictError(
        "Rich peers must start from the same document content and node IDs.",
      );
    this.subscriptions.push(
      Engine.Changed.Subscribe(() => {
        if (this.applying || this.disposed) return;
        this.applying = true;
        try {
          Session.UpdateDocument(Engine.Document);
        } catch (error) {
          this.fail(error);
        } finally {
          this.applying = false;
        }
      }),
    );
    this.subscriptions.push(
      Session.Changed.Subscribe(({ Remote, Checkpoint }) => {
        if (Checkpoint && !this.disposed) Engine.ClearUndo();
        if (
          this.applying ||
          this.disposed ||
          equal(
            normalizeDocument(Engine.Document),
            normalizeDocument(Session.DocumentJSON),
          )
        )
          return;
        this.applying = true;
        const selection = Engine.CaptureSelectionState(),
          start = new TextPointer(Engine.Document, selection.Start),
          end = new TextPointer(Engine.Document, selection.End);
        try {
          const engine = Engine as RichTextEngine & {
            ApplyRemoteDocument?: (
              document: FlowDocument,
              options?: { MapAnnotations?: boolean },
            ) => void;
          };
          if (Remote && engine.ApplyRemoteDocument)
            engine.ApplyRemoteDocument(Session.Document, {
              MapAnnotations: false,
            });
          else {
            const tracking = engine.TrackChanges;
            engine.TrackChanges = false;
            try {
              engine.ReplaceDocument(Session.Document, {
                MapAnnotations: false,
              });
              if (Remote) engine.ClearUndo();
            } finally {
              engine.TrackChanges = tracking;
            }
          }
          Engine.RestoreSelectionState({
            ...selection,
            Start: start.Offset,
            End: end.Offset,
          });
        } catch (error) {
          this.fail(error);
        } finally {
          this.applying = false;
        }
      }),
    );
  }
  private fail(error: unknown): void {
    this.Dispose();
    this.Session.Conflict.Emit({
      Error: error instanceof Error ? error : new Error(String(error)),
    });
  }
  Dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.forEach((subscription) => subscription.Dispose());
    this.subscriptions = [];
  }
}
