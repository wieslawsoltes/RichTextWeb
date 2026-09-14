import { type PageSetupOptions } from "./page-setup.js";
import {
  FlowDocument,
  Paragraph,
  Run,
  Span,
  Section,
  type DocumentNode,
} from "./model.js";
import { RichTextEngine } from "./engine.js";
import { inlineText, plainText, textBlocks } from "./engine-tree.js";

export type FieldType =
  | "PAGE"
  | "NUMPAGES"
  | "DATE"
  | "TIME"
  | "REF"
  | "PAGEREF"
  | "MERGEFIELD"
  | "SEQ"
  | "TITLE"
  | "AUTHOR"
  | "FILENAME";
export interface FieldDefinition {
  Type: FieldType;
  Instruction: string;
  Argument?: string;
  Format?: string;
}
export interface FieldContext {
  PageNumber?: number;
  PageCount?: number;
  Now?: Date;
  Locale?: string;
  Data?: Record<string, unknown>;
  FileName?: string;
  PageOfNode?: (id: string) => number | undefined;
}
export interface FieldUpdateResult {
  /** Exact main-story edits in pre-update UTF-16 coordinates, for pointer/history mapping. */
  TextChanges: {
    Start: number;
    RemovedLength: number;
    InsertedLength: number;
  }[];
  Updated: number;
  Unresolved: { Id: string; Instruction: string; Reason: string }[];
}
export interface TableOfContentsOptions {
  MaxLevel?: number;
  Title?: string;
  IncludePageNumbers?: boolean;
}
export type StoryKind =
  | "Headers"
  | "Footers"
  | "FirstPageHeader"
  | "FirstPageFooter"
  | "EvenPageHeader"
  | "EvenPageFooter";
export type NoteKind = "Footnote" | "Endnote";
export interface DocumentNote {
  Id: string;
  Blocks: DocumentNode[];
}

