import {
  parseFieldCode,
  parseFieldNumber,
  formatFieldNumber,
  formatFieldDate,
  formatFieldText,
  type ParsedFieldCode,
} from "./field-code.js";
import { validateFormula } from "./formula.js";
import { FieldReferenceReader } from "./field-references.js";
import { TableFormulaEvaluator } from "./table-formulas.js";
import {
  getDocumentStatistics,
  type DocumentStatisticsOptions,
  type DocumentStatistics,
} from "./document-statistics.js";
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
  | "FILENAME"
  | "="
  | "IF"
  | "DOCPROPERTY"
  | "DOCVARIABLE"
  | "NUMWORDS"
  | "NUMCHARS"
  | "NUMPARAS"
  | "SECTION"
  | "SECTIONPAGES"
  | "CREATEDATE"
  | "SAVEDATE";
export interface FieldDefinition {
  Type: FieldType;
  Instruction: string;
  Argument?: string;
  Format?: string;
}
export interface FieldContext {
  /** Snapshot preserves legacy caches; Current resolves REF/formula bookmark dependencies in this update. */
  ReferenceMode?: "Snapshot" | "Current";
  PageNumber?: number;
  PageCount?: number;
  Now?: Date;
  Locale?: string;
  Data?: Record<string, unknown>;
  FileName?: string;
  PageOfNode?: (id: string) => number | undefined;
  SectionNumber?: number;
  SectionPageCount?: number;
  SectionOfNode?: (id: string) => number | undefined;
  SectionPagesOfNode?: (id: string) => number | undefined;
  Properties?: Record<string, string | number | boolean>;
  Variables?: Record<string, string | number | boolean>;
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
  /** A caption label switches the contents index to a list of figures/tables. */
  CaptionLabel?: string;
}
export interface CaptionOptions {
  Label?: string;
  Text?: string;
  NumberFormat?: "ARABIC" | "roman" | "ROMAN" | "alphabetic" | "ALPHABETIC";
  Separator?: string;
}
export interface CaptionReference {
  Id: string;
  Bookmark: string;
  NumberBookmark: string;
  LabelNumberBookmark: string;
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
    Instruction: `${type}${argument ? ` ${type === "=" ? argument : JSON.stringify(argument)}` : ""}${format ? ` \\* ${format}` : ""}`,
    Argument: argument,
    ...(format ? { Format: format } : {}),
  });
  return field;
}

/** Retain an explicit field instruction and cached display without executing imported code. */
export function createFieldFromInstruction(
  instruction: string,
  cachedText = "…",
): Span {
  const parsed = parseFieldCode(instruction);
  if (!parsed.Type) throw new SyntaxError("A field instruction is required.");
  if (parsed.Type === "=") validateFormula(parsed.Expression ?? "");
  const field = new Span(new Run(cachedText));
  field.SetValue("Field", { Type: parsed.Type, Instruction: instruction });
  return field;
}

/** Resolve fields on a detached canonical tree. Failed/locked fields keep their cached text.
 * ReferenceMode selects legacy snapshot reads or dependency-aware pending results.
 * All replacement coordinates refer to the original snapshot.
 */
