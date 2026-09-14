import { FlowDocument } from "./model.js";
import type { DocumentNode } from "./model.js";
import type { RichTextEngine } from "./engine.js";
import { DocumentFeatures } from "./document-features.js";
import type {
  FieldContext,
  FieldType,
  StoryKind,
  NoteKind,
  TableOfContentsOptions,
} from "./document-features.js";
import { ObservableEvent, Subscription } from "./mvvm.js";
import type { IDisposable } from "./mvvm.js";

export const BridgeProtocol = { channel: "richtextweb", version: 1 } as const;
export interface BridgeRequest {
  channel: "richtextweb";
  version: 1;
  kind: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}
export interface BridgeResponse {
  channel: "richtextweb";
  version: 1;
  kind: "response";
  id: string | null;
  result?: unknown;
  error?: { code: string; message: string };
}
export interface BridgeEvent {
  channel: "richtextweb";
  version: 1;
  kind: "event";
  event: "ready" | "documentChanged" | "selectionChanged";
  payload: unknown;
}
export type BridgeOutgoingMessage = BridgeResponse | BridgeEvent;
export interface BridgeOptions {
  /** Number of UTF-16 code units accepted per incoming JSON message. Default 8 Mi. */
  maxMessageLength?: number;
  maxDocumentNodes?: number;
  maxDocumentDepth?: number;
  /** Optional host policy. All edit methods consult it before mutation. */
  isReadOnly?: () => boolean;
  /** Full documents are opt-in; default changed events carry state and revision only. */
  includeDocumentInEvents?: boolean;
}
class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const structuredEditingCommands: Readonly<Record<string, string>> = {
  moveselection: "moveSelection",
  moveblocks: "moveBlocks",
  setelementproperty: "setElementProperty",
  settableproperty: "setTableProperty",
  setcellproperty: "setCellProperty",
  mergetablecells: "mergeTableCells",
  splittablecell: "splitTableCell",
  editfloatingcontent: "editFloatingContent",
};
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function stringParam(params: Record<string, unknown>, name: string): string {
  if (typeof params[name] !== "string")
    throw new ProtocolError("invalid_params", `${name} must be a string`);
  return params[name] as string;
}
function integerParam(params: Record<string, unknown>, name: string): number {
  if (!Number.isSafeInteger(params[name]))
    throw new ProtocolError("invalid_params", `${name} must be a safe integer`);
  return params[name] as number;
}

