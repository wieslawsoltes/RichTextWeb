import {
  Equation,
  EventDispatcher,
  FlowDocument,
  Run,
  TextPointer,
  type DocumentNode,
} from "./model.js";
import {
  clone,
  deleteRange,
  effectiveProps,
  formatRange,
  inlineText,
  insertText,
  leaves,
  makeNode,
  mapMetadata,
  newIds,
  plainText,
  pointBlock,
  run,
  sliceInlines,
  textBlocks,
  uid,
} from "./engine-tree.js";

import {
  DocumentObserverError,
  CreateDocumentPatch,
  InvertDocumentPatch,
  ApplyDocumentPatch,
  ApplyPatchToJSON,
  ReconcileDocument,
  PatchByteLength,
  type DocumentPatch,
} from "./history.js";

export interface FindOptions {
  MatchCase?: boolean;
  WholeWord?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  Start?: number;
}
export interface FindResult {
  Start: number;
  End: number;
  Text: string;
}
export interface DocumentAnnotation {
  Id: string;
  Kind: "Comment" | "Bookmark" | string;
  Start: number;
  End: number;
  Data: Record<string, any>;
}
export interface RevisionPropertyChange {
  Scope: "Inline" | "Node";
  NodeId?: string;
  Start?: number;
  End?: number;
  Name: string;
  HadBefore: boolean;
  Before?: unknown;
  HasAfter: boolean;
  After?: unknown;
}
export interface EngineChangedEvent {
  Engine: RichTextEngine;
  Document: FlowDocument;
  Revision: number;
}
export interface SelectionChangedEvent {
  Engine: RichTextEngine;
  Start: number;
  End: number;
}
interface CursorState {
  start: number;
  end: number;
  typing: Record<string, any>;
}
interface TextEditSpan {
  Start: number;
  RemovedLength: number;
  InsertedLength: number;
}
interface HistoryEntry {
  patch: DocumentPatch;
  before: CursorState;
  after: CursorState;
  textChanges?: TextEditSpan[];
}
interface Snapshot {
  document: DocumentNode;
  start: number;
  end: number;
  typing: Record<string, any>;
}
const INLINE_TYPES = new Set([
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
]);
const BLOCK_TYPES = new Set([
  "Paragraph",
  "Section",
  "List",
  "Table",
  "BlockUIContainer",
]);
const INLINE_PROPERTIES = new Set([
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "FontStretch",
  "Foreground",
  "Background",
  "TextDecorations",
  "BaselineAlignment",
  "Typography",
  "Language",
]);
const wordCharacter = (text: string) => /[\p{L}\p{N}_]/u.test(text);
const validOffset = (value: number, length: number) => {
  if (!Number.isInteger(value) || value < 0 || value > length)
    throw new RangeError(`Text offset ${value} is outside 0..${length}.`);
  return value;
};

/** WPF-shaped range API using UTF-16 plain-text offsets rather than WPF symbols. */
export class TextRange {
  protected _start: TextPointer;
  protected _end: TextPointer;
  protected owner?: RichTextEngine;
  constructor(start: TextPointer, end: TextPointer) {
    if (start.Document !== end.Document)
      throw new Error("TextRange endpoints must belong to the same document.");
    this._start = start.Offset <= end.Offset ? start : end;
    this._end = start.Offset <= end.Offset ? end : start;
  }
  get Start(): TextPointer {
    return this._start;
  }
  get End(): TextPointer {
    return this._end;
  }
  get IsEmpty(): boolean {
    return this.Start.Offset === this.End.Offset;
  }
  get Text(): string {
    return this.Start.Document.Text.slice(this.Start.Offset, this.End.Offset);
  }
  set Text(value: string) {
    this.withEngine((engine) => engine.InsertText(value));
  }
  ApplyPropertyValue(
    property: string | { Name: string },
    value: unknown,
  ): void {
    this.withEngine((engine) =>
      engine.ApplyProperty(
        typeof property === "string" ? property : property.Name,
        value,
      ),
    );
  }
  GetPropertyValue(property: string | { Name: string }): unknown {
    const name = typeof property === "string" ? property : property.Name;
    if (this.owner) return this.owner.GetProperty(name);
    return propertyInRange(
      this.Start.Document.ToJSON(),
      this.Start.Offset,
      this.End.Offset,
      name,
      this.Start.Document.GetValue(name),
    );
  }
  protected withEngine(action: (engine: RichTextEngine) => void): void {
    const engine = this.owner ?? new RichTextEngine(this.Start.Document);
    if (!this.owner) engine.Select(this.Start.Offset, this.End.Offset);
    try {
      action(engine);
      if (!this.owner) {
        this._start = new TextPointer(
          engine.Document,
          engine.Selection.Start.Offset,
        );
        this._end = new TextPointer(
          engine.Document,
          engine.Selection.End.Offset,
        );
      }
    } finally {
      if (!this.owner) engine.Dispose();
    }
  }
}

export class TextSelection extends TextRange {
  constructor(engine: RichTextEngine) {
    super(
      new TextPointer(engine.Document, 0),
      new TextPointer(engine.Document, 0),
    );
    this.owner = engine;
  }
  override get Start(): TextPointer {
    return new TextPointer(this.owner!.Document, this.owner!.SelectionStart);
  }
  override get End(): TextPointer {
    return new TextPointer(this.owner!.Document, this.owner!.SelectionEnd);
  }
  Select(start: TextPointer | number, end: TextPointer | number): void {
    for (const pointer of [start, end])
      if (
        typeof pointer !== "number" &&
        pointer.Document !== this.owner!.Document
      )
        throw new Error("Selection endpoint belongs to another document.");
    this.owner!.Select(
      typeof start === "number" ? start : start.Offset,
      typeof end === "number" ? end : end.Offset,
    );
  }
  SelectAll(): void {
    this.owner!.Select(0, this.owner!.Document.Text.length);
  }
}

function propertyInRange(
  root: DocumentNode,
  start: number,
  end: number,
  name: string,
  defaultValue?: unknown,
): unknown {
  const list = leaves(root);
  const selected =
    start === end
      ? [
          list.find((item) => item.start < start && item.end >= start) ??
            list.find((item) => item.start === start),
        ].filter(Boolean)
      : list.filter((item) => item.end > start && item.start < end);
  if (!selected.length) return root.props[name] ?? defaultValue;
  const resolve = (item: (typeof list)[number]) =>
    item.props[name] === undefined ? defaultValue : item.props[name];
  const value = resolve(selected[0]!);
  return selected.every(
    (item) => JSON.stringify(resolve(item!)) === JSON.stringify(value),
  )
    ? value
    : undefined;
}

/** Framework-independent editing, selection, undo, search, and document structure. */
export class RichTextEngine {
  private _document: FlowDocument;
  readonly Selection: TextSelection;
  readonly Changed = new EventDispatcher<EngineChangedEvent>();
  readonly SelectionChanged = new EventDispatcher<SelectionChangedEvent>();
  private subscription: { Dispose(): void };
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private typing: Record<string, any> = {};
  private start = 0;
  private end = 0;
  private depth = 0;
  private batch?: Snapshot;
  private batchTokens?: number[];
  private batchTokensValid = true;
  private disposed = false;
  UndoLimit = 100;
  /** Track text, formatting, moves, and document structure as reviewable changes. */
  TrackChanges = false;
  TrackFormatting = true;
  private historySuppressed = 0;
  CurrentAuthor = "Author";
  private reviewSuppressed = 0;

  get Revisions(): DocumentAnnotation[] {
    return this.Annotations.filter((item) =>
      [
        "Insertion",
        "Deletion",
        "Formatting",
        "Move",
        "TableStructure",
        "Structural",
      ].includes(item.Kind),
    );
  }