const copy = <T>(value: T): T => structuredClone(value);
function walk(node: DocumentNode, visit: (node: DocumentNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function text(node: DocumentNode): string {
  if (
    [
      "FlowDocument",
      "Section",
      "List",
      "ListItem",
      "Table",
      "TableRowGroup",
      "TableRow",
      "TableCell",
    ].includes(node.type)
  )
    return plainText(node);
  return inlineText(node);
}
interface FieldTextSplice {
  Start: number;
  End: number;
  NewLength: number;
}
/** Apply exact field replacements; unrelated equal text is never treated as part of a replacement. */
function mapFieldAnnotations(
  root: DocumentNode,
  replacements: FieldTextSplice[],
): void {
  if (!Array.isArray(root.props.Annotations) || !replacements.length) return;
  const sorted = replacements.sort(
    (a, b) => a.Start - b.Start || a.End - b.End,
  );
  const move = (offset: number, trailing: boolean): number => {
    let delta = 0;
    for (const change of sorted) {
      if (offset < change.Start) break;
      if (change.Start === change.End && offset === change.Start) {
        if (!trailing) delta += change.NewLength;
        continue;
      }
      if (offset === change.Start) return change.Start + delta;
      if (offset < change.End)
        return change.Start + delta + (trailing ? change.NewLength : 0);
      delta += change.NewLength - (change.End - change.Start);
    }
    return offset + delta;
  };
  for (const annotation of root.props.Annotations) {
    if (
      !Number.isSafeInteger(annotation.Start) ||
      !Number.isSafeInteger(annotation.End)
    )
      continue;
    const collapsed = annotation.Start === annotation.End;
    annotation.Start = move(annotation.Start, false);
    annotation.End =
      annotation.Kind === "Deletion" || collapsed
        ? annotation.Start
        : Math.max(annotation.Start, move(annotation.End, true));
  }
}

function storyRoots(root: DocumentNode): DocumentNode[] {
  const roots = [root];
  walk(root, (node) => {
    for (const key of [
      "Headers",
      "Footers",
      "FirstPageHeader",
      "FirstPageFooter",
      "EvenPageHeader",
      "EvenPageFooter",
    ])
      if (Array.isArray(node.props[key])) roots.push(...node.props[key]);
  });
  for (const key of ["Footnotes", "Endnotes"])
    for (const note of root.props[key] ?? []) roots.push(...note.Blocks);
  return roots;
}
function numberFormat(value: number, format?: string): string {
  if (!Number.isSafeInteger(value) || value < 1) return String(value);
  if (format === "alphabetic" || format === "ALPHABETIC") {
    let result = "";
    for (let n = value; n > 0; n = Math.floor((n - 1) / 26))
      result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    return format === "alphabetic" ? result.toLowerCase() : result;
  }
  if (format === "roman" || format === "ROMAN") {
    if (value > 3999) return String(value);
    let result = "",
      rest = value;
    for (const [n, symbol] of [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ] as const)
      while (rest >= n) {
        result += symbol;
        rest -= n;
      }
    return format === "roman" ? result.toLowerCase() : result;
  }
  return String(value);
}

/** Portable cached field. Instructions are parsed as data and never executed. */
export function createField(
  type: FieldType,
  argument = "",
  format?: string,
): Span {
  const field = new Span(
    new Run(
      type === "MERGEFIELD" ? `«${argument}»` : type === "PAGE" ? "1" : "…",
    ),
  );
  field.SetValue("Field", {
    Type: type,
    Instruction: `${type}${argument ? ` ${JSON.stringify(argument)}` : ""}${format ? ` \\* ${format}` : ""}`,
    Argument: argument,
    ...(format ? { Format: format } : {}),
  });
  return field;
}

function definition(node: DocumentNode): FieldDefinition | null {
  const field = node.props.Field;
  if (!field || typeof field.Instruction !== "string") return null;
  const tokens = field.Instruction.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  const decode = (s: string) => {
    try {
      return s.startsWith('"') ? JSON.parse(s) : s;
    } catch {
      return s;
    }
  };
  const type = String(field.Type ?? tokens[0] ?? "").toUpperCase() as FieldType;
  const arg = tokens[1] && !tokens[1].startsWith("\\") ? decode(tokens[1]) : "";
  const switchIndex = tokens.indexOf("\\*");
  return {
    Type: type,
    Instruction: field.Instruction,
    Argument: field.Argument ?? arg,
    Format:
      field.Format ?? (switchIndex >= 0 ? tokens[switchIndex + 1] : undefined),
  };
}

/** Resolve fields on a detached canonical tree. Unresolvable fields retain their cached text. */
export function updateDocumentFields(
  root: DocumentNode,
  context: FieldContext = {},
): FieldUpdateResult {
  const result: FieldUpdateResult = {
      Updated: 0,
      Unresolved: [],
      TextChanges: [],
    },
    sequences = new Map<string, number>(),
    byId = new Map<string, DocumentNode>(),
    sourceTextById = new Map<string, string>(),
    sourceRanges = new WeakMap<DocumentNode, { Start: number; End: number }>(),
    changes: FieldTextSplice[] = [];
  // References resolve against one immutable text snapshot even when an earlier field changes length.
  const originalText = plainText(root),
    originalBlocks = textBlocks(root),
    originalAnnotations = copy(root.props.Annotations ?? []);
  walk(root, (node) => {
    byId.set(node.id, node);
    sourceTextById.set(node.id, text(node));
  });
  for (const block of originalBlocks) {
    let offset = block.start;
    const index = (node: DocumentNode) => {
      const start = offset;
      if (
        [
          "Run",
          "LineBreak",
          "Image",
          "InlineUIContainer",
          "BlockUIContainer",
        ].includes(node.type)
      )
        offset += inlineText(node).length;
      else for (const child of node.children ?? []) index(child);
      sourceRanges.set(node, { Start: start, End: offset });
    };
    index(block.node);
  }
  const now = context.Now ?? new Date();
  for (const story of storyRoots(root))
    walk(story, (node) => {
      const field = definition(node);
      if (!field) return;
      if (!["Span", "Run"].includes(node.type)) {
        result.Unresolved.push({
          Id: node.id,
          Instruction: field.Instruction,
          Reason: "Fields require a Span or Run node.",
        });
        return;
      }
      let value: string | undefined;
      const arg = field.Argument ?? "";
      const numeric = (n: number | undefined) =>
        n === undefined ? undefined : numberFormat(n, field.Format);
      switch (field.Type) {
        case "PAGE":
          value = numeric(context.PageOfNode?.(node.id) ?? context.PageNumber);
          break;
        case "NUMPAGES":
          value = numeric(context.PageCount);
          break;
        case "DATE":
          value =
            field.Format === "ISO"
              ? now.toISOString().slice(0, 10)
              : now.toLocaleDateString(context.Locale ?? "en", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                });
          break;
        case "TIME":
          value = now.toISOString().slice(11, 19);
          break;
        case "TITLE":
          value = String(root.props.Title ?? "");
          break;
        case "AUTHOR":
          value = String(root.props.Author ?? "");
          break;
        case "FILENAME":
          value = context.FileName;
          break;
        case "MERGEFIELD":
          if (
            context.Data &&
            Object.hasOwn(context.Data, arg) &&
            ["string", "number", "boolean"].includes(typeof context.Data[arg])
          )
            value = String(context.Data[arg]);
          break;
        case "SEQ": {
          const n = (sequences.get(arg) ?? 0) + 1;
          sequences.set(arg, n);
          value = numeric(n);
          break;
        }
        case "REF":
        case "PAGEREF": {
          const target = byId.get(arg),
            bookmark = originalAnnotations.find(
              (a: any) =>
                a.Kind === "Bookmark" && (a.Data?.Name === arg || a.Id === arg),
            );
          if (field.Type === "REF")
            value = target
              ? sourceTextById.get(target.id)
              : bookmark
                ? originalText.slice(bookmark.Start, bookmark.End)
                : undefined;
          else {
            let page = target ? context.PageOfNode?.(target.id) : undefined;
            if (!target && bookmark) {
              const block = originalBlocks.find(
                (b) => bookmark.Start >= b.start && bookmark.Start <= b.end,
              );
              if (block) page = context.PageOfNode?.(block.node.id);
              // Consumers may index rendered runs instead of paragraphs; try containing descendants too.
              if (page === undefined && block)
                walk(block.node, (candidate) => {
                  const range = sourceRanges.get(candidate);
                  if (
                    page === undefined &&
                    range &&
                    bookmark.Start >= range.Start &&
                    bookmark.Start <= range.End
                  )
                    page = context.PageOfNode?.(candidate.id);
                });
            }
            value = numeric(page);
          }
          break;
        }
      }
      if (value === undefined) {
        result.Unresolved.push({
          Id: node.id,
          Instruction: field.Instruction,
          Reason: "Missing field data or unsupported instruction.",
        });
        return;
      }
      if (text(node) !== value) {
        const range = sourceRanges.get(node);
        if (range) changes.push({ ...range, NewLength: value.length });
        if (node.type === "Run") {
          node.text = value;
          result.Updated++;
          return;
        }
        const previous = node.children?.[0];
        node.children = [
          {
            type: "Run",
            id: previous?.type === "Run" ? previous.id : new Run().Id,
            props: previous?.type === "Run" ? previous.props : {},
            text: value,
          },
        ];
        result.Updated++;
      }
    });
  mapFieldAnnotations(root, changes);
  result.TextChanges = changes
    .sort((a, b) => a.Start - b.Start || a.End - b.End)
    .map((change) => ({
      Start: change.Start,
      RemovedLength: change.End - change.Start,
      InsertedLength: change.NewLength,
    }));
  return result;
}

/** Engine-bound document operations: all changes use the control's existing history. */
export class DocumentFeatures {
  constructor(readonly Engine: RichTextEngine) {}
  /** Apply validated paper/story settings atomically without replacing the engine or resetting selection. */
  SetPageSetup(options: PageSetupOptions): void {
    this.Engine.SetPageSetup(options);
  }
  InsertField(type: FieldType, argument = "", format?: string): void {
    this.Engine.InsertNode(createField(type, argument, format).ToJSON());
  }
  UpdateFields(context: FieldContext = {}): FieldUpdateResult {
    const root = this.Engine.Document.ToJSON(),
      result = updateDocumentFields(root, context);
    if (result.Updated)
      this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
        MapAnnotations: false,
        TextChanges: result.TextChanges,
      });
    return result;
  }
  SetStory(kind: StoryKind, blocks: DocumentNode[], sectionId?: string): void {
    const valid: StoryKind[] = [
      "Headers",
      "Footers",
      "FirstPageHeader",
      "FirstPageFooter",
      "EvenPageHeader",
      "EvenPageFooter",
    ];
    if (!valid.includes(kind))
      throw new TypeError("Unknown header/footer story.");
    // Validate detached blocks through the canonical model before retaining them as metadata.
    const story = FlowDocument.FromJSON({
      type: "FlowDocument",
      id: new FlowDocument().Id,
      props: {},
      children: copy(blocks),
    });
    const root = this.Engine.Document.ToJSON();
    let target = root;
    if (sectionId) {
      let found: DocumentNode | undefined;
      walk(root, (node) => {
        if (node.id === sectionId && node.type === "Section") found = node;
      });
      if (!found) throw new Error("Section was not found.");
      target = found;
    }
    target.props[kind] = story.ToJSON().children ?? [];
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root));
  }
  InsertNote(kind: NoteKind, content: string | DocumentNode[]): string {
    if (kind !== "Footnote" && kind !== "Endnote")
      throw new TypeError("Unknown note kind.");
    const id = new Run().Id,
      key = kind === "Footnote" ? "Footnotes" : "Endnotes";
    const blocks =
      typeof content === "string"
        ? [new Paragraph(content).ToJSON()]
        : copy(content);
    FlowDocument.FromJSON({
      type: "FlowDocument",
      id: new FlowDocument().Id,
      props: {},
      children: blocks,
    });
    this.Engine.Change(() => {
      const root = this.Engine.Document.ToJSON(),
        notes: DocumentNote[] = root.props[key] ?? [];
      root.props[key] = [...notes, { Id: id, Blocks: blocks }];
      this.Engine.ReplaceDocument(FlowDocument.FromJSON(root));
      const reference = new Run(String(notes.length + 1));
      reference.SetValue("NoteReference", { Kind: kind, Id: id });
      reference.SetValue("BaselineAlignment", "Superscript");
      this.Engine.InsertNode(reference.ToJSON());
    });
    return id;
  }
  UpdateNote(kind: NoteKind, id: string, content: string): void {
    const root = this.Engine.Document.ToJSON(),
      key = kind === "Footnote" ? "Footnotes" : "Endnotes";
    const note = (root.props[key] ?? []).find((n: DocumentNote) => n.Id === id);
    if (!note) throw new Error("Note was not found.");
    note.Blocks = [new Paragraph(content).ToJSON()];
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root));
  }
  InsertTableOfContents(
    options: TableOfContentsOptions = {},
    context: FieldContext = {},
  ): void {
    const section = new Section();
    section.SetValue("TableOfContents", {
      MaxLevel: options.MaxLevel ?? 3,
      Title: options.Title ?? "Contents",
      IncludePageNumbers: options.IncludePageNumbers ?? true,
    });
    const token = section.Id;
    section.SetValue("TocInstance", token);
    const root = this.Engine.Document.ToJSON();
    const node = section.ToJSON();
    this.populateTOC(node, root, context);
    this.Engine.Change(() => {
      this.Engine.InsertNode(node);
      const inserted = this.Engine.Document.ToJSON();
      walk(inserted, (current) => {
        if (current.props.TocInstance === token) {
          this.populateTOC(current, inserted, context);
          delete current.props.TocInstance;
        }
      });
      this.Engine.ReplaceDocument(FlowDocument.FromJSON(inserted));
    });
  }
  UpdateTableOfContents(context: FieldContext = {}): number {
    const root = this.Engine.Document.ToJSON();
    let count = 0;
    walk(root, (node) => {
      if (node.props.TableOfContents) {
        this.populateTOC(node, root, context);
        count++;
      }
    });
    if (count) this.Engine.ReplaceDocument(FlowDocument.FromJSON(root));
    return count;
  }
  private populateTOC(
    section: DocumentNode,
    root: DocumentNode,
    context: FieldContext,
  ): void {
    const options = section.props.TableOfContents,
      entries: DocumentNode[] = [];
    const previous = new Map(
      (section.children ?? []).map((node) => [
        node.props.TocTargetId ?? "@title",
        node,
      ]),
    );
    const retain = (node: DocumentNode, key: string) => {
      const old = previous.get(key);
      if (old) {
        node.id = old.id;
        if (node.children?.[0] && old.children?.[0])
          node.children[0].id = old.children[0].id;
      }
      return node;
    };
    if (
      !Number.isInteger(options.MaxLevel) ||
      options.MaxLevel < 1 ||
      options.MaxLevel > 9
    )
      throw new RangeError("TOC MaxLevel must be 1–9.");
    const title = new Paragraph(String(options.Title));
    title.FontWeight = "Bold";
    title.FontSize = 22;
    entries.push(retain(title.ToJSON(), "@title"));
    const collect = (node: DocumentNode) => {
      if (node.props.TableOfContents) return;
      const level = Number(node.props.HeadingLevel);
      if (
        node.type === "Paragraph" &&
        level >= 1 &&
        level <= options.MaxLevel
      ) {
        const page = options.IncludePageNumbers
          ? context.PageOfNode?.(node.id)
          : undefined;
        const p = new Paragraph(
          `${text(node)}${page === undefined ? "" : `\t${page}`}`,
        );
        p.SetValue("TocTargetId", node.id);
        p.SetValue("Margin", {
          Left: (level - 1) * 18,
          Top: 4,
          Bottom: 4,
          Right: 0,
        });
        entries.push(retain(p.ToJSON(), node.id));
      }
      for (const child of node.children ?? []) collect(child);
    };
    collect(root);
    section.children = entries;
  }
  /** Create independent merged documents; template metadata and field definitions remain available. */
  MailMerge(
    records: Record<string, unknown>[],
    context: Omit<FieldContext, "Data"> = {},
  ): FlowDocument[] {
    return records.map((data) => {
      const root = this.Engine.Document.ToJSON();
      updateDocumentFields(root, { ...context, Data: data });
      return FlowDocument.FromJSON(root);
    });
  }
}