/** Validates an incoming envelope and rejects prototype keys/cycles/non-JSON values. */
export function parseBridgeRequest(
  input: unknown,
  maxMessageLength = 8 * 1024 * 1024,
): BridgeRequest {
  let value = input;
  if (typeof input === "string") {
    if (input.length > maxMessageLength)
      throw new ProtocolError(
        "message_too_large",
        "Bridge message exceeds the configured size limit",
      );
    try {
      value = JSON.parse(input);
    } catch {
      throw new ProtocolError(
        "invalid_json",
        "Bridge message is not valid JSON",
      );
    }
  }
  let serialized: string;
  try {
    const active = new Set<object>();
    const visit = (current: unknown, depth: number): void => {
      if (depth > 128) throw new Error("Object is too deeply nested");
      if (
        current === null ||
        typeof current === "string" ||
        typeof current === "boolean"
      )
        return;
      if (typeof current === "number" && Number.isFinite(current)) return;
      if (
        typeof current !== "object" ||
        (!record(current) && !Array.isArray(current))
      )
        throw new Error("Only JSON values are allowed");
      if (active.has(current)) throw new Error("Cyclic object");
      active.add(current);
      for (const [key, child] of Object.entries(current)) {
        if (forbiddenKeys.has(key))
          throw new Error(`Forbidden property: ${key}`);
        visit(child, depth + 1);
      }
      active.delete(current);
    };
    visit(value, 0);
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new ProtocolError(
      "invalid_message",
      error instanceof Error ? error.message : "Invalid message",
    );
  }
  if (serialized.length > maxMessageLength)
    throw new ProtocolError(
      "message_too_large",
      "Bridge message exceeds the configured size limit",
    );
  if (
    !record(value) ||
    value.channel !== BridgeProtocol.channel ||
    value.version !== BridgeProtocol.version ||
    value.kind !== "request"
  ) {
    throw new ProtocolError(
      "invalid_envelope",
      "Expected a richtextweb version 1 request",
    );
  }
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 128 ||
    typeof value.method !== "string" ||
    value.method.length > 128
  ) {
    throw new ProtocolError(
      "invalid_envelope",
      "id and method must be nonempty bounded strings",
    );
  }
  if (value.params !== undefined && !record(value.params))
    throw new ProtocolError("invalid_params", "params must be an object");
  return value as unknown as BridgeRequest;
}
const nodeTypes = new Set([
  "FlowDocument",
  "Section",
  "Paragraph",
  "Run",
  "Span",
  "Bold",
  "Italic",
  "Underline",
  "Hyperlink",
  "LineBreak",
  "List",
  "ListItem",
  "Table",
  "TableRowGroup",
  "TableRow",
  "TableCell",
  "TableColumn",
  "InlineUIContainer",
  "BlockUIContainer",
  "Image",
  "Equation",
  "Figure",
  "Floater",
]);
function validateDocument(
  value: unknown,
  maxNodes: number,
  maxDepth: number,
  requireDocument = true,
): DocumentNode {
  let nodes = 0;
  const ids = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new ProtocolError(
        "document_too_large",
        "Document exceeds bridge node/depth limits",
      );
    if (
      !record(node) ||
      typeof node.type !== "string" ||
      !nodeTypes.has(node.type) ||
      typeof node.id !== "string" ||
      !node.id ||
      !record(node.props)
    ) {
      throw new ProtocolError(
        "invalid_document",
        "Every node requires a supported type, nonempty id and props object",
      );
    }
    if (ids.has(node.id))
      throw new ProtocolError(
        "invalid_document",
        `Duplicate node id: ${node.id}`,
      );
    ids.add(node.id);
    if (node.type === "Table" && node.props.Columns !== undefined) {
      if (!Array.isArray(node.props.Columns))
        throw new ProtocolError(
          "invalid_document",
          "Table Columns must be an array",
        );
      for (const column of node.props.Columns) {
        if (!record(column) || column.type !== "TableColumn")
          throw new ProtocolError(
            "invalid_document",
            "Table Columns must contain TableColumn nodes",
          );
        visit(column, depth + 1);
      }
    }
    if (node.text !== undefined && typeof node.text !== "string")
      throw new ProtocolError("invalid_document", "Node text must be a string");
    if (node.children !== undefined) {
      if (!Array.isArray(node.children))
        throw new ProtocolError(
          "invalid_document",
          "Node children must be an array",
        );
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (requireDocument && (value as DocumentNode).type !== "FlowDocument")
    throw new ProtocolError(
      "invalid_document",
      "Root node must be FlowDocument",
    );
  return value as DocumentNode;
}

const fieldTypes = new Set([
  "PAGE",
  "NUMPAGES",
  "DATE",
  "TIME",
  "REF",
  "PAGEREF",
  "MERGEFIELD",
  "SEQ",
  "TITLE",
  "AUTHOR",
  "FILENAME",
]);
const storyKinds = new Set([
  "Headers",
  "Footers",
  "FirstPageHeader",
  "FirstPageFooter",
  "EvenPageHeader",
  "EvenPageFooter",
]);
const noteKinds = new Set(["Footnote", "Endnote"]);
function optionalString(
  params: Record<string, unknown>,
  name: string,
): string | undefined {
  return params[name] === undefined ? undefined : stringParam(params, name);
}
function enumParam<T extends string>(
  params: Record<string, unknown>,
  name: string,
  allowed: Set<string>,
): T {
  const value = stringParam(params, name);
  if (!allowed.has(value))
    throw new ProtocolError("invalid_params", `Unsupported ${name}: ${value}`);
  return value as T;
}
/** Native callers supply date strings and page maps, never executable resolver callbacks. */
function fieldContext(value: unknown): FieldContext {
  if (value === undefined) return {};
  if (!record(value))
    throw new ProtocolError("invalid_params", "context must be an object");
  const context: FieldContext = {};
  const allowed = new Set([
    "PageNumber",
    "PageCount",
    "Now",
    "Locale",
    "Data",
    "FileName",
    "PageMap",
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      throw new ProtocolError(
        "invalid_params",
        `Unsupported field context member: ${key}`,
      );
  for (const key of ["PageNumber", "PageCount"] as const) {
    if (value[key] !== undefined) {
      const number = integerParam(value, key);
      if (number < 1)
        throw new ProtocolError("invalid_params", `${key} must be positive`);
      context[key] = number;
    }
  }
  if (value.Now !== undefined) {
    const date = stringParam(value, "Now");
    if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)))
      throw new ProtocolError(
        "invalid_params",
        "Now must be an ISO date/time string",
      );
    context.Now = new Date(date);
  }
  if (value.Locale !== undefined) context.Locale = stringParam(value, "Locale");
  if (value.FileName !== undefined)
    context.FileName = stringParam(value, "FileName");
  if (value.Data !== undefined) {
    if (!record(value.Data))
      throw new ProtocolError("invalid_params", "Data must be an object");
    context.Data = value.Data;
  }
  if (value.PageMap !== undefined) {
    if (!record(value.PageMap))
      throw new ProtocolError(
        "invalid_params",
        "PageMap must map node IDs to positive page numbers",
      );
    const pages = value.PageMap;
    for (const [id, page] of Object.entries(pages))
      if (!id || !Number.isSafeInteger(page) || Number(page) < 1)
        throw new ProtocolError(
          "invalid_params",
          "PageMap values must be positive integers",
        );
    context.PageOfNode = (id) => pages[id] as number | undefined;
  }
  return context;
}
function tocOptions(value: unknown): TableOfContentsOptions {
  if (value === undefined) return {};
  if (!record(value))
    throw new ProtocolError("invalid_params", "options must be an object");
  const options: TableOfContentsOptions = {};
  for (const name of Object.keys(value))
    if (!["MaxLevel", "Title", "IncludePageNumbers"].includes(name))
      throw new ProtocolError(
        "invalid_params",
        `Unsupported TOC option: ${name}`,
      );
  if (value.MaxLevel !== undefined) {
    const level = integerParam(value, "MaxLevel");
    if (level < 1 || level > 9)
      throw new ProtocolError("invalid_params", "MaxLevel must be 1–9");
    options.MaxLevel = level;
  }
  if (value.Title !== undefined) options.Title = stringParam(value, "Title");
  if (value.IncludePageNumbers !== undefined) {
    if (typeof value.IncludePageNumbers !== "boolean")
      throw new ProtocolError(
        "invalid_params",
        "IncludePageNumbers must be a boolean",
      );
    options.IncludePageNumbers = value.IncludePageNumbers;
  }
  return options;
}