  constructor(document = new FlowDocument()) {
    this._document = document;
    this.Selection = new TextSelection(this);
    this.subscription = this.subscribe(document);
  }
  get Document(): FlowDocument {
    return this._document;
  }
  get SelectionStart(): number {
    return this.start;
  }
  get SelectionEnd(): number {
    return this.end;
  }
  CaptureSelectionState(): {
    Start: number;
    End: number;
    TypingProperties: Record<string, any>;
  } {
    return {
      Start: this.start,
      End: this.end,
      TypingProperties: clone(this.typing),
    };
  }
  RestoreSelectionState(state: {
    Start: number;
    End: number;
    TypingProperties: Record<string, any>;
  }): void {
    this.Select(
      Math.min(state.Start, this.Document.Text.length),
      Math.min(state.End, this.Document.Text.length),
    );
    this.typing = clone(state.TypingProperties);
    this.emitSelection();
  }
  ResetInsertionFormatting(): void {
    this.typing = {};
  }
  get CanUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get CanRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get HistoryStatistics(): {
    UndoEntries: number;
    RedoEntries: number;
    RetainedBytes: number;
  } {
    return {
      UndoEntries: this.undoStack.length,
      RedoEntries: this.redoStack.length,
      RetainedBytes: [...this.undoStack, ...this.redoStack].reduce(
        (sum, item) => sum + PatchByteLength(item.patch),
        0,
      ),
    };
  }
  get Annotations(): DocumentAnnotation[] {
    return clone(this.Document.ToJSON().props.Annotations ?? []);
  }
  private assertLive(): void {
    if (this.disposed) throw new Error("RichTextEngine is disposed.");
  }
  private subscribe(document: FlowDocument): { Dispose(): void } {
    return document.Changed.Subscribe(() => {
      this.start = Math.min(this.start, document.Text.length);
      this.end = Math.min(this.end, document.Text.length);
      this.Changed.Emit({
        Engine: this,
        Document: document,
        Revision: document.Revision,
      });
    });
  }
  Select(start: number, end = start): void {
    this.assertLive();
    validOffset(start, this.Document.Text.length);
    validOffset(end, this.Document.Text.length);
    const from = Math.min(start, end),
      to = Math.max(start, end);
    if (from === this.start && to === this.end) return;
    this.start = from;
    this.end = to;
    this.typing = {};
    this.SelectionChanged.Emit({ Engine: this, Start: from, End: to });
  }
  SetDocument(document: FlowDocument): void {
    this.assertLive();
    if (this.depth)
      throw new Error(
        "Cannot replace the document during a change transaction.",
      );
    this.subscription.Dispose();
    this._document = document;
    this.subscription = this.subscribe(document);
    this.start = 0;
    this.end = 0;
    this.typing = {};
    this.ClearUndo();
    this.Changed.Emit({
      Engine: this,
      Document: document,
      Revision: document.Revision,
    });
    this.emitSelection();
  }
  /** Replace all content while retaining the document object, subscribers, and undo. */
  ReplaceDocument(
    document: FlowDocument,
    options?: { MapAnnotations?: boolean; TextChanges?: TextEditSpan[] },
  ): void {
    this.mutate(
      (root) => {
        const replacement = clone(document.ToJSON());
        root.props = replacement.props;
        root.children = replacement.children;
        root.text = replacement.text;
      },
      options?.MapAnnotations !== false,
      options?.TextChanges,
    );
  }
  /** Apply an incoming collaborative state without making it a local undo entry.
   * Prior local history is cleared because contextual patches are not selectively rebased.
   */
  ApplyRemoteDocument(
    document: FlowDocument,
    options?: { MapAnnotations?: boolean; TextChanges?: TextEditSpan[] },
  ): void {
    if (this.depth)
      throw new Error(
        "Finish the local change transaction before applying a remote document.",
      );
    this.historySuppressed++;
    try {
      this.ReplaceDocument(document, {
        ...options,
        MapAnnotations: options?.MapAnnotations ?? false,
      });
      this.ClearUndo();
    } catch (error) {
      if (error instanceof DocumentObserverError) this.ClearUndo();
      throw error;
    } finally {
      this.historySuppressed--;
    }
  }
  BeginChange(): void {
    this.assertLive();
    if (this.depth++ === 0) {
      this.batch = this.snapshot();
      this.batchTokens = Array.from(
        { length: plainText(this.batch.document).length },
        (_, index) => index,
      );
      this.batchTokensValid = true;
      this.Document.BeginChange();
    }
  }
  EndChange(): void {
    this.assertLive();
    if (!this.depth)
      throw new Error("EndChange requires a matching BeginChange.");
    if (--this.depth === 0) {
      if (
        this.batch &&
        JSON.stringify(this.batch.document) !==
          JSON.stringify(this.Document.ToJSON())
      )
        this.record(
          this.batch,
          this.Document.ToJSON(),
          this.batchTokensValid && this.batchTokens
            ? spansFromTokens(
                this.batchTokens,
                plainText(this.batch.document),
                this.Document.Text,
              )
            : undefined,
        );
      this.batch = undefined;
      this.batchTokens = undefined;
      this.Document.EndChange();
    }
  }
  Change(action: () => void): void {
    this.BeginChange();
    try {
      action();
    } finally {
      this.EndChange();
    }
  }
  ClearUndo(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
  Undo(): boolean {
    this.assertLive();
    if (this.depth)
      throw new Error("Finish the change transaction before undo.");
    const entry = this.undoStack.at(-1);
    if (!entry) return false;
    const old = this.cursor();
    this.setCursor(entry.before);
    let observerError: DocumentObserverError | undefined;
    try {
      if (entry.textChanges)
        this.Document.SetPendingTextChanges(inverseSpans(entry.textChanges));
      ApplyDocumentPatch(this.Document, InvertDocumentPatch(entry.patch));
    } catch (error) {
      if (error instanceof DocumentObserverError) observerError = error;
      else {
        this.Document.SetPendingTextChanges([]);
        this.setCursor(old);
        throw error;
      }
    }
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.emitSelection();
    if (observerError) throw observerError;
    return true;
  }
  Redo(): boolean {
    this.assertLive();
    if (this.depth)
      throw new Error("Finish the change transaction before redo.");
    const entry = this.redoStack.at(-1);
    if (!entry) return false;
    const old = this.cursor();
    this.setCursor(entry.after);
    let observerError: DocumentObserverError | undefined;
    try {
      if (entry.textChanges)
        this.Document.SetPendingTextChanges(entry.textChanges);
      ApplyDocumentPatch(this.Document, entry.patch);
    } catch (error) {
      if (error instanceof DocumentObserverError) observerError = error;
      else {
        this.Document.SetPendingTextChanges([]);
        this.setCursor(old);
        throw error;
      }
    }
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.emitSelection();
    if (observerError) throw observerError;
    return true;
  }
  private cursor(): CursorState {
    return { start: this.start, end: this.end, typing: clone(this.typing) };
  }
  private setCursor(state: CursorState): void {
    this.start = state.start;
    this.end = state.end;
    this.typing = clone(state.typing);
  }
  private snapshot(): Snapshot {
    return { ...this.cursor(), document: this.Document.ToJSON() };
  }
  private record(
    state: Snapshot,
    after = this.Document.ToJSON(),
    textChanges?: TextEditSpan[],
  ): void {
    const patch = CreateDocumentPatch(state.document, after);
    if (!patch || this.historySuppressed) return;
    this.undoStack.push({
      patch,
      before: { start: state.start, end: state.end, typing: state.typing },
      after: this.cursor(),
      ...(textChanges?.length ? { textChanges } : {}),
    });
    if (this.undoStack.length > Math.max(0, this.UndoLimit))
      this.undoStack.splice(
        0,
        this.undoStack.length - Math.max(0, this.UndoLimit),
      );
    this.redoStack = [];
  }
  private emitSelection(): void {
    this.SelectionChanged.Emit({
      Engine: this,
      Start: this.start,
      End: this.end,
    });
  }
  private mutate(
    action: (root: DocumentNode) => void,
    mapStructure = true,
    exactTextChange?: TextEditSpan | TextEditSpan[],
    review?: { Kind: string; Operation: string; Data?: Record<string, any> },
  ): void {
    this.assertLive();
    const before = this.snapshot(),
      root = clone(before.document);
    try {
      action(root);
      if (mapStructure) mapStructuralAnnotations(before.document, root);
      if (
        review &&
        this.TrackChanges &&
        (review.Kind !== "Formatting" || this.TrackFormatting) &&
        !this.reviewSuppressed
      ) {
        const old = clone(before.document),
          next = clone(root);
        delete old.props.Annotations;
        delete next.props.Annotations;
        const patch = CreateDocumentPatch(old, next);
        if (patch)
          (root.props.Annotations ??= []).push({
            Id: uid(),
            Kind: review.Kind,
            Start: Math.min(this.start, plainText(root).length),
            End: Math.min(this.end, plainText(root).length),
            Data: {
              Author: this.CurrentAuthor,
              CreatedAt: new Date().toISOString(),
              Operation: review.Operation,
              RestorePatch: InvertDocumentPatch(patch),
              StructureAnchors: captureStructureAnchors(
                root,
                InvertDocumentPatch(patch),
              ),
              ...clone(review.Data ?? {}),
            },
          });
      }
      const document = FlowDocument.FromJSON(root);
      if (
        JSON.stringify(before.document) !== JSON.stringify(document.ToJSON())
      ) {
        const spans = exactTextChange
          ? Array.isArray(exactTextChange)
            ? exactTextChange
            : [exactTextChange]
          : undefined;
        const exact =
          spans &&
          document.Text.length ===
            plainText(before.document).length +
              spans.reduce(
                (sum, span) => sum + span.InsertedLength - span.RemovedLength,
                0,
              )
            ? spans
            : undefined;
        if (!this.depth) this.record(before, document.ToJSON(), exact);
        if (exact) {
          this.Document.SetPendingTextChanges(exact);
          if (this.depth && this.batchTokens)
            for (const span of [...exact].reverse())
              this.batchTokens = [
                ...this.batchTokens.slice(0, span.Start),
                ...Array(span.InsertedLength).fill(-1),
                ...this.batchTokens.slice(span.Start + span.RemovedLength),
              ];
        } else if (plainText(before.document) !== document.Text && this.depth)
          this.batchTokensValid = false;
        ReconcileDocument(this.Document, document.ToJSON());
        if (exact) this.Document.GetSymbolMap();
      }
      const length = this.Document.Text.length;
      this.start = Math.min(this.start, length);
      this.end = Math.max(this.start, Math.min(this.end, length));
      this.emitSelection();
    } catch (error) {
      if (error instanceof DocumentObserverError) throw error;
      this.start = before.start;
      this.end = before.end;
      this.typing = before.typing;
      throw error;
    }
  }
  InsertText(text: string): void {
    if (typeof text !== "string")
      throw new TypeError("InsertText expects a string.");
    this.assertLive();
    if (!text && this.start === this.end) return;
    text = text.replace(/\r\n?/g, "\n");
    if (this.tryDirectTextEdit(text)) return;
    const props = this.insertionProperties();
    this.mutate(
      (root) => {
        const from = this.start,
          to = this.end,
          previousLength = plainText(root).length;
        const tracked = this.TrackChanges && !this.reviewSuppressed;
        const deletion =
          tracked && to > from ? captureDeletion(root, from, to) : undefined;
        deleteRange(root, from, to);
        const position = Math.min(from, plainText(root).length);
        this.start = this.end = text
          ? insertText(root, position, text, props)
          : position;
        mapMetadata(
          root,
          from,
          to,
          plainText(root).length - previousLength + to - from,
        );
        if (tracked) {
          const CreatedAt = new Date().toISOString(),
            Author = this.CurrentAuthor;
          if (deletion)
            (root.props.Annotations ??= []).push({
              Id: uid(),
              Kind: "Deletion",
              Start: position,
              End: position,
              Data: { Author, CreatedAt, ...deletion },
            });
          if (text)
            (root.props.Annotations ??= []).push({
              Id: uid(),
              Kind: "Insertion",
              Start: position,
              End: position + text.length,
              Data: { Author, CreatedAt, Text: text },
            });
        }
      },
      false,
      {
        Start: this.start,
        RemovedLength: this.end - this.start,
        InsertedLength: text.length,
      },
    );
  }
  /** Common typing path: no detached document or whole-tree reconciliation. */
  private tryDirectTextEdit(text: string): boolean {
    if (this.depth || this.TrackChanges || text.includes("\n")) return false;
    const annotations = this.Document.GetValue("Annotations");
    if (Array.isArray(annotations) && annotations.length) return false;
    const segments = this.Document.GetSymbolMap().Segments;
    const segment =
      segments.find(
        (item) =>
          item.Element instanceof Run &&
          item.TextStart < this.start &&
          item.TextEnd >= this.end,
      ) ??
      segments.find(
        (item) =>
          item.Element instanceof Run &&
          item.TextStart === this.start &&
          item.TextEnd >= this.end &&
          item.Context === "Text",
      );
    if (
      !segment ||
      !(segment.Element instanceof Run) ||
      segment.Context !== "Text"
    )
      return false;
    const run = segment.Element;
    if (
      Object.entries(this.typing).some(
        ([name, value]) => !sameValue(run.GetValue(name), value),
      )
    )
      return false;
    const local = this.start - segment.TextStart,
      removed = this.end - this.start,
      value = run.Text;
    const next = value.slice(0, local) + text + value.slice(local + removed);
    const before = this.cursor();
    if (next === value) {
      this.start = this.end = this.start + text.length;
      this.emitSelection();
      return true;
    }
    const oldNode = run.ToJSON(),
      newNode = { ...oldNode, text: next };
    let change = CreateDocumentPatch(oldNode, newNode)!.Change;
    for (let parent = run.Parent; parent; parent = parent.Parent)
      change = { Id: parent.Id, Type: parent.Type, Descendants: [change] };
    const patch: DocumentPatch = {
      Version: 1,
      RootId: this.Document.Id,
      Change: change,
    };
    const span = {
      Start: this.start,
      RemovedLength: removed,
      InsertedLength: text.length,
    };
    this.start = this.end = this.start + text.length;
    const entry = { patch, before, after: this.cursor(), textChanges: [span] };
    const oldRedo = this.redoStack;
    if (!this.historySuppressed) {
      this.undoStack.push(entry);
      this.redoStack = [];
    }
    try {
      this.Document.SetPendingTextChanges([span]);
      run.Text = next;
    } catch (error) {
      if (run.Text !== next) {
        if (!this.historySuppressed) {
          this.undoStack.pop();
          this.redoStack = oldRedo;
        }
        this.setCursor(before);
        this.Document.SetPendingTextChanges([]);
        throw error;
      }
      // The model commits before dispatching observers, matching the general mutation path.
      this.trimUndo();
      this.emitSelection();
      throw error instanceof DocumentObserverError
        ? error
        : new DocumentObserverError([error]);
    }
    this.trimUndo();
    this.emitSelection();
    return true;
  }
  private trimUndo(): void {
    const limit = Math.max(0, this.UndoLimit);
    if (this.undoStack.length > limit)
      this.undoStack.splice(0, this.undoStack.length - limit);
  }
  AcceptRevision(id: string): void {
    const item = this.Revisions.find((change) => change.Id === id);
    if (!item) throw new Error(`Revision ${id} was not found.`);
    this.RemoveAnnotation(id);
  }
  RejectRevision(id: string): void {
    const item = this.Revisions.find((change) => change.Id === id);
    if (!item) throw new Error(`Revision ${id} was not found.`);
    if (
      ["Formatting", "Move", "TableStructure", "Structural"].includes(item.Kind)
    ) {
      this.mutate((root) => {
        if (Array.isArray(item.Data.PropertyChanges)) {
          const changes = item.Data.PropertyChanges as RevisionPropertyChange[];
          // Validate all targets first: an incompatible later edit must not be overwritten.
          for (const change of changes) validateRevisionProperty(root, change);
          for (const change of [...changes].reverse()) {
            const value = change.HadBefore ? change.Before : undefined;
            if (change.Scope === "Inline")
              formatRange(root, change.Start!, change.End!, change.Name, value);
            else
              setLocalProperty(
                findNode(root, change.NodeId!)!,
                change.Name,
                value,
              );
          }
        } else if (Array.isArray(item.Data.StructureChanges)) {
          for (const change of item.Data.StructureChanges) {
            const parent = findNode(root, change.ParentId);
            if (!parent || !Array.isArray(parent.children))
              throw new Error(
                "Revision conflict: table container no longer exists.",
              );
            const removed: DocumentNode[] = change.Removed ?? [],
              inserted: DocumentNode[] = change.Inserted ?? [];
            let index = change.Index;
            if (removed.length) {
              index = parent.children.findIndex((node, at, children) =>
                removed.every((old, i) => children[at + i]?.id === old.id),
              );
              if (
                index < 0 ||
                !sameValue(
                  parent.children.slice(index, index + removed.length),
                  removed,
                )
              )
                throw new Error(
                  "Revision conflict: table content has changed.",
                );
            }
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index > parent.children.length ||
              inserted.some((node) => findNode(root, node.id))
            )
              throw new Error(
                "Revision conflict: table restoration context is invalid.",
              );
            parent.children.splice(index, removed.length, ...clone(inserted));
          }
        } else if (item.Data.RestorePatch) {
          const restored = ApplyPatchToJSON(
            root,
            relocateRevisionPatch(
              root,
              item.Data.RestorePatch,
              item.Data.StructureAnchors,
            ),
          );
          root.props = restored.props;
          root.children = restored.children;
          root.text = restored.text;
        } else if (item.Kind === "Move" && Array.isArray(item.Data.Nodes)) {
          if (
            plainText(root).slice(item.Start, item.End) !== item.Data.Text ||
            !Number.isInteger(item.Data.SourceStart)
          )
            throw new Error(
              "Revision conflict: moved content no longer matches its source.",
            );
          const preview = new RichTextEngine(FlowDocument.FromJSON(root));
          try {
            preview.Select(item.Start, item.End);
            preview.InsertText("");
            const source =
              item.Data.SourceStart > item.End
                ? item.Data.SourceStart - (item.End - item.Start)
                : item.Data.SourceStart;
            preview.Select(source);
            preview.InsertFragment(item.Data.Nodes);
            const restored = preview.Document.ToJSON();
            root.props = restored.props;
            root.children = restored.children;
          } finally {
            preview.Dispose();
          }
        } else
          throw new Error(
            "Revision conflict: this revision has no supported restoration data.",
          );
        root.props.Annotations = (root.props.Annotations ?? []).filter(
          (entry: DocumentAnnotation) => entry.Id !== id,
        );
      });
      return;
    }
    if (
      item.Kind === "Insertion" &&
      item.Data.Text !== undefined &&
      this.Document.Text.slice(item.Start, item.End) !== item.Data.Text
    )
      throw new Error(
        "Revision conflict: inserted text has been edited; resolve dependent revisions before rejecting this insertion.",
      );
    if (item.Kind === "Insertion") {
      const check = this.Document.ToJSON(),
        length = this.Document.Text.length;
      deleteRange(check, item.Start, item.End);
      if (plainText(check).length !== length - (item.End - item.Start))
        throw new Error(
          "Revision conflict: an insertion crosses protected structural boundaries.",
        );
    }
    this.Change(() => {
      this.reviewSuppressed++;
      try {
        if (item.Kind === "Insertion") {
          this.Select(item.Start, item.End);
          this.InsertText("");
        } else if (Array.isArray(item.Data.Segments)) {
          this.mutate((root) => {
            const blocks = textBlocks(root);
            const locations = item.Data.Segments.map((segment: any) => {
              const block = blocks.find(
                (candidate) => candidate.node.id === segment.BlockId,
              );
              if (
                !block ||
                block.node.type !== "Paragraph" ||
                segment.Offset > block.text.length ||
                block.text !== segment.RemainingText
              )
                throw new Error(
                  "Revision conflict: a deleted-text container has changed or is no longer available.",
                );
              return { block, segment };
            });
            for (const { block, segment } of locations.reverse()) {
              block.node.children = [
                ...sliceInlines(block.node.children ?? [], 0, segment.Offset),
                ...segment.Inlines.map(newIds),
                ...sliceInlines(
                  block.node.children ?? [],
                  segment.Offset,
                  inlineText(block.node).length,
                  true,
                ),
              ];
            }
          });
        } else {
          this.Select(item.Start, item.Start);
          if (Array.isArray(item.Data.Nodes) && item.Data.Nodes.length)
            this.InsertFragment(item.Data.Nodes);
          else this.InsertText(String(item.Data.Text ?? ""));
        }
        this.RemoveAnnotation(id);
      } finally {
        this.reviewSuppressed--;
      }
    });
  }
  AcceptAllRevisions(): void {
    this.Change(() => {
      for (const item of this.Revisions) this.AcceptRevision(item.Id);
    });
  }
  RejectAllRevisions(): void {
    // Work newest-first so a replacement's insertion is rejected before its
    // deletion is restored, and dependent edits unwind in their original order.
    // Preflight the entire dependency chain on a detached document so a late
    // conflict cannot leave an earlier revision rejected in the live document.
    const preview = new RichTextEngine(
      FlowDocument.FromJSON(this.Document.ToJSON()),
    );
    try {
      for (const item of [...preview.Revisions].reverse())
        preview.RejectRevision(item.Id);
    } finally {
      preview.Dispose();
    }
    this.Change(() => {
      for (const item of [...this.Revisions].reverse())
        this.RejectRevision(item.Id);
    });
  }
  ReplaceSelection(text: string): void {
    this.InsertText(text);
  }
  InsertParagraph(): void {
    this.InsertText("\n");
  }
  DeleteBackward(): void {
    this.deleteDirection(-1, false);
  }
  DeleteForward(): void {
    this.deleteDirection(1, false);
  }
  DeleteWordBackward(): void {
    this.deleteDirection(-1, true);
  }
  DeleteWordForward(): void {
    this.deleteDirection(1, true);
  }
  private deleteDirection(direction: -1 | 1, word: boolean): void {
    this.assertLive();
    if (this.start !== this.end) {
      this.InsertText("");
      return;
    }
    const text = this.Document.Text,
      at = this.start;
    if ((direction < 0 && at === 0) || (direction > 0 && at === text.length))
      return;
    const segmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, {
            granularity: word ? "word" : "grapheme",
          })
        : undefined;
    let boundary: number;
    if (segmenter) {
      const items = Array.from(segmenter.segment(text));
      if (direction < 0) {
        let index = items.length - 1;
        while (index >= 0 && items[index].index >= at) index--;
        if (word)
          while (index > 0 && /^\s+$/u.test(items[index].segment)) index--;
        boundary = items[Math.max(0, index)]?.index ?? 0;
      } else {
        let index = items.findIndex(
          (item) => item.index + item.segment.length > at,
        );
        if (word)
          while (
            index < items.length - 1 &&
            /^\s+$/u.test(items[index].segment)
          )
            index++;
        const item = items[index];
        boundary = item ? item.index + item.segment.length : text.length;
      }
    } else {
      const points = Array.from(text);
      let position = 0;
      const boundaries = [0];
      for (const point of points) {
        position += point.length;
        boundaries.push(position);
      }
      boundary =
        direction < 0
          ? (boundaries.filter((value) => value < at).at(-1) ?? 0)
          : (boundaries.find((value) => value > at) ?? text.length);
    }
    const previousStart = this.start,
      previousEnd = this.end;
    this.start = Math.min(at, boundary);
    this.end = Math.max(at, boundary);
    const selection = [this.start, this.end];
    this.InsertText("");
    // Undo should restore the user's caret, not the internal deletion selection.
    const last = this.undoStack.at(-1);
    if (
      !this.depth &&
      last &&
      last.before.start === selection[0] &&
      last.before.end === selection[1]
    ) {
      last.before.start = previousStart;
      last.before.end = previousEnd;
    }
  }
  private insertionProperties(): Record<string, any> {
    const list = leaves(this.Document.ToJSON());
    const leaf =
      list.find((item) => item.start < this.start && item.end >= this.start) ??
      list.find((item) => item.start === this.start);
    const inherited = leaf?.props ?? this.Document.ToJSON().props;
    return Object.fromEntries(
      Object.entries({ ...inherited, ...this.typing }).filter(([key]) =>
        INLINE_PROPERTIES.has(key),
      ),
    );
  }
  GetProperty(name: string): unknown {
    return this.start === this.end && name in this.typing
      ? this.typing[name]
      : propertyInRange(
          this.Document.ToJSON(),
          this.start,
          this.end,
          name,
          this.Document.GetValue(name),
        );
  }
  private formatMutation(
    operation: string,
    changes: RevisionPropertyChange[],
    action: (root: DocumentNode) => void,
  ): void {
    this.mutate((root) => {
      action(root);
      if (
        this.TrackChanges &&
        this.TrackFormatting &&
        !this.reviewSuppressed &&
        changes.length
      )
        (root.props.Annotations ??= []).push({
          Id: uid(),
          Kind: "Formatting",
          Start: this.start,
          End: this.end,
          Data: {
            Author: this.CurrentAuthor,
            CreatedAt: new Date().toISOString(),
            Operation: operation,
            PropertyChanges: clone(changes),
          },
        });
    });
  }
  ApplyProperty(name: string, value: unknown): void {
    this.assertLive();
    if (!name || typeof name !== "string")
      throw new TypeError("A property name is required.");
    if (this.start === this.end) {
      this.typing[name] = clone(value);
      this.emitSelection();
      return;
    }
    const changes = captureInlineProperties(
      this.Document.ToJSON(),
      this.start,
      this.end,
      name,
      value,
    );
    if (!changes.length) return;
    this.formatMutation("ApplyProperty", changes, (root) =>
      formatRange(root, this.start, this.end, name, value),
    );
  }
  ToggleFormat(
    name: string,
    value: unknown = true,
    offValue: unknown = false,
  ): void {
    this.ApplyProperty(
      name,
      this.GetProperty(name) === value ? offValue : value,
    );
  }
  SetParagraphProperty(name: string, value: unknown): void {
    const selected = this.selectedBlocks(this.Document.ToJSON());
    const changes = selected.flatMap(({ node }) =>
      captureNodeProperty(node, name, value),
    );
    if (!changes.length) return;
    this.formatMutation("SetParagraphProperty", changes, (root) => {
      for (const block of this.selectedBlocks(root))
        setLocalProperty(block.node, name, value);
    });
  }
  private selectedBlocks(root: DocumentNode) {
    const blocks = textBlocks(root);
    return blocks.filter((block) =>
      this.start === this.end
        ? block.start <= this.start && block.end >= this.start
        : block.end >= this.start && block.start < this.end,
    );
  }
  ClearFormatting(): void {
    if (this.start === this.end) {
      this.typing = Object.fromEntries(
        [...INLINE_PROPERTIES]
          .map((name) => [name, this.Document.GetValue(name)])
          .filter(([, value]) => value !== undefined),
      );
      this.emitSelection();
      return;
    }
    this.typing = {};
    this.mutate(
      (root) => {
        const strip = (items: DocumentNode[]): DocumentNode[] =>
          items.flatMap((item) => {
            for (const name of INLINE_PROPERTIES) delete item.props[name];
            if (item.children) item.children = strip(item.children);
            return ["Bold", "Italic", "Underline"].includes(item.type)
              ? (item.children ?? [])
              : [item];
          });
        for (const block of this.selectedBlocks(root)) {
          if (block.node.type !== "Paragraph") continue;
          const from = Math.max(0, this.start - block.start),
            to = Math.min(block.text.length, this.end - block.start);
          block.node.children = [
            ...sliceInlines(block.node.children ?? [], 0, from),
            ...strip(
              sliceInlines(block.node.children ?? [], from, to, from > 0),
            ),
            ...sliceInlines(
              block.node.children ?? [],
              to,
              block.text.length,
              true,
            ),
          ];
        }
      },
      true,
      undefined,
      { Kind: "Formatting", Operation: "ClearFormatting" },
    );
  }
  InsertNode(node: DocumentNode): string {
    return this.InsertFragment([node])[0];
  }
  InsertFragment(nodes: DocumentNode[]): string[] {
    if (!Array.isArray(nodes))
      throw new TypeError("InsertFragment expects an array of document nodes.");
    const list = nodes.flatMap((node) =>
      node.type === "FlowDocument" ? (node.children ?? []) : [node],
    );
    if (
      list.some(
        (node) => !INLINE_TYPES.has(node.type) && !BLOCK_TYPES.has(node.type),
      )
    )
      throw new Error("Only inline or block document nodes can be inserted.");
    if (!list.length) return [];
    const allInline = list.every((node) => INLINE_TYPES.has(node.type));
    if (!allInline && list.some((node) => INLINE_TYPES.has(node.type)))
      throw new Error(
        "A fragment must contain either inline nodes or block nodes.",
      );
    let insertedIds: string[] = [];
    this.mutate(
      (root) => {
        const from = this.start,
          to = this.end,
          oldLength = plainText(root).length;
        deleteRange(root, from, to);
        const block = pointBlock(root, Math.min(from, plainText(root).length));
        const inserted = list.map(newIds);
        insertedIds = inserted.map((node) => node.id);
        if (block.node.type !== "Paragraph")
          throw new Error(
            "Select a text paragraph before inserting a fragment.",
          );
        const local = Math.max(0, from - block.start),
          before = sliceInlines(block.node.children ?? [], 0, local),
          after = sliceInlines(
            block.node.children ?? [],
            local,
            block.text.length,
            true,
          );
        if (allInline) {
          block.node.children = [...before, ...inserted, ...after];
          this.start = this.end =
            from + inserted.map(inlineText).join("").length;
        } else {
          // Paragraph fragments join at the caret; structural blocks retain their
          // block boundary and are surrounded only when text requires it.
          const replacement: DocumentNode[] = [];
          if (inserted[0].type === "Paragraph")
            inserted[0].children = [...before, ...(inserted[0].children ?? [])];
          else if (before.length)
            replacement.push({ ...clone(block.node), children: before });
          replacement.push(...inserted);
          const tail = inserted.at(-1)!;
          const tailTextBefore = inlineText(tail).length;
          if (tail.type === "Paragraph")
            tail.children = [...(tail.children ?? []), ...after];
          else if (after.length)
            replacement.push(
              local === 0
                ? clone(block.node)
                : makeNode("Paragraph", after, clone(block.node.props)),
            );
          block.parent.children!.splice(block.index, 1, ...replacement);
          const resultingBlocks = textBlocks(root);
          const tailBlock =
            tail.type === "Paragraph"
              ? resultingBlocks.find((item) => item.node === tail)
              : resultingBlocks
                  .filter((item) => containsNode(tail, item.node.id))
                  .at(-1);
          this.start = this.end = tailBlock
            ? tail.type === "Paragraph"
              ? tailBlock.start + tailTextBefore
              : tailBlock.end
            : Math.min(from, plainText(root).length);
        }
        mapMetadata(
          root,
          from,
          to,
          plainText(root).length - oldLength + to - from,
        );
      },
      false,
      undefined,
      {
        Kind: list.some((node) => node.type === "Table")
          ? "TableStructure"
          : "Structural",
        Operation: "InsertFragment",
      },
    );
    return insertedIds;
  }
  /** Insert vector-rendered mathematical content as a single undoable atom. */
  InsertEquation(
    source: string,
    format: "latex" | "mathml" = "latex",
    displayMode = false,
  ): string {
    const equation = new Equation(source, format, displayMode);
    return this.InsertNode(equation.ToJSON());
  }
  UpdateEquation(
    elementId: string,
    source: string,
    format: "latex" | "mathml" = "latex",
    displayMode = false,
  ): void {
    const target = this.Document.FindById(elementId);
    if (!target || target.Type !== "Equation")
      throw new TypeError("The target equation does not exist.");
    const checked = new Equation(source, format, displayMode);
    this.BeginChange();
    try {
      this.SetElementProperty(elementId, "EquationSource", checked.Source);
      this.SetElementProperty(elementId, "EquationFormat", checked.Format);
      this.SetElementProperty(elementId, "DisplayMode", checked.DisplayMode);
    } finally {
      this.EndChange();
    }
  }
  InsertPageBreak(): void {
    this.BeginChange();
    try {
      this.InsertParagraph();
      this.SetParagraphProperty("BreakPageBefore", true);
      this.SetParagraphProperty("BreakColumnBefore", false);
    } finally {
      this.EndChange();
    }
  }
  InsertColumnBreak(): void {
    this.BeginChange();
    try {
      this.InsertParagraph();
      this.SetParagraphProperty("BreakColumnBefore", true);
      this.SetParagraphProperty("BreakPageBefore", false);
    } finally {
      this.EndChange();
    }
  }
  InsertImage(
    source: string,
    alternativeText = "",
    width?: number,
    height?: number,
  ): void {
    this.InsertNode(
      makeNode("Image", [], {
        Source: source,
        AlternativeText: alternativeText,
        ...(width === undefined ? {} : { Width: width }),
        ...(height === undefined ? {} : { Height: height }),
      }),
    );
  }
  InsertTable(rows = 2, columns = 2): void {
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(columns) ||
      rows < 1 ||
      columns < 1 ||
      rows * columns > 10000
    )
      throw new RangeError(
        "Table dimensions must be positive integers with at most 10,000 cells.",
      );
    this.InsertNode(
      makeNode("Table", [
        makeNode(
          "TableRowGroup",
          Array.from({ length: rows }, () =>
            makeNode(
              "TableRow",
              Array.from({ length: columns }, () =>
                makeNode("TableCell", [makeNode("Paragraph")]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
  InsertHyperlink(uri: string, text = this.Selection.Text || uri): void {
    this.InsertNode(
      makeNode("Hyperlink", [run(text, this.insertionProperties())], {
        NavigateUri: uri,
      }),
    );
  }
  GetSelectedFragment(): FlowDocument {
    const root = this.Document.ToJSON(),
      ranges = new Map(textBlocks(root).map((block) => [block.node.id, block]));
    const extract = (item: DocumentNode): DocumentNode | undefined => {
      const block = ranges.get(item.id);
      if (block) {
        if (
          this.start === this.end ||
          block.end < this.start ||
          block.start >= this.end
        )
          return undefined;
        const copy = clone(item);
        if (item.type === "Paragraph")
          copy.children = sliceInlines(
            item.children ?? [],
            Math.max(0, this.start - block.start),
            Math.min(block.text.length, this.end - block.start),
          );
        return copy;
      }
      const children = (item.children ?? [])
        .map(extract)
        .filter((value): value is DocumentNode => !!value);
      return children.length ? { ...clone(item), children } : undefined;
    };
    return FlowDocument.FromJSON({
      ...clone(root),
      props: { ...root.props, Annotations: [] },
      children: (root.children ?? [])
        .map(extract)
        .filter((value): value is DocumentNode => !!value),
    });
  }
  RemoveHyperlink(): void {
    this.mutate(
      (root) => {
        for (const block of this.selectedBlocks(root)) {
          if (block.node.type !== "Paragraph") continue;
          const start = Math.max(0, this.start - block.start),
            end = Math.min(block.text.length, this.end - block.start);
          if (this.start === this.end) {
            let position = block.start;
            const unwrapAt = (items: DocumentNode[]): DocumentNode[] =>
              items.flatMap((item) => {
                const at = position,
                  length = inlineText(item).length;
                if (this.start < at || this.start > at + length) {
                  position += length;
                  return [item];
                }
                if (item.type === "Hyperlink") {
                  position += length;
                  return item.children ?? [];
                }
                if (item.children) item.children = unwrapAt(item.children);
                else position += length;
                return [item];
              });
            block.node.children = unwrapAt(block.node.children ?? []);
          } else {
            const unwrap = (items: DocumentNode[]): DocumentNode[] =>
              items.flatMap((item) => {
                if (item.children) item.children = unwrap(item.children);
                return item.type === "Hyperlink"
                  ? (item.children ?? [])
                  : [item];
              });
            block.node.children = [
              ...sliceInlines(block.node.children ?? [], 0, start),
              ...unwrap(
                sliceInlines(block.node.children ?? [], start, end, start > 0),
              ),
              ...sliceInlines(
                block.node.children ?? [],
                end,
                block.text.length,
                true,
              ),
            ];
          }
        }
      },
      true,
      undefined,
      { Kind: "Formatting", Operation: "RemoveHyperlink" },
    );
  }
  Indent(amount = 24): void {
    if (!Number.isFinite(amount))
      throw new RangeError("Indent amount must be finite.");
    this.mutate(
      (root) => {
        for (const block of this.selectedBlocks(root))
          block.node.props.TextIndent = Math.max(
            0,
            Number(block.node.props.TextIndent ?? 0) + amount,
          );
      },
      true,
      undefined,
      { Kind: "Formatting", Operation: "Indent" },
    );
  }
  SetElementProperty(id: string, name: string, value: unknown): void {
    if (!name || typeof name !== "string")
      throw new TypeError("A property name is required.");
    const node = findNode(this.Document.ToJSON(), id);
    if (!node) throw new Error(`Element ${id} was not found.`);
    const changes = captureNodeProperty(node, name, value);
    if (!changes.length) return;
    this.formatMutation("SetElementProperty", changes, (root) =>
      setLocalProperty(findNode(root, id)!, name, value),
    );
  }
  SetTableProperty(name: string, value: unknown): void {
    this.SetElementProperty(
      tableContext(this.Document.ToJSON(), this.start).table.id,
      name,
      value,
    );
  }
  SetCellProperty(name: string, value: unknown): void {
    this.SetElementProperty(
      tableContext(this.Document.ToJSON(), this.start).cell.id,
      name,
      value,
    );
  }
  /** Edit the independent text story hosted by a Figure/Floater, as one parent undo/review operation. */
  EditFloatingContent(
    id: string,
    action: (story: RichTextEngine) => void,
  ): void {
    if (typeof action !== "function")
      throw new TypeError("A story editing action is required.");
    const target = findNode(this.Document.ToJSON(), id);
    if (!target || !["Figure", "Floater"].includes(target.type))
      throw new Error("The target must be a Figure or Floater.");
    const story = new RichTextEngine(
      FlowDocument.FromJSON(
        makeNode("FlowDocument", clone(target.children ?? []), {
          ...Object.fromEntries(
            Object.entries(target.props).filter(([key]) =>
              INLINE_PROPERTIES.has(key),
            ),
          ),
          Annotations: clone(target.props.StoryAnnotations ?? []),
        }),
      ),
    );
    try {
      const outcome = action(story) as unknown;
      if (outcome && typeof (outcome as { then?: unknown }).then === "function")
        throw new TypeError(
          "EditFloatingContent requires a synchronous action; prepare asynchronous content before opening the transaction.",
        );
      const next = story.Document.ToJSON();
      this.mutate(
        (root) => {
          const node = findNode(root, id)!;
          node.children = next.children;
          if (next.props.Annotations?.length)
            node.props.StoryAnnotations = next.props.Annotations;
          else delete node.props.StoryAnnotations;
        },
        false,
        undefined,
        {
          Kind: "Structural",
          Operation: "EditFloatingContent",
          Data: { ElementId: id },
        },
      );
    } finally {
      story.Dispose();
    }
  }
  /** Move rich selected content to a UTF-16 position measured before the move. */
  MoveSelection(destination: number): void {
    validOffset(destination, this.Document.Text.length);
    if (
      this.start === this.end ||
      (destination >= this.start && destination <= this.end)
    )
      return;
    const from = this.start,
      to = this.end,
      text = this.Selection.Text;
    const preview = new RichTextEngine(
      FlowDocument.FromJSON(this.Document.ToJSON()),
    );
    try {
      preview.Select(from, to);
      const nodes = preview.GetSelectedFragment().ToJSON().children ?? [];
      const oldLength = preview.Document.Text.length;
      preview.InsertText("");
      if (preview.Document.Text.length !== oldLength - (to - from))
        throw new Error(
          "Moving a text selection cannot cross protected table or list boundaries; use MoveBlocks for structural moves.",
        );
      const target = destination > to ? destination - (to - from) : destination;
      preview.Select(target);
      preview.InsertFragment(nodes);
      const movedEnd = preview.SelectionEnd;
      const replacement = preview.Document.ToJSON();
      this.mutate(
        (root) => {
          root.props = replacement.props;
          root.children = replacement.children;
          this.start = target;
          this.end = movedEnd;
        },
        false,
        undefined,
        {
          Kind: "Move",
          Operation: "MoveSelection",
          Data: {
            Text: text,
            Nodes: nodes,
            SourceStart: destination < from ? from + movedEnd - target : from,
          },
        },
      );
    } finally {
      preview.Dispose();
    }
  }
  /** Move contiguous block siblings while preserving their live model identities. */
  MoveBlocks(ids: string[], parentId: string, index: number): void {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      throw new TypeError("MoveBlocks requires unique block IDs.");
    this.mutate(
      (root) => {
        const first = findNode(root, ids[0]!),
          source = first && findParent(root, first.id),
          target = findNode(root, parentId);
        if (
          !first ||
          !source ||
          !target ||
          ![
            "FlowDocument",
            "Section",
            "ListItem",
            "TableCell",
            "Figure",
            "Floater",
          ].includes(target.type)
        )
          throw new Error("Invalid block move source or destination.");
        const start = source.children!.indexOf(first);
        const moving = source.children!.slice(start, start + ids.length);
        if (
          moving.some(
            (node, at) => node.id !== ids[at] || !BLOCK_TYPES.has(node.type),
          ) ||
          moving.length !== ids.length
        )
          throw new Error("MoveBlocks requires contiguous block siblings.");
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index > (target.children?.length ?? 0)
        )
          throw new RangeError("Block insertion index is out of range.");
        if (moving.some((node) => containsNode(node, target.id)))
          throw new Error("A block cannot be moved into its own descendants.");
        if (
          source === target &&
          index >= start &&
          index <= start + moving.length
        )
          return;
        source.children!.splice(start, moving.length);
        const at =
          source === target && index > start ? index - moving.length : index;
        (target.children ??= []).splice(at, 0, ...moving);
        const selected = textBlocks(root).filter((block) =>
          moving.some((node) => containsNode(node, block.node.id)),
        );
        if (selected.length) {
          this.start = selected[0]!.start;
          this.end = selected.at(-1)!.end;
        }
      },
      true,
      undefined,
      { Kind: "Move", Operation: "MoveBlocks", Data: { NodeIds: clone(ids) } },
    );
  }
  /** Merge adjacent cells on the current row, keeping all rich block contents. */
  MergeTableCells(count = 2): void {
    if (!Number.isInteger(count) || count < 2)
      throw new RangeError(
        "MergeTableCells requires at least two adjacent cells.",
      );
    this.mutate(
      (root) => {
        const { row, cell } = tableContext(root, this.start),
          index = row.children!.indexOf(cell),
          cells = row.children!.slice(index, index + count);
        if (
          cells.length !== count ||
          cells.some(
            (item) => (item.props.RowSpan ?? 1) !== (cell.props.RowSpan ?? 1),
          )
        )
          throw new Error(
            "Merged cells must be adjacent and have the same row span.",
          );
        cell.props.ColumnSpan = cells.reduce(
          (sum, item) => sum + (Number(item.props.ColumnSpan) || 1),
          0,
        );
        cell.children = cells.flatMap((item) => item.children ?? []);
        row.children!.splice(index + 1, count - 1);
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "MergeTableCells" },
    );
  }
  /** Split a merged cell into its existing grid slots; contents stay in the first cell. */
  SplitTableCell(): void {
    this.mutate(
      (root) => {
        const { table, cell } = tableContext(root, this.start),
          grid = buildTableGrid(table),
          origin = grid.origins.get(cell.id)!;
        if (origin.width === 1 && origin.height === 1) return;
        delete cell.props.ColumnSpan;
        delete cell.props.RowSpan;
        for (let y = origin.row; y < origin.row + origin.height; y++) {
          const row = grid.rows[y]!;
          for (let x = origin.column; x < origin.column + origin.width; x++) {
            if (y === origin.row && x === origin.column) continue;
            const next = makeNode("TableCell", [makeNode("Paragraph")], {
              ...clone(cell.props),
            });
            const before = row.children!.findIndex(
              (candidate) =>
                (grid.origins.get(candidate.id)?.column ??
                  Number.POSITIVE_INFINITY) > x,
            );
            row.children!.splice(
              before < 0 ? row.children!.length : before,
              0,
              next,
            );
            grid.origins.set(next.id, {
              node: next,
              row: y,
              column: x,
              width: 1,
              height: 1,
            });
          }
        }
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "SplitTableCell" },
    );
  }
  InsertTableRow(before = false): void {
    this.mutate(
      (root) => {
        const { table, group, row } = tableContext(root, this.start),
          grid = buildTableGrid(table);
        if ((grid.rows.length + 1) * grid.width > 10000)
          throw new RangeError("Table limit is 10,000 grid cells.");
        const at = grid.rows.indexOf(row) + (before ? 0 : 1),
          covered = new Set<number>();
        for (const origin of grid.origins.values())
          if (origin.row < at && origin.row + origin.height > at) {
            origin.node.props.RowSpan = origin.height + 1;
            for (let x = origin.column; x < origin.column + origin.width; x++)
              covered.add(x);
          }
        const cells: DocumentNode[] = [];
        for (let x = 0; x < grid.width; x++)
          if (!covered.has(x)) {
            const props = clone(
              grid.slots[Math.min(at, grid.rows.length - 1)]![x]!.props,
            );
            delete props.RowSpan;
            delete props.ColumnSpan;
            cells.push(makeNode("TableCell", [makeNode("Paragraph")], props));
          }
        group.children!.splice(
          group.children!.indexOf(row) + (before ? 0 : 1),
          0,
          makeNode("TableRow", cells, clone(row.props)),
        );
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "InsertTableRow" },
    );
  }
  DeleteTableRow(): void {
    this.mutate(
      (root) => {
        const { table, group, row } = tableContext(root, this.start),
          grid = buildTableGrid(table),
          at = grid.rows.indexOf(row);
        for (const origin of grid.origins.values()) {
          if (origin.row < at && origin.row + origin.height > at)
            origin.node.props.RowSpan = origin.height - 1;
          else if (origin.row === at && origin.height > 1) {
            origin.node.props.RowSpan = origin.height - 1;
            const next = grid.rows[at + 1]!;
            const index = next.children!.findIndex(
              (cell) => grid.origins.get(cell.id)!.column > origin.column,
            );
            next.children!.splice(
              index < 0 ? next.children!.length : index,
              0,
              origin.node,
            );
          }
        }
        group.children!.splice(group.children!.indexOf(row), 1);
        if (!findTableRows(table).length)
          replaceTableWithParagraph(root, table);
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "DeleteTableRow" },
    );
  }
  InsertTableColumn(before = false): void {
    this.mutate(
      (root) => {
        const { table, cell } = tableContext(root, this.start),
          grid = buildTableGrid(table),
          selected = grid.origins.get(cell.id)!,
          at = selected.column + (before ? 0 : selected.width);
        if (grid.rows.length * (grid.width + 1) > 10000)
          throw new RangeError("Table limit is 10,000 grid cells.");
        const covered = new Set<number>();
        for (const origin of grid.origins.values())
          if (origin.column < at && origin.column + origin.width > at) {
            origin.node.props.ColumnSpan = origin.width + 1;
            for (let y = origin.row; y < origin.row + origin.height; y++)
              covered.add(y);
          }
        grid.rows.forEach((row, y) => {
          if (covered.has(y)) return;
          const props = clone(
            grid.slots[y]![Math.min(at, grid.width - 1)]!.props,
          );
          delete props.RowSpan;
          delete props.ColumnSpan;
          const index = row.children!.findIndex(
            (candidate) => grid.origins.get(candidate.id)!.column >= at,
          );
          row.children!.splice(
            index < 0 ? row.children!.length : index,
            0,
            makeNode("TableCell", [makeNode("Paragraph")], props),
          );
        });
        if (Array.isArray(table.props.Columns) && table.props.Columns.length)
          table.props.Columns.splice(at, 0, makeNode("TableColumn"));
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "InsertTableColumn" },
    );
  }
  DeleteTableColumn(): void {
    this.mutate(
      (root) => {
        const { table, cell } = tableContext(root, this.start),
          grid = buildTableGrid(table),
          at = grid.origins.get(cell.id)!.column;
        if (grid.width === 1) {
          replaceTableWithParagraph(root, table);
          return;
        }
        for (const origin of grid.origins.values())
          if (origin.column <= at && origin.column + origin.width > at) {
            if (origin.width > 1)
              origin.node.props.ColumnSpan = origin.width - 1;
            else {
              const row = grid.rows[origin.row]!;
              row.children!.splice(row.children!.indexOf(origin.node), 1);
            }
          }
        if (Array.isArray(table.props.Columns))
          table.props.Columns.splice(at, 1);
      },
      true,
      undefined,
      { Kind: "TableStructure", Operation: "DeleteTableColumn" },
    );
  }
  DeleteTable(): void {
    this.mutate(
      (root) =>
        replaceTableWithParagraph(root, tableContext(root, this.start).table),
      true,
      undefined,
      { Kind: "TableStructure", Operation: "DeleteTable" },
    );
  }
  ToggleList(markerStyle: string = "Disc"): void {
    this.mutate(
      (root) => {
        const selected = this.selectedBlocks(root);
        if (!selected.length) return;
        const first = selected[0],
          last = selected.at(-1)!;
        const ancestors = findAncestors(root, first.node.id),
          list = [...ancestors].reverse().find((node) => node.type === "List");
        if (
          list &&
          selected.every((block) => containsNode(list, block.node.id))
        ) {
          if (list.props.MarkerStyle !== markerStyle) {
            list.props.MarkerStyle = markerStyle;
            return;
          }
          const parent = findParent(root, list.id)!;
          parent.children!.splice(
            parent.children!.indexOf(list),
            1,
            ...(list.children ?? []).flatMap((item) => item.children ?? []),
          );
          return;
        }
        if (
          first.parent !== last.parent ||
          selected.some(
            (block) =>
              block.parent !== first.parent || block.node.type !== "Paragraph",
          )
        )
          throw new Error(
            "List conversion requires contiguous paragraphs in one block collection.",
          );
        const parent = first.parent,
          a = parent.children!.indexOf(first.node),
          b = parent.children!.indexOf(last.node);
        if (
          parent
            .children!.slice(a, b + 1)
            .some((node) => node.type !== "Paragraph")
        )
          throw new Error("List conversion cannot cross structural blocks.");
        parent.children!.splice(
          a,
          b - a + 1,
          makeNode(
            "List",
            selected.map((block) => makeNode("ListItem", [block.node])),
            { MarkerStyle: markerStyle, StartIndex: 1 },
          ),
        );
      },
      true,
      undefined,
      { Kind: "Structural", Operation: "ToggleList" },
    );
  }
  Find(text: string, options: FindOptions = {}): FindResult[] {
    if (typeof text !== "string" || !text.length) return [];
    const source = this.Document.Text,
      matchCase = options.MatchCase ?? options.matchCase ?? false,
      wholeWord = options.WholeWord ?? options.wholeWord ?? false;
    const regex = new RegExp(
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      matchCase ? "gu" : "giu",
    );
    regex.lastIndex =
      options.Start === undefined
        ? 0
        : validOffset(options.Start, source.length);
    const result: FindResult[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source))) {
      const start = match.index,
        end = start + match[0].length;
      if (
        wholeWord &&
        ((start && wordCharacter(Array.from(source.slice(0, start)).at(-1)!)) ||
          (end < source.length &&
            wordCharacter(Array.from(source.slice(end))[0])))
      )
        continue;
      result.push({ Start: start, End: end, Text: match[0] });
    }
    return result;
  }
  ReplaceAll(
    find: string,
    replacement: string,
    options: FindOptions = {},
  ): number {
    if (typeof replacement !== "string")
      throw new TypeError("Replacement must be a string.");
    const matches = this.Find(find, options);
    this.Change(() => {
      for (const match of [...matches].reverse()) {
        this.Select(match.Start, match.End);
        this.InsertText(replacement);
      }
    });
    return matches.length;
  }
  AddAnnotation(
    kind: string,
    data: Record<string, any>,
    start = this.start,
    end = this.end,
  ): DocumentAnnotation {
    validOffset(start, this.Document.Text.length);
    validOffset(end, this.Document.Text.length);
    const annotation: DocumentAnnotation = {
      Id: uid(),
      Kind: kind,
      Start: Math.min(start, end),
      End: Math.max(start, end),
      Data: clone(data),
    };
    this.mutate((root) => {
      (root.props.Annotations ??= []).push(annotation);
    });
    return clone(annotation);
  }
  AddComment(text: string, author = ""): DocumentAnnotation {
    return this.AddAnnotation("Comment", {
      Text: text,
      Author: author,
      CreatedAt: new Date().toISOString(),
      Resolved: false,
    });
  }
  AddBookmark(name: string): DocumentAnnotation {
    if (
      !name ||
      this.Annotations.some(
        (item) => item.Kind === "Bookmark" && item.Data.Name === name,
      )
    )
      throw new Error("Bookmark names must be nonempty and unique.");
    return this.AddAnnotation("Bookmark", { Name: name });
  }
  UpdateAnnotation(id: string, data: Record<string, any>): void {
    this.mutate((root) => {
      const item = (root.props.Annotations ?? []).find(
        (annotation: DocumentAnnotation) => annotation.Id === id,
      );
      if (!item) throw new Error(`Annotation ${id} was not found.`);
      item.Data = { ...item.Data, ...clone(data) };
    });
  }
  RemoveAnnotation(id: string): boolean {
    let removed = false;
    this.mutate((root) => {
      const items: DocumentAnnotation[] = root.props.Annotations ?? [],
        index = items.findIndex((item) => item.Id === id);
      if (index >= 0) {
        items.splice(index, 1);
        removed = true;
      }
    });
    return removed;
  }
  GoToBookmark(name: string): boolean {
    const item = this.Annotations.find(
      (annotation) =>
        annotation.Kind === "Bookmark" && annotation.Data.Name === name,
    );
    if (!item) return false;
    this.Select(item.Start, item.End);
    return true;
  }
  Execute(command: string, parameter?: any): any {
    const name = command
      .replace(/^(EditingCommands|ApplicationCommands)\./, "")
      .replace(/[\s_-]/g, "")
      .toLowerCase();
    switch (name) {
      case "undo":
        return this.Undo();
      case "redo":
        return this.Redo();
      case "selectall":
        return this.Select(0, this.Document.Text.length);
      case "inserttext":
        return this.InsertText(parameter ?? "");
      case "insertparagraph":
      case "enterparagraphbreak":
        return this.InsertParagraph();
      case "insertlinebreak":
      case "enterlinebreak":
        return this.InsertNode(makeNode("LineBreak"));
      case "delete":
      case "deleteforward":
        return this.DeleteForward();
      case "backspace":
      case "deletebackward":
        return this.DeleteBackward();
      case "deletepreviousword":
      case "deletewordbackward":
        return this.DeleteWordBackward();
      case "deletenextword":
      case "deletewordforward":
        return this.DeleteWordForward();
      case "bold":
      case "togglebold":
        return this.ToggleFormat("FontWeight", "Bold", "Normal");
      case "italic":
      case "toggleitalic":
        return this.ToggleFormat("FontStyle", "Italic", "Normal");
      case "underline":
      case "toggleunderline":
        return this.ToggleFormat("TextDecorations", "Underline", "None");
      case "strikethrough":
      case "togglestrikethrough":
        return this.ToggleFormat("TextDecorations", "Strikethrough", "None");
      case "subscript":
      case "togglesubscript":
        return this.ToggleFormat("BaselineAlignment", "Subscript", "Baseline");
      case "superscript":
      case "togglesuperscript":
        return this.ToggleFormat(
          "BaselineAlignment",
          "Superscript",
          "Baseline",
        );
      case "alignleft":
        return this.SetParagraphProperty("TextAlignment", "Left");
      case "aligncenter":
        return this.SetParagraphProperty("TextAlignment", "Center");
      case "alignright":
        return this.SetParagraphProperty("TextAlignment", "Right");
      case "alignjustify":
      case "justify":
        return this.SetParagraphProperty("TextAlignment", "Justify");
      case "fontfamily":
        return this.ApplyProperty("FontFamily", parameter);
      case "fontsize":
        return this.ApplyProperty("FontSize", parameter);
      case "foreground":
        return this.ApplyProperty("Foreground", parameter);
      case "background":
      case "highlight":
        return this.ApplyProperty("Background", parameter);
      case "heading":
        return this.SetParagraphProperty("HeadingLevel", parameter);
      case "clearformatting":
        return this.ClearFormatting();
      case "indent":
      case "increaseindentation":
        return this.Indent();
      case "outdent":
      case "decreaseindentation":
        return this.Indent(-24);
      case "bullets":
      case "togglebullets":
        return this.ToggleList("Disc");
      case "numbering":
      case "togglenumbering":
        return this.ToggleList("Decimal");
      case "insertequation":
        return this.InsertEquation(
          typeof parameter === "string"
            ? parameter
            : (parameter?.Source ?? "x"),
          parameter?.Format ?? "latex",
          parameter?.DisplayMode ?? false,
        );
      case "updateequation":
        return this.UpdateEquation(
          parameter?.ElementId ?? parameter?.Id,
          parameter?.Source,
          parameter?.Format,
          parameter?.DisplayMode,
        );
      case "insertpagebreak":
        return this.InsertPageBreak();
      case "insertcolumnbreak":
        return this.InsertColumnBreak();
      case "insertimage":
        return typeof parameter === "string"
          ? this.InsertImage(parameter)
          : this.InsertImage(
              parameter.Source ?? parameter.source,
              parameter.AlternativeText ?? parameter.alt,
              parameter.Width ?? parameter.width,
              parameter.Height ?? parameter.height,
            );
      case "inserttable":
        return this.InsertTable(
          parameter?.Rows ?? parameter?.rows ?? 2,
          parameter?.Columns ?? parameter?.columns ?? 2,
        );
      case "inserttablerow":
        return this.InsertTableRow(
          parameter?.Before ?? parameter?.before ?? false,
        );
      case "deletetablerow":
        return this.DeleteTableRow();
      case "inserttablecolumn":
        return this.InsertTableColumn(
          parameter?.Before ?? parameter?.before ?? false,
        );
      case "deletetablecolumn":
        return this.DeleteTableColumn();
      case "deletetable":
        return this.DeleteTable();
      case "inserthyperlink":
      case "insertlink":
        return typeof parameter === "string"
          ? this.InsertHyperlink(parameter)
          : this.InsertHyperlink(
              parameter.NavigateUri ?? parameter.uri,
              parameter.Text ?? parameter.text,
            );
      case "removehyperlink":
      case "removelink":
        return this.RemoveHyperlink();
      case "find":
        return this.Find(
          typeof parameter === "string" ? parameter : (parameter?.Text ?? ""),
          parameter?.Options,
        );
      case "replaceall":
        return this.ReplaceAll(
          parameter.Find,
          parameter.Replacement,
          parameter.Options,
        );
      case "moveselection":
        return this.MoveSelection(
          typeof parameter === "number" ? parameter : parameter?.Destination,
        );
      case "moveblocks":
        return this.MoveBlocks(
          parameter.Ids,
          parameter.ParentId,
          parameter.Index,
        );
      case "setelementproperty":
        return this.SetElementProperty(
          parameter.Id,
          parameter.Name,
          parameter.Value,
        );
      case "settableproperty":
        return this.SetTableProperty(parameter.Name, parameter.Value);
      case "setcellproperty":
        return this.SetCellProperty(parameter.Name, parameter.Value);
      case "mergetablecells":
        return this.MergeTableCells(parameter ?? 2);
      case "splittablecell":
        return this.SplitTableCell();
      case "trackformatting":
        if (parameter !== undefined && typeof parameter !== "boolean")
          throw new TypeError("TrackFormatting requires a boolean.");
        return (this.TrackFormatting = parameter ?? !this.TrackFormatting);
      case "currentauthor":
        if (typeof parameter !== "string")
          throw new TypeError("CurrentAuthor requires a string.");
        this.CurrentAuthor = parameter;
        return;
      case "trackchanges":
        if (parameter !== undefined && typeof parameter !== "boolean")
          throw new TypeError("TrackChanges requires a boolean.");
        this.TrackChanges = parameter ?? !this.TrackChanges;
        return this.TrackChanges;
      case "acceptrevision":
        return this.AcceptRevision(parameter);
      case "rejectrevision":
        return this.RejectRevision(parameter);
      case "acceptallrevisions":
        return this.AcceptAllRevisions();
      case "rejectallrevisions":
        return this.RejectAllRevisions();
      case "addcomment":
        return this.AddComment(
          typeof parameter === "string" ? parameter : parameter.Text,
          parameter?.Author,
        );
      case "addbookmark":
        return this.AddBookmark(parameter);
      default:
        throw new Error(`Editing command '${command}' is not supported.`);
    }
  }
  Dispose(): void {
    if (!this.disposed) {
      while (this.depth) this.EndChange();
      this.subscription.Dispose();
      this.disposed = true;
    }
  }
}

function containsNode(node: DocumentNode, id: string): boolean {
  return (
    node.id === id || !!node.children?.some((child) => containsNode(child, id))
  );
}
function captureDeletion(
  root: DocumentNode,
  start: number,
  end: number,
): Record<string, any> {
  const blocks = textBlocks(root).filter(
      (block) => block.end >= start && block.start < end,
    ),
    first = blocks[0];
  const Nodes = blocks.map((block) => ({
    ...clone(block.node),
    children:
      block.node.type === "Paragraph"
        ? sliceInlines(
            block.node.children ?? [],
            Math.max(0, start - block.start),
            Math.min(block.text.length, end - block.start),
          )
        : block.node.children,
  }));
  const data: Record<string, any> = {
    Text: plainText(root).slice(start, end),
    Nodes,
  };
  if (first && blocks.some((block) => block.parent !== first.parent))
    data.Segments = blocks
      .filter((block) => block.node.type === "Paragraph")
      .map((block) => {
        const from = Math.max(0, start - block.start),
          to = Math.min(block.text.length, end - block.start);
        return {
          BlockId: block.node.id,
          Offset: from,
          RemainingText: block.text.slice(0, from) + block.text.slice(to),
          Inlines: sliceInlines(block.node.children ?? [], from, to),
        };
      });
  return data;
}
function findParent(root: DocumentNode, id: string): DocumentNode | undefined {
  if (root.children?.some((child) => child.id === id)) return root;
  for (const child of root.children ?? []) {
    const parent = findParent(child, id);
    if (parent) return parent;
  }
  return undefined;
}
function findAncestors(root: DocumentNode, id: string): DocumentNode[] {
  if (root.id === id) return [];
  for (const child of root.children ?? [])
    if (containsNode(child, id)) return [root, ...findAncestors(child, id)];
  return [];
}
function tableContext(root: DocumentNode, offset: number) {
  const block = pointBlock(root, offset),
    ancestors = findAncestors(root, block.node.id);
  const table = [...ancestors].reverse().find((item) => item.type === "Table"),
    group = [...ancestors]
      .reverse()
      .find((item) => item.type === "TableRowGroup"),
    row = [...ancestors].reverse().find((item) => item.type === "TableRow"),
    cell = [...ancestors].reverse().find((item) => item.type === "TableCell");
  if (!table || !group || !row || !cell)
    throw new Error("Place the selection inside a table cell first.");
  return { table, group, row, cell };
}
function findTableRows(table: DocumentNode): DocumentNode[] {
  return (table.children ?? []).flatMap((group) => group.children ?? []);
}
function replaceTableWithParagraph(
  root: DocumentNode,
  table: DocumentNode,
): void {
  const parent = findParent(root, table.id)!;
  parent.children!.splice(
    parent.children!.indexOf(table),
    1,
    makeNode("Paragraph"),
  );
}
function mapStructuralAnnotations(
  before: DocumentNode,
  after: DocumentNode,
): void {
  if (
    !Array.isArray(after.props.Annotations) ||
    !after.props.Annotations.length
  )
    return;
  const oldText = plainText(before),
    newText = plainText(after);
  if (oldText === newText) return;
  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] ===
      newText[newText.length - suffix - 1]
  )
    suffix++;
  const oldBlocks = textBlocks(before),
    newBlocks = new Map(
      textBlocks(after).map((block) => [block.node.id, block]),
    );
  const move = (offset: number, trailing: boolean) => {
    const oldBlock = oldBlocks.find(
        (block) => offset >= block.start && offset <= block.end,
      ),
      corresponding = oldBlock && newBlocks.get(oldBlock.node.id);
    if (oldBlock && corresponding && oldBlock.text === corresponding.text)
      return corresponding.start + offset - oldBlock.start;
    if (offset < prefix) return offset;
    if (offset > oldText.length - suffix)
      return offset + newText.length - oldText.length;
    return trailing ? newText.length - suffix : prefix;
  };
  for (const item of after.props.Annotations as DocumentAnnotation[]) {
    if (item.Kind === "Formatting")
      for (const change of item.Data?.PropertyChanges ?? [])
        if (change.Scope === "Inline") {
          change.Start = move(change.Start, false);
          change.End = Math.max(change.Start, move(change.End, true));
        }
    if (item.Kind === "Move" && Number.isInteger(item.Data?.SourceStart))
      item.Data.SourceStart = move(item.Data.SourceStart, false);
    item.Start = move(item.Start, false);
    item.End =
      item.Kind === "Deletion"
        ? item.Start
        : Math.max(item.Start, move(item.End, true));
  }
}

/** String commands work with Execute, RelayCommand, toolbar bindings, and bridges. */
export const EditingCommands = Object.freeze(
  Object.fromEntries(
    [
      "ToggleBold",
      "ToggleItalic",
      "ToggleUnderline",
      "ToggleStrikethrough",
      "ToggleSubscript",
      "ToggleSuperscript",
      "AlignLeft",
      "AlignCenter",
      "AlignRight",
      "AlignJustify",
      "ToggleBullets",
      "ToggleNumbering",
      "EnterParagraphBreak",
      "EnterLineBreak",
      "Delete",
      "Backspace",
      "DeletePreviousWord",
      "DeleteNextWord",
      "ClearFormatting",
    ].map((name) => [name, name]),
  ),
);
export const ApplicationCommands = Object.freeze({
  Undo: "Undo",
  Redo: "Redo",
  SelectAll: "SelectAll",
  Find: "Find",
  Replace: "ReplaceAll",
});

function inverseSpans(changes: TextEditSpan[]): TextEditSpan[] {
  let delta = 0;
  return changes.map((change) => {
    const span = {
      Start: change.Start + delta,
      RemovedLength: change.InsertedLength,
      InsertedLength: change.RemovedLength,
    };
    delta += change.InsertedLength - change.RemovedLength;
    return span;
  });
}
function spansFromTokens(
  tokens: number[],
  before: string,
  after: string,
): TextEditSpan[] | undefined {
  if (
    tokens.length !== after.length ||
    tokens.some((token, index) => token >= 0 && before[token] !== after[index])
  )
    return undefined;
  const spans: TextEditSpan[] = [];
  let old = 0,
    pending = 0;
  for (const token of tokens) {
    if (token < 0) {
      pending++;
      continue;
    }
    if (token !== old || pending) {
      spans.push({
        Start: old,
        RemovedLength: token - old,
        InsertedLength: pending,
      });
      pending = 0;
    }
    old = token + 1;
  }
  if (old !== before.length || pending)
    spans.push({
      Start: old,
      RemovedLength: before.length - old,
      InsertedLength: pending,
    });
  return spans;
}

function findNode(root: DocumentNode, id: string): DocumentNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}
const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
function setLocalProperty(
  node: DocumentNode,
  name: string,
  value: unknown,
): void {
  if (value === undefined) delete node.props[name];
  else
    Object.defineProperty(node.props, name, {
      value: clone(value),
      writable: true,
      enumerable: true,
      configurable: true,
    });
}
function captureNodeProperty(
  node: DocumentNode,
  name: string,
  value: unknown,
): RevisionPropertyChange[] {
  const HadBefore = Object.hasOwn(node.props, name),
    HasAfter = value !== undefined;
  if (HadBefore === HasAfter && sameValue(node.props[name], value)) return [];
  return [
    {
      Scope: "Node",
      NodeId: node.id,
      Name: name,
      HadBefore,
      HasAfter,
      ...(HadBefore ? { Before: clone(node.props[name]) } : {}),
      ...(HasAfter ? { After: clone(value) } : {}),
    },
  ];
}
function captureInlineProperties(
  root: DocumentNode,
  start: number,
  end: number,
  name: string,
  value: unknown,
): RevisionPropertyChange[] {
  return leaves(root)
    .filter((leaf) => leaf.end > start && leaf.start < end)
    .flatMap((leaf) =>
      captureNodeProperty(leaf.node, name, value).map((change) => ({
        ...change,
        Scope: "Inline" as const,
        NodeId: undefined,
        Start: Math.max(start, leaf.start),
        End: Math.min(end, leaf.end),
      })),
    );
}
function validateRevisionProperty(
  root: DocumentNode,
  change: RevisionPropertyChange,
): void {
  if (
    !change ||
    typeof change.Name !== "string" ||
    !["Inline", "Node"].includes(change.Scope)
  )
    throw new Error("Revision conflict: malformed property restoration data.");
  const targets =
    change.Scope === "Node"
      ? [findNode(root, change.NodeId!)]
      : leaves(root)
          .filter(
            (leaf) => leaf.end > change.Start! && leaf.start < change.End!,
          )
          .map((leaf) => leaf.node);
  if (
    change.Scope === "Inline" &&
    (!Number.isInteger(change.Start) ||
      !Number.isInteger(change.End) ||
      change.Start! < 0 ||
      change.End! < change.Start! ||
      change.End! > plainText(root).length)
  )
    throw new Error("Revision conflict: formatting range is invalid.");
  if (
    (!targets.length && change.Start !== change.End) ||
    targets.some(
      (node) =>
        !node ||
        Object.hasOwn(node.props, change.Name) !== change.HasAfter ||
        (change.HasAfter && !sameValue(node.props[change.Name], change.After)),
    )
  )
    throw new Error(
      `Revision conflict: ${change.Name} has changed since this formatting revision.`,
    );
}
/** Relocate a structural splice by stable child identities after unrelated sibling edits. */
function relocateRevisionPatch(
  root: DocumentNode,
  input: DocumentPatch,
  anchors?: Record<
    string,
    { PreviousId?: string; NextId?: string; Empty?: boolean }
  >,
): DocumentPatch {
  const patch = clone(input);
  const visit = (change: DocumentPatch["Change"]) => {
    const node = findNode(root, change.Id);
    if (node && change.Children?.Removed.length) {
      const ids = change.Children.Removed.map((child) => child.id);
      const index = node.children?.findIndex((child, at, children) =>
        ids.every((id, i) => children[at + i]?.id === id),
      );
      if (index !== undefined && index >= 0) change.Children.Index = index;
    } else if (node && change.Children && anchors?.[change.Id]) {
      const anchor = anchors[change.Id]!;
      const previous = anchor.PreviousId
        ? node.children?.findIndex((child) => child.id === anchor.PreviousId)
        : undefined;
      const next = anchor.NextId
        ? node.children?.findIndex((child) => child.id === anchor.NextId)
        : undefined;
      if (
        previous === -1 ||
        next === -1 ||
        (previous !== undefined && next !== undefined && previous >= next) ||
        (anchor.Empty && node.children?.length)
      )
        throw new Error(
          "Revision conflict: deleted structure lost its neighboring anchors.",
        );
      change.Children.Index =
        next ?? (previous === undefined ? 0 : previous + 1);
    }
    change.Descendants?.forEach(visit);
  };
  visit(patch.Change);
  return patch;
}

function buildTableGrid(table: DocumentNode) {
  const rows = findTableRows(table),
    slots: DocumentNode[][] = [],
    origins = new Map<
      string,
      {
        node: DocumentNode;
        row: number;
        column: number;
        width: number;
        height: number;
      }
    >();
  let width = 0;
  rows.forEach((row, y) => {
    const occupied = (slots[y] ??= []);
    let x = 0;
    for (const cell of row.children ?? []) {
      while (occupied[x]) x++;
      const w = Math.max(1, Number(cell.props.ColumnSpan) || 1),
        h = Math.max(1, Number(cell.props.RowSpan) || 1);
      if (!Number.isInteger(w) || !Number.isInteger(h) || y + h > rows.length)
        throw new Error("Table spans exceed the available grid.");
      origins.set(cell.id, {
        node: cell,
        row: y,
        column: x,
        width: w,
        height: h,
      });
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const target = (slots[y + dy] ??= []);
          if (target[x + dx]) throw new Error("Table spans overlap.");
          target[x + dx] = cell;
        }
      x += w;
      width = Math.max(width, x);
    }
  });
  if (
    slots.some(
      (row) =>
        row.length !== width ||
        Array.from({ length: width }, (_, i) => row[i]).some((cell) => !cell),
    )
  )
    throw new Error("Table editing requires a complete rectangular grid.");
  return { rows, slots, origins, width };
}

function captureStructureAnchors(root: DocumentNode, patch: DocumentPatch) {
  const anchors: Record<
    string,
    { PreviousId?: string; NextId?: string; Empty?: boolean }
  > = {};
  const visit = (change: DocumentPatch["Change"]) => {
    if (change.Children) {
      const children = findNode(root, change.Id)?.children ?? [],
        index = change.Children.Index;
      anchors[change.Id] = {
        ...(children[index - 1] ? { PreviousId: children[index - 1]!.id } : {}),
        ...(children[index + change.Children.Removed.length]
          ? { NextId: children[index + change.Children.Removed.length]!.id }
          : {}),
        ...(!children.length ? { Empty: true } : {}),
      };
    }
    change.Descendants?.forEach(visit);
  };
  visit(patch.Change);
  return anchors;
}