export function updateDocumentFields(
  root: DocumentNode,
  context: FieldContext = {},
): FieldUpdateResult {
  if (
    context.ReferenceMode !== undefined &&
    context.ReferenceMode !== "Snapshot" &&
    context.ReferenceMode !== "Current"
  )
    throw new TypeError("ReferenceMode must be Snapshot or Current.");
  const result: FieldUpdateResult = {
    Updated: 0,
    Unresolved: [],
    TextChanges: [],
  };
  const roots = storyRoots(root),
    byId = new Map<string, DocumentNode>();
  const sourceTextById = new WeakMap<DocumentNode, string>();
  const ambiguousIds = new Set<string>();
  const sourceRanges = new WeakMap<
    DocumentNode,
    { Start: number; End: number }
  >();
  const changes: FieldTextSplice[] = [],
    fields: DocumentNode[] = [];
  const originalText = plainText(root),
    originalBlocks = textBlocks(root);
  const originalAnnotations = copy(root.props.Annotations ?? []);
  // Only outer fields own main-story replacement ranges. Nested result fields are not edited twice.
  const visit = (node: DocumentNode, insideField = false) => {
    if (byId.has(node.id) && byId.get(node.id) !== node)
      ambiguousIds.add(node.id);
    byId.set(node.id, node);
    if (node.props.Field && !insideField) fields.push(node);
    for (const child of node.children ?? [])
      visit(child, insideField || !!node.props.Field);
  };
  for (const story of roots) visit(story);
  for (const block of originalBlocks) {
    let offset = block.start;
    const index = (node: DocumentNode) => {
      const start = offset;
      if (
        [
          "Run",
          "LineBreak",
          "Image",
          "Equation",
          "Figure",
          "Floater",
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
  const codes = new Map<DocumentNode, ParsedFieldCode>(),
    failures = new Map<DocumentNode, string>();
  const sequences = new Map<string, number>(),
    sequenceValues = new Map<DocumentNode, number>();
  const numericValues = new Map<DocumentNode, number>(),
    values = new Map<DocumentNode, string | undefined>(),
    resolving = new Set<DocumentNode>();
  for (const node of fields) {
    try {
      if (!["Span", "Run"].includes(node.type))
        throw new TypeError("Fields require a Span or Run node.");
      const field = node.props.Field;
      const parsed = parseFieldCode(
        String(field.Instruction ?? field.Type ?? ""),
      );
      // Legacy structured fields remain supported when no explicit argument/switch was supplied.
      if (!parsed.Arguments.length && field.Argument && parsed.Type !== "=")
        parsed.Arguments.push(String(field.Argument));
      if (!parsed.Switches["*"] && field.Format)
        parsed.Switches["*"] = [String(field.Format)];
      codes.set(node, parsed);
      if (parsed.Type === "SEQ") {
        const name = (parsed.Arguments[0] ?? "").toLocaleLowerCase("en");
        if (!name) throw new SyntaxError("SEQ requires a sequence identifier.");
        if (parsed.Switches.s)
          throw new Error(
            "Heading-based sequence restarts are not implemented.",
          );
        const current = sequences.get(name) ?? 0;
        const reset = parsed.Switches.r?.[0];
        let number =
          reset !== undefined
            ? Number(reset)
            : parsed.Switches.c
              ? current
              : current + 1;
        if (node.props.Field.Locked === true)
          number = parseFieldNumber(text(node)) ?? number;
        if (
          !Number.isSafeInteger(number) ||
          number < 0 ||
          (parsed.Switches.r && reset === undefined)
        )
          throw new RangeError("SEQ restart must be a nonnegative integer.");
        sequences.set(name, number);
        sequenceValues.set(node, number);
      }
    } catch (error) {
      failures.set(
        node,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const sourceText = (target: DocumentNode) => {
    if (!sourceTextById.has(target)) sourceTextById.set(target, text(target));
    return sourceTextById.get(target)!;
  };
  const bookmark = (name: string) =>
    originalAnnotations.find(
      (a: any) =>
        a.Kind === "Bookmark" && (a.Data?.Name === name || a.Id === name),
    );
  const own = (
    record: any,
    name: string,
  ): string | number | boolean | undefined => {
    if (!record || !Object.hasOwn(record, name)) return undefined;
    const value = record[name];
    return ["string", "boolean"].includes(typeof value) ||
      (typeof value === "number" && Number.isFinite(value))
      ? value
      : undefined;
  };
  const variable = (name: string) =>
    own(context.Variables, name) ?? own(root.props.DocumentVariables, name);
  const property = (name: string) =>
    own(context.Properties, name) ??
    own(root.props.CustomProperties, name) ??
    own(root.props, name);
  const references =
    context.ReferenceMode === "Current"
      ? new FieldReferenceReader(originalText, fields, sourceRanges, (node) =>
          resolve(node),
        )
      : undefined;
  const bookmarkText = (mark: { Start: number; End: number }) =>
    references
      ? references.Bookmark(mark.Start, mark.End)
      : originalText.slice(mark.Start, mark.End);
  const namedNumber = (name: string) => {
    const target = bookmark(name),
      value = target
        ? bookmarkText(target)
        : (variable(name) ?? own(context.Data, name));
    return value === undefined ? undefined : parseFieldNumber(String(value));
  };
  const formulas = new TableFormulaEvaluator(
    roots,
    (node) => {
      const display = resolve(node);
      if (display === undefined)
        throw new Error(`Unresolved formula dependency: ${node.id}`);
      return numericValues.get(node) ?? display;
    },
    namedNumber,
  );
  const now = context.Now ?? new Date();
  let statistics: DocumentStatistics | undefined;
  const resolve = (node: DocumentNode): string | undefined => {
    if (values.has(node)) return values.get(node);
    if (node.props.Field?.Locked === true) {
      const cached = text(node);
      values.set(node, cached);
      return cached;
    }
    if (failures.has(node)) return undefined;
    if (resolving.has(node)) throw new Error("Circular field dependency.");
    if (resolving.size >= 64)
      throw new RangeError("Field dependency depth exceeds 64.");
    resolving.add(node);
    try {
      const code = codes.get(node);
      if (!code) throw new Error("Nested or unsupported field dependency.");
      const arg = code.Arguments[0] ?? "",
        general = code.Switches["*"] ?? [];
      let value: string | number | boolean | undefined;
      switch (code.Type) {
        case "=":
          value = formulas.Evaluate(node, code.Expression ?? "");
          break;
        case "PAGE":
          value = context.PageOfNode?.(node.id) ?? context.PageNumber;
          break;
        case "NUMPAGES":
          value = context.PageCount;
          break;
        case "SECTION":
          value = context.SectionOfNode?.(node.id) ?? context.SectionNumber;
          break;
        case "SECTIONPAGES":
          value =
            context.SectionPagesOfNode?.(node.id) ?? context.SectionPageCount;
          break;
        case "NUMWORDS":
        case "NUMCHARS":
        case "NUMPARAS": {
          statistics ??= getDocumentStatistics(root, {
            Locale: context.Locale,
          });
          value =
            statistics[
              code.Type === "NUMWORDS"
                ? "Words"
                : code.Type === "NUMCHARS"
                  ? "Characters"
                  : "Paragraphs"
            ];
          break;
        }
        case "DATE":
        case "TIME":
        case "CREATEDATE":
        case "SAVEDATE": {
          const date =
            code.Type === "CREATEDATE"
              ? new Date(root.props.CreatedAt ?? NaN)
              : code.Type === "SAVEDATE"
                ? new Date(root.props.ModifiedAt ?? NaN)
                : now;
          const picture = code.Switches["@"]?.[0];
          value = picture
            ? formatFieldDate(date, picture, context.Locale)
            : general.includes("ISO")
              ? date.toISOString().slice(0, 10)
              : code.Type === "TIME"
                ? date.toISOString().slice(11, 19)
                : date.toLocaleDateString(context.Locale ?? "en", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                  });
          if (!Number.isFinite(date.getTime()))
            throw new Error("Missing or invalid date property.");
          break;
        }
        case "TITLE":
          value = String(root.props.Title ?? "");
          break;
        case "AUTHOR":
          value = String(root.props.Author ?? "");
          break;
        case "FILENAME":
          value = context.FileName;
          break;
        case "DOCPROPERTY":
          value = property(arg);
          break;
        case "DOCVARIABLE":
          value = variable(arg);
          break;
        case "MERGEFIELD":
          value = own(context.Data, arg);
          break;
        case "SEQ":
          value = sequenceValues.get(node);
          break;
        case "IF": {
          if (code.Arguments.length < 4 || code.Arguments.length > 5)
            throw new SyntaxError(
              "IF requires left, operator, right, true text and optional false text; nested fields are not supported.",
            );
          const operand = (index: number) => {
            const source = code.Arguments[index]!,
              mark = code.Quoted[index] ? undefined : bookmark(source);
            return code.Quoted[index]
              ? source
              : (parseFieldNumber(source) ??
                  (mark ? bookmarkText(mark) : undefined) ??
                  own(context.Data, source) ??
                  variable(source) ??
                  source);
          };
          const left = operand(0),
            right = operand(2);
          const ln = parseFieldNumber(String(left)),
            rn = parseFieldNumber(String(right));
          const order =
            ln !== undefined && rn !== undefined
              ? Math.sign(ln - rn)
              : new Intl.Collator(context.Locale ?? "en", {
                  sensitivity: "base",
                }).compare(String(left), String(right));
          const comparisons: Record<string, boolean> = {
            "=": order === 0,
            "<>": order !== 0,
            "<": order < 0,
            ">": order > 0,
            "<=": order <= 0,
            ">=": order >= 0,
          };
          const operator = code.Arguments[1]!;
          if (!Object.hasOwn(comparisons, operator))
            throw new SyntaxError("Unsupported IF comparison operator.");
          value = code.Arguments[comparisons[operator] ? 3 : 4] ?? "";
          break;
        }
        case "REF":
        case "PAGEREF": {
          if (references && ambiguousIds.has(arg))
            throw new Error(
              "Ambiguous node reference across document stories.",
            );
          const target = byId.get(arg),
            mark = bookmark(arg);
          if (code.Type === "REF")
            value = target
              ? references
                ? references.Node(target)
                : sourceText(target)
              : mark
                ? bookmarkText(mark)
                : undefined;
          else {
            let page = target ? context.PageOfNode?.(target.id) : undefined;
            if (!target && mark) {
              const block = originalBlocks.find(
                (b) => mark.Start >= b.start && mark.Start <= b.end,
              );
              if (block) page = context.PageOfNode?.(block.node.id);
              if (page === undefined && block)
                walk(block.node, (candidate) => {
                  const range = sourceRanges.get(candidate);
                  if (
                    page === undefined &&
                    range &&
                    mark.Start >= range.Start &&
                    mark.Start <= range.End
                  )
                    page = context.PageOfNode?.(candidate.id);
                });
            }
            value = page;
          }
          break;
        }
        default:
          throw new Error(
            "Unsupported field instruction; cached text retained.",
          );
      }
      if (value === undefined)
        throw new Error("Missing field data or unsupported instruction.");
      let display: string;
      const number =
        typeof value === "number"
          ? value
          : code.Switches["#"]
            ? parseFieldNumber(String(value))
            : undefined;
      if (number !== undefined) {
        if (!Number.isFinite(number))
          throw new RangeError("A field result is not finite.");
        numericValues.set(node, number);
        display = code.Switches["#"]
          ? formatFieldNumber(
              number,
              code.Switches["#"][0] ?? "",
              context.Locale,
            )
          : numberFormat(
              number,
              general.find((f) =>
                ["roman", "ROMAN", "alphabetic", "ALPHABETIC"].includes(f),
              ),
            );
      } else {
        if (code.Switches["#"])
          throw new Error("Numeric picture requires a numeric field result.");
        display = String(value);
      }
      if (code.Type === "SEQ" && code.Switches.h) display = "";
      display = formatFieldText(display, general, context.Locale);
      values.set(node, display);
      return display;
    } catch (error) {
      failures.set(
        node,
        error instanceof Error ? error.message : String(error),
      );
      values.set(node, undefined);
      return undefined;
    } finally {
      resolving.delete(node);
    }
  };
  // Evaluate before changing any cache, so dependency traversal cannot observe half-written fields.
  for (const node of fields) resolve(node);
  for (const node of fields) {
    if (node.props.Field.Locked === true) continue;
    const value = values.get(node);
    if (value === undefined) {
      result.Unresolved.push({
        Id: node.id,
        Instruction: String(node.props.Field.Instruction ?? ""),
        Reason: failures.get(node) ?? "Missing field data.",
      });
    } else if (text(node) !== value) {
      const range = sourceRanges.get(node);
      if (range) changes.push({ ...range, NewLength: value.length });
      if (node.type === "Run") node.text = value;
      else {
        const previous = node.children?.[0];
        node.children = [
          {
            type: "Run",
            id: previous?.type === "Run" ? previous.id : new Run().Id,
            props: previous?.type === "Run" ? previous.props : {},
            text: value,
          },
        ];
      }
      result.Updated++;
    }
  }
  mapFieldAnnotations(root, changes);
  result.TextChanges = changes
    .sort((a, b) => a.Start - b.Start || a.End - b.End)
    .map((c) => ({
      Start: c.Start,
      RemovedLength: c.End - c.Start,
      InsertedLength: c.NewLength,
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
  InsertFieldCode(instruction: string, cachedText = "…"): string {
    return this.Engine.InsertNode(
      createFieldFromInstruction(instruction, cachedText).ToJSON(),
    );
  }
  InsertFormula(expression = "SUM(ABOVE)", picture?: string): string {
    validateFormula(expression);
    if (picture) formatFieldNumber(0, picture);
    return this.InsertFieldCode(
      `= ${expression.trim().replace(/^=/, "")}${picture ? ` \\# ${JSON.stringify(picture)}` : ""}`,
    );
  }
  /** Detached outer field at a main-story caret/range, including its trailing boundary. */
  GetSelectedField(): DocumentNode | null {
    const start = this.Engine.Selection.Start.Offset,
      end = this.Engine.Selection.End.Offset;
    let found: DocumentNode | null = null;
    for (const block of textBlocks(this.Engine.Document.ToJSON())) {
      if (block.end < start || block.start > end) continue;
      let offset = block.start;
      const visit = (node: DocumentNode) => {
        const size = inlineText(node).length;
        if (node.props.Field) {
          if (
            start >= offset &&
            end <= offset + size &&
            (!found || start < offset + size)
          )
            found = node;
          offset += size;
        } else if (
          [
            "Run",
            "LineBreak",
            "Image",
            "Equation",
            "Figure",
            "Floater",
            "InlineUIContainer",
            "BlockUIContainer",
          ].includes(node.type)
        )
          offset += size;
        else for (const child of node.children ?? []) visit(child);
      };
      visit(block.node);
    }
    return found;
  }
  /** Replace only the instruction, preserving the cached display and lock state until update. */
  SetFieldCode(id: string, instruction: string): void {
    const definition =
      createFieldFromInstruction(instruction).ToJSON().props.Field;
    const root = this.Engine.Document.ToJSON();
    let found = false;
    for (const story of storyRoots(root))
      walk(story, (node) => {
        if (node.id === id && node.props.Field) {
          node.props.Field = {
            ...definition,
            Locked: node.props.Field.Locked === true,
            Dirty: true,
          };
          found = true;
        }
      });
    if (!found) throw new Error("Field was not found.");
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
      MapAnnotations: false,
    });
  }
  SetFieldLocked(id: string, locked: boolean): void {
    const root = this.Engine.Document.ToJSON();
    let target: DocumentNode | undefined;
    for (const story of storyRoots(root))
      walk(story, (node) => {
        if (node.id === id) target = node;
      });
    if (!target?.props.Field) throw new Error("Field was not found.");
    target.props.Field.Locked = !!locked;
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
      MapAnnotations: false,
    });
  }
  UnlinkField(id: string): void {
    const root = this.Engine.Document.ToJSON();
    let found = false;
    for (const story of storyRoots(root))
      walk(story, (node) => {
        if (node.id === id && node.props.Field) {
          delete node.props.Field;
          found = true;
        }
      });
    if (!found) throw new Error("Field was not found.");
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
      MapAnnotations: false,
    });
  }
  SetDocumentVariable(name: string, value: string | number | boolean): void {
    if (typeof name !== "string" || !name.trim() || name.length > 255)
      throw new TypeError("A variable name of 1–255 characters is required.");
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new TypeError("Variables require a finite scalar value.");
    const root = this.Engine.Document.ToJSON();
    root.props.DocumentVariables = {
      ...(root.props.DocumentVariables ?? {}),
      [name]: value,
    };
    this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
      MapAnnotations: false,
    });
  }
  GetStatistics(options: DocumentStatisticsOptions = {}): DocumentStatistics {
    return getDocumentStatistics(this.Engine.Document, options);
  }
  /** Insert an independent caption paragraph and native bookmark targets as one undo action. */
  InsertCaption(
    options: CaptionOptions = {},
    context: FieldContext = {},
  ): CaptionReference {
    const label = options.Label ?? "Figure",
      content = options.Text ?? "Caption",
      separator = options.Separator ?? ": ";
    if (!label.trim() || label.length > 64 || /[\r\n\u0000-\u001f]/.test(label))
      throw new TypeError(
        "A caption label of 1–64 printable characters is required.",
      );
    if (
      options.NumberFormat &&
      !["ARABIC", "roman", "ROMAN", "alphabetic", "ALPHABETIC"].includes(
        options.NumberFormat,
      )
    )
      throw new TypeError("Unsupported caption number format.");
    const sequence = createField("SEQ", label, options.NumberFormat);
    const paragraph = new Paragraph([
      new Run(label + " "),
      sequence,
      new Run(separator + content),
    ]);
    paragraph.SetValue("Caption", { Label: label });
    paragraph.SetValue("StyleName", "Caption");
    const token = new Run().Id;
    paragraph.SetValue("CaptionInstance", token);
    const reference: CaptionReference = {
      Id: "",
      Bookmark: "",
      NumberBookmark: "",
      LabelNumberBookmark: "",
    };
    this.Engine.Change(() => {
      // A section avoids merging a caption into text on either side of the insertion point.
      this.Engine.InsertNode(new Section(paragraph).ToJSON());
      this.UpdateFields(context);
      const root = this.Engine.Document.ToJSON();
      const block = textBlocks(root).find(
        (b) => b.node.props.CaptionInstance === token,
      )!;
      reference.Id = block.node.id;
      const prefix =
        "_rt" + block.node.id.replace(/[^a-zA-Z0-9]/g, "").slice(-28);
      reference.Bookmark = prefix + "All";
      reference.NumberBookmark = prefix + "Num";
      reference.LabelNumberBookmark = prefix + "Label";
      const field = block.node.children!.find((n) => n.props.Field)!;
      const numberLength = text(field).length,
        selection = {
          Start: this.Engine.Selection.Start.Offset,
          End: this.Engine.Selection.End.Offset,
        };
      for (const [name, start, end] of [
        [reference.Bookmark, block.start, block.end],
        [
          reference.NumberBookmark,
          block.start + label.length + 1,
          block.start + label.length + 1 + numberLength,
        ],
        [
          reference.LabelNumberBookmark,
          block.start,
          block.start + label.length + 1 + numberLength,
        ],
      ] as [string, number, number][]) {
        this.Engine.Select(start, end);
        this.Engine.AddBookmark(name);
      }
      this.Engine.Select(selection.Start, selection.End);
      this.Engine.SetElementProperty(reference.Id, "Caption", {
        Label: label,
        ...reference,
      });
    });
    return reference;
  }
  InsertCrossReference(
    bookmarkName: string,
    options: { PageNumber?: boolean; Hyperlink?: boolean } = {},
    context: FieldContext = {},
  ): string {
    if (
      !this.Engine.Annotations.some(
        (a) => a.Kind === "Bookmark" && a.Data.Name === bookmarkName,
      )
    )
      throw new Error("Cross-reference bookmark was not found.");
    let id = "";
    this.Engine.Change(() => {
      id = this.InsertFieldCode(
        `${options.PageNumber ? "PAGEREF" : "REF"} ${JSON.stringify(bookmarkName)}${options.Hyperlink === false ? "" : " \\h"}`,
      );
      this.UpdateFields(context);
    });
    return id;
  }
  InsertTableOfFigures(
    label = "Figure",
    options: Omit<TableOfContentsOptions, "MaxLevel" | "CaptionLabel"> = {},
    context: FieldContext = {},
  ): void {
    if (!label.trim() || label.length > 64 || /[\r\n\u0000-\u001f]/.test(label))
      throw new TypeError("Invalid caption label.");
    this.InsertTableOfContents(
      {
        ...options,
        CaptionLabel: label,
        Title: options.Title ?? `Table of ${label}s`,
      },
      context,
    );
  }
  UpdateFields(context: FieldContext = {}): FieldUpdateResult {
    const root = this.Engine.Document.ToJSON(),
      result = updateDocumentFields(root, context);
    if (result.Updated) {
      const start = this.Engine.Selection.Start.Offset,
        end = this.Engine.Selection.End.Offset;
      const move = (offset: number, trailing: boolean) => {
        let delta = 0;
        for (const change of result.TextChanges) {
          if (offset < change.Start) break;
          const finish = change.Start + change.RemovedLength;
          // Leading boundaries stay before nonempty fields, including range ends.
          // Only carets strictly inside a replaced result follow its trailing edge.
          if (offset === change.Start && change.RemovedLength > 0)
            return change.Start + delta;
          if (offset >= finish)
            delta += change.InsertedLength - change.RemovedLength;
          else
            return (
              change.Start + delta + (trailing ? change.InsertedLength : 0)
            );
        }
        return offset + delta;
      };
      this.Engine.Change(() => {
        this.Engine.ReplaceDocument(FlowDocument.FromJSON(root), {
          MapAnnotations: false,
          TextChanges: result.TextChanges,
        });
        this.Engine.Select(move(start, start === end), move(end, true));
      });
    }
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
      ...(options.CaptionLabel
        ? {
            CaptionLabel: options.CaptionLabel,
            Instruction: `TOC \\c ${JSON.stringify(options.CaptionLabel)} \\h`,
          }
        : {}),
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
        (options.CaptionLabel
          ? node.props.Caption?.Label === options.CaptionLabel
          : level >= 1 && level <= options.MaxLevel)
      ) {
        const page = options.IncludePageNumbers
          ? context.PageOfNode?.(node.id)
          : undefined;
        const p = new Paragraph(
          `${text(node)}${page === undefined ? "" : `\t${page}`}`,
        );
        p.SetValue("TocTargetId", node.id);
        p.SetValue("Margin", {
          Left: options.CaptionLabel ? 0 : (level - 1) * 18,
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