/** Owns only its subscriptions, never the supplied engine. No eval or arbitrary member access. */
export class RichTextWebBridge implements IDisposable {
  readonly TransportError = new ObservableEvent<unknown>();
  private readonly subscriptions: IDisposable[] = [];
  private disposed = false;
  private readonly maxMessageLength: number;
  private readonly maxNodes: number;
  private readonly maxDepth: number;
  constructor(
    readonly Engine: RichTextEngine,
    private readonly postMessage: (message: BridgeOutgoingMessage) => void,
    private readonly options: BridgeOptions = {},
  ) {
    this.maxMessageLength = options.maxMessageLength ?? 8 * 1024 * 1024;
    this.maxNodes = options.maxDocumentNodes ?? 100_000;
    this.maxDepth = options.maxDocumentDepth ?? 64;
    for (const limit of [this.maxMessageLength, this.maxNodes, this.maxDepth])
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new RangeError("Bridge limits must be positive integers");
    this.subscriptions.push(
      Engine.Changed.Subscribe(() =>
        this.emit("documentChanged", {
          ...this.GetState(),
          ...(this.options.includeDocumentInEvents
            ? { document: this.Engine.Document.ToJSON() }
            : {}),
        }),
      ),
    );
    this.subscriptions.push(
      Engine.SelectionChanged.Subscribe(() =>
        this.emit("selectionChanged", this.selection()),
      ),
    );
  }
  private send(message: BridgeOutgoingMessage): void {
    if (this.disposed) return;
    try {
      this.postMessage(message);
    } catch (error) {
      this.TransportError.Emit(error);
    }
  }
  private emit(event: BridgeEvent["event"], payload: unknown): void {
    this.send({ ...BridgeProtocol, kind: "event", event, payload });
  }
  private selection(): { start: number; end: number; text: string } {
    return {
      start: this.Engine.Selection.Start.Offset,
      end: this.Engine.Selection.End.Offset,
      text: this.Engine.Selection.Text,
    };
  }
  GetState(): {
    revision: number;
    textLength: number;
    canUndo: boolean;
    canRedo: boolean;
    readOnly: boolean;
    selection: { start: number; end: number; text: string };
  } {
    return {
      revision: this.Engine.Document.Revision,
      textLength: this.Engine.Document.Text.length,
      canUndo: this.Engine.CanUndo,
      canRedo: this.Engine.CanRedo,
      readOnly: this.options.isReadOnly?.() ?? false,
      selection: this.selection(),
    };
  }
  NotifyReady(): void {
    this.emit("ready", this.GetState());
  }
  /** JSON equivalents of structural engine operations. No executable callbacks cross the bridge. */
  private editStructure(method: string, params: Record<string, unknown>): void {
    const property = (): string => {
      const name = stringParam(params, "name");
      if (forbiddenKeys.has(name) || !/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(name))
        throw new ProtocolError(
          "invalid_params",
          "Property name must be an identifier",
        );
      if (!Object.hasOwn(params, "value"))
        throw new ProtocolError("invalid_params", "Property value is required");
      return name;
    };
    switch (method) {
      case "moveSelection": {
        const destination = integerParam(params, "destination");
        if (destination < 0 || destination > this.Engine.Document.Text.length)
          throw new ProtocolError(
            "invalid_params",
            "Destination must be inside the document",
          );
        this.Engine.MoveSelection(destination);
        break;
      }
      case "moveBlocks": {
        if (
          !Array.isArray(params.ids) ||
          !params.ids.length ||
          params.ids.length > this.maxNodes ||
          !params.ids.every((id) => typeof id === "string" && id.length > 0) ||
          new Set(params.ids).size !== params.ids.length
        )
          throw new ProtocolError(
            "invalid_params",
            "ids must be a nonempty array of unique node IDs",
          );
        this.Engine.MoveBlocks(
          params.ids as string[],
          stringParam(params, "parentId"),
          integerParam(params, "index"),
        );
        break;
      }
      case "setElementProperty":
        this.Engine.SetElementProperty(
          stringParam(params, "id"),
          property(),
          params.value,
        );
        break;
      case "setTableProperty":
        this.Engine.SetTableProperty(property(), params.value);
        break;
      case "setCellProperty":
        this.Engine.SetCellProperty(property(), params.value);
        break;
      case "mergeTableCells": {
        const count =
          params.count === undefined ? 2 : integerParam(params, "count");
        if (count < 2)
          throw new ProtocolError(
            "invalid_params",
            "count must be at least two",
          );
        this.Engine.MergeTableCells(count);
        break;
      }
      case "splitTableCell":
        this.Engine.SplitTableCell();
        break;
      case "editFloatingContent": {
        const id = stringParam(params, "id"),
          target = this.Engine.Document.FindById(id);
        if (!target || !["Figure", "Floater"].includes(target.Type))
          throw new ProtocolError(
            "invalid_params",
            "Target must be a Figure or Floater",
          );
        if (!Array.isArray(params.blocks))
          throw new ProtocolError(
            "invalid_params",
            "blocks must be a document node array",
          );
        const replacement = new FlowDocument().ToJSON();
        replacement.children = params.blocks;
        validateDocument(replacement, this.maxNodes, this.maxDepth);
        // Canonical model construction validates parent/child categories and typed properties before any edit begins.
        let canonical: DocumentNode[];
        try {
          canonical =
            FlowDocument.FromJSON(replacement).ToJSON().children ?? [];
        } catch (error) {
          throw new ProtocolError(
            "invalid_document",
            error instanceof Error ? error.message : "Invalid floating story",
          );
        }
        const oldIds = new Set<string>();
        const visit = (
          node: DocumentNode,
          action: (node: DocumentNode) => void,
        ): void => {
          action(node);
          for (const child of node.children ?? []) visit(child, action);
          if (node.type === "Table")
            for (const column of node.props.Columns ?? [])
              visit(column, action);
        };
        for (const child of target.ToJSON().children ?? [])
          visit(child, (node) => oldIds.add(node.id));
        for (const child of canonical)
          visit(child, (node) => {
            if (this.Engine.Document.FindById(node.id) && !oldIds.has(node.id))
              throw new ProtocolError(
                "invalid_document",
                `Floating story node ID conflicts with the main document: ${node.id}`,
              );
          });
        this.Engine.EditFloatingContent(id, (story) => {
          const snapshot = story.Document.ToJSON();
          snapshot.children = canonical;
          story.ReplaceDocument(FlowDocument.FromJSON(snapshot));
        });
        break;
      }
      default:
        throw new ProtocolError(
          "unknown_method",
          `Unknown structured edit: ${method}`,
        );
    }
  }
  /** Returns a response, without posting it. Events caused by an edit are still posted. */
  HandleMessage(input: unknown): BridgeResponse {
    let id: string | null = null;
    try {
      if (this.disposed)
        throw new ProtocolError("disposed", "Bridge is disposed");
      const request = parseBridgeRequest(input, this.maxMessageLength);
      id = request.id;
      const params = request.params ?? {};
      const mutating = new Set([
        "setDocument",
        "insertText",
        "insertNode",
        "deleteBackward",
        "deleteForward",
        "applyProperty",
        "setParagraphProperty",
        "undo",
        "redo",
        "execute",
        "insertField",
        "updateFields",
        "setStory",
        "insertNote",
        "updateNote",
        "insertTableOfContents",
        "updateTableOfContents",
        ...Object.values(structuredEditingCommands),
      ]);
      if (mutating.has(request.method)) {
        if (this.options.isReadOnly?.())
          throw new ProtocolError(
            "read_only",
            "The host document is read-only",
          );
        if (
          params.expectedRevision !== undefined &&
          integerParam(params, "expectedRevision") !==
            this.Engine.Document.Revision
        )
          throw new ProtocolError(
            "revision_conflict",
            "The document has changed since the expected revision",
          );
      }
      const features = new DocumentFeatures(this.Engine);
      const blocks = (value: unknown): DocumentNode[] => {
        if (!Array.isArray(value))
          throw new ProtocolError(
            "invalid_params",
            "blocks must be a document node array",
          );
        const root = new FlowDocument().ToJSON();
        root.children = value;
        return (
          validateDocument(root, this.maxNodes, this.maxDepth).children ?? []
        );
      };
      let result: unknown;
      switch (request.method) {
        case "getDocument":
          result = this.Engine.Document.ToJSON();
          break;
        case "getText":
          result = this.Engine.Document.Text;
          break;
        case "getState":
          result = this.GetState();
          break;
        case "getReviewState":
          result = {
            trackChanges: this.Engine.TrackChanges,
            currentAuthor: this.Engine.CurrentAuthor,
            revisions: this.Engine.Revisions,
          };
          break;
        case "insertField":
          features.InsertField(
            enumParam<FieldType>(params, "type", fieldTypes),
            optionalString(params, "argument") ?? "",
            optionalString(params, "format"),
          );
          result = this.GetState();
          break;
        case "updateFields":
          result = features.UpdateFields(fieldContext(params.context));
          break;
        case "setStory":
          features.SetStory(
            enumParam<StoryKind>(params, "kind", storyKinds),
            blocks(params.blocks),
            optionalString(params, "sectionId"),
          );
          result = this.GetState();
          break;
        case "insertNote":
          result = {
            id: features.InsertNote(
              enumParam<NoteKind>(params, "kind", noteKinds),
              typeof params.content === "string"
                ? params.content
                : blocks(params.content),
            ),
          };
          break;
        case "updateNote":
          features.UpdateNote(
            enumParam<NoteKind>(params, "kind", noteKinds),
            stringParam(params, "id"),
            stringParam(params, "content"),
          );
          result = this.GetState();
          break;
        case "insertTableOfContents":
          features.InsertTableOfContents(
            tocOptions(params.options),
            fieldContext(params.context),
          );
          result = this.GetState();
          break;
        case "updateTableOfContents":
          result = {
            updated: features.UpdateTableOfContents(
              fieldContext(params.context),
            ),
          };
          break;
        case "mailMerge": {
          if (
            params.expectedRevision !== undefined &&
            integerParam(params, "expectedRevision") !==
              this.Engine.Document.Revision
          )
            throw new ProtocolError(
              "revision_conflict",
              "The merge template has changed since the expected revision",
            );
          if (
            !Array.isArray(params.records) ||
            params.records.length > 1000 ||
            !params.records.every(record)
          )
            throw new ProtocolError(
              "invalid_params",
              "records must be an array of at most 1000 JSON objects",
            );
          const context = fieldContext(params.context);
          if (context.Data !== undefined)
            throw new ProtocolError(
              "invalid_params",
              "Mail merge data must be supplied in records",
            );
          const documents: DocumentNode[] = [];
          let outputSize = 2;
          for (const data of params.records) {
            const merged = features.MailMerge([data], context)[0]!.ToJSON();
            outputSize += JSON.stringify(merged).length + 1;
            if (outputSize > this.maxMessageLength)
              throw new ProtocolError(
                "message_too_large",
                "Merged documents exceed the bridge output budget; use smaller batches",
              );
            documents.push(merged);
          }
          result = documents;
          break;
        }
        case "setDocument":
          this.Engine.SetDocument(
            FlowDocument.FromJSON(
              validateDocument(params.document, this.maxNodes, this.maxDepth),
            ),
          );
          result = this.GetState();
          break;
        case "select": {
          const start = integerParam(params, "start");
          const end = integerParam(params, "end");
          if (
            start < 0 ||
            end < 0 ||
            start > this.Engine.Document.Text.length ||
            end > this.Engine.Document.Text.length
          )
            throw new ProtocolError(
              "invalid_params",
              "Selection offsets must be inside the document",
            );
          this.Engine.Select(start, end);
          result = this.selection();
          break;
        }
        case "insertText":
          this.Engine.InsertText(stringParam(params, "text"));
          result = this.GetState();
          break;
        case "insertNode":
          this.Engine.InsertNode(
            validateDocument(params.node, this.maxNodes, this.maxDepth, false),
          );
          result = this.GetState();
          break;
        case "deleteBackward":
          this.Engine.DeleteBackward();
          result = this.GetState();
          break;
        case "deleteForward":
          this.Engine.DeleteForward();
          result = this.GetState();
          break;
        case "applyProperty":
        case "setParagraphProperty": {
          const name = stringParam(params, "name");
          if (
            forbiddenKeys.has(name) ||
            !/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(name)
          )
            throw new ProtocolError(
              "invalid_params",
              "Property name must be an identifier",
            );
          if (!Object.prototype.hasOwnProperty.call(params, "value"))
            throw new ProtocolError(
              "invalid_params",
              "Property value is required",
            );
          if (request.method === "applyProperty")
            this.Engine.ApplyProperty(name, params.value);
          else this.Engine.SetParagraphProperty(name, params.value);
          result = this.GetState();
          break;
        }
        case "moveSelection":
        case "moveBlocks":
        case "setElementProperty":
        case "setTableProperty":
        case "setCellProperty":
        case "mergeTableCells":
        case "splitTableCell":
        case "editFloatingContent":
          this.editStructure(request.method, params);
          result = this.GetState();
          break;
        case "undo":
          this.Engine.Undo();
          result = this.GetState();
          break;
        case "redo":
          this.Engine.Redo();
          result = this.GetState();
          break;
        case "execute": {
          const command = stringParam(params, "command");
          const normalized = command
            .replace(/^(EditingCommands|ApplicationCommands)\./, "")
            .replace(/[\s_-]/g, "")
            .toLowerCase();
          const structured = Object.hasOwn(
            structuredEditingCommands,
            normalized,
          )
            ? structuredEditingCommands[normalized]
            : undefined;
          if (structured) {
            const value = params.parameter;
            const parameter = record(value) ? value : {};
            // Preserve the engine's PascalCase DTO conventions and scalar move/merge overloads.
            const converted: Record<string, unknown> = {};
            for (const [source, target] of [
              ["Id", "id"],
              ["Ids", "ids"],
              ["ParentId", "parentId"],
              ["Index", "index"],
              ["Name", "name"],
              ["Value", "value"],
              ["Destination", "destination"],
              ["Count", "count"],
              ["Blocks", "blocks"],
            ])
              if (Object.hasOwn(parameter, source!))
                converted[target!] = parameter[source!];
            if (structured === "moveSelection" && typeof value === "number")
              converted.destination = value;
            if (structured === "mergeTableCells" && typeof value === "number")
              converted.count = value;
            if (
              structured !== "splitTableCell" &&
              structured !== "mergeTableCells" &&
              !record(value) &&
              typeof value !== "number"
            )
              throw new ProtocolError(
                "invalid_params",
                "Structured editing command requires a JSON parameter object",
              );
            if (
              structured === "mergeTableCells" &&
              value !== undefined &&
              value !== null &&
              !record(value) &&
              typeof value !== "number"
            )
              throw new ProtocolError(
                "invalid_params",
                "MergeTableCells requires a count",
              );
            this.editStructure(structured, converted);
          } else {
            // Engine Execute validates command names; it never reflects into arbitrary object methods.
            this.Engine.Execute(command, params.parameter);
          }
          result = this.GetState();
          break;
        }
        default:
          throw new ProtocolError(
            "unknown_method",
            `Unknown bridge method: ${request.method}`,
          );
      }
      return { ...BridgeProtocol, kind: "response", id, result };
    } catch (error) {
      return {
        ...BridgeProtocol,
        kind: "response",
        id,
        error: {
          code:
            error instanceof ProtocolError ? error.code : "operation_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  Receive(input: unknown): BridgeResponse {
    const response = this.HandleMessage(input);
    this.send(response);
    return response;
  }
  Dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.Dispose();
    this.TransportError.Clear();
  }
}

export interface WebViewMessageHost {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}
/** Explicit WebView2 attachment. Does not attach untrusted window.postMessage listeners. */
export function connectWebView2(
  engine: RichTextEngine,
  host: WebViewMessageHost,
  options?: BridgeOptions,
): RichTextWebBridge & { Dispose(): void } {
  const bridge = new RichTextWebBridge(
    engine,
    (message) => host.postMessage(message),
    options,
  );
  const listener = (event: { data: unknown }) => bridge.Receive(event.data);
  host.addEventListener("message", listener);
  const dispose = bridge.Dispose.bind(bridge);
  bridge.Dispose = () => {
    host.removeEventListener("message", listener);
    dispose();
  };
  bridge.NotifyReady();
  return bridge;
}

/** Avalonia/other hosts call receiveRichTextWebMessage(JSON); native outbound is explicitly injected. */
export function connectScriptHost(
  engine: RichTextEngine,
  globalObject: Record<string, unknown>,
  sendToNative: (json: string) => void,
  options?: BridgeOptions,
): RichTextWebBridge {
  const name = "receiveRichTextWebMessage";
  if (Object.prototype.hasOwnProperty.call(globalObject, name))
    throw new Error(`${name} is already installed`);
  const bridge = new RichTextWebBridge(
    engine,
    (message) => sendToNative(JSON.stringify(message)),
    options,
  );
  const receive = (message: unknown) => bridge.Receive(message);
  globalObject[name] = receive;
  const cleanup = new Subscription(() => {
    if (globalObject[name] === receive) delete globalObject[name];
  });
  const dispose = bridge.Dispose.bind(bridge);
  bridge.Dispose = () => {
    cleanup.Dispose();
    dispose();
  };
  bridge.NotifyReady();
  return bridge;
}
