import type { DocumentNode } from "./model.js";
import {
  clone,
  inlineText,
  makeNode,
  plainText,
  run,
  textBlocks,
  uid,
} from "./engine-tree.js";
import { formatFieldDate } from "./field-code.js";

export type ContentControlKind =
  "RichText" | "PlainText" | "CheckBox" | "DropDownList" | "ComboBox" | "Date";
export interface ContentControlItem {
  DisplayText: string;
  Value: string;
}
export interface ContentControlOptions {
  Kind: ContentControlKind;
  Level?: "Inline" | "Block";
  Title?: string;
  Tag?: string;
  Placeholder?: string;
  LockContentControl?: boolean;
  LockContents?: boolean;
  Required?: boolean;
  MaxLength?: number;
  Multiline?: boolean;
  Items?: ContentControlItem[];
  DateFormat?: string;
  DateLocale?: string;
  CheckedSymbol?: string;
  UncheckedSymbol?: string;
  CheckedFont?: string;
  UncheckedFont?: string;
}
export interface ContentControlProperties extends ContentControlOptions {
  Id: string;
  Level: "Inline" | "Block";
  ShowingPlaceholder: boolean;
  /** Scalar state for dates, choices and checkboxes; text controls read their actual rich content. */
  Value?: string | boolean;
}
export interface ContentControlInfo {
  Id: string;
  NodeId: string;
  Properties: ContentControlProperties;
  Value: string | boolean;
  Text: string;
  /** Null for independent header/footer/note/floating stories. */
  Start: number | null;
  End: number | null;
  Content: DocumentNode[];
}
export interface ContentControlValidation {
  Id: string;
  Tag: string;
  Message: string;
}
export interface ContentControlWrite {
  Id: string;
  Operation: "Value" | "Properties" | "Remove";
}

const kinds = [
  "RichText",
  "PlainText",
  "CheckBox",
  "DropDownList",
  "ComboBox",
  "Date",
];
const keys = new Set([
  "Kind",
  "Level",
  "Title",
  "Tag",
  "Placeholder",
  "LockContentControl",
  "LockContents",
  "Required",
  "MaxLength",
  "Multiline",
  "Items",
  "DateFormat",
  "DateLocale",
  "Id",
  "ShowingPlaceholder",
  "Value",
  "CheckedSymbol",
  "UncheckedSymbol",
  "CheckedFont",
  "UncheckedFont",
]);
const controlChars = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const textValue = (value: unknown, name: string, limit = 65536): string => {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    controlChars.test(value)
  )
    throw new TypeError(
      `${name} must be text of at most ${limit} UTF-16 units without XML control characters.`,
    );
  return value;
};
export function validateContentControlProperties(
  value: unknown,
): ContentControlProperties {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid content-control properties.");
  const p = value as ContentControlProperties;
  for (const key of Object.keys(p))
    if (!keys.has(key))
      throw new TypeError(`Unknown content-control property: ${key}.`);
  if (!kinds.includes(p.Kind) || !["Inline", "Block"].includes(p.Level))
    throw new TypeError("Unsupported content-control kind or level.");
  if (!textValue(p.Id, "Control ID", 128))
    throw new TypeError("A control ID is required.");
  for (const key of [
    "Title",
    "Tag",
    "Placeholder",
    "DateFormat",
    "DateLocale",
  ] as const)
    if (p[key] !== undefined)
      textValue(p[key], key, key === "Placeholder" ? 1024 : 255);
  for (const key of [
    "LockContentControl",
    "LockContents",
    "Required",
    "Multiline",
    "ShowingPlaceholder",
  ] as const)
    if (p[key] !== undefined && typeof p[key] !== "boolean")
      throw new TypeError(`${key} must be boolean.`);
  if (typeof p.ShowingPlaceholder !== "boolean")
    throw new TypeError("ShowingPlaceholder must be boolean.");
  if (
    p.MaxLength !== undefined &&
    (!Number.isSafeInteger(p.MaxLength) ||
      p.MaxLength < 1 ||
      p.MaxLength > 65536)
  )
    throw new RangeError("MaxLength must be an integer between 1 and 65,536.");
  if (p.Items !== undefined) {
    if (
      !["DropDownList", "ComboBox"].includes(p.Kind) ||
      !Array.isArray(p.Items) ||
      p.Items.length > 256
    )
      throw new TypeError("Choice controls accept at most 256 items.");
    const seen = new Set<string>();
    for (const item of p.Items) {
      if (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).some((k) => !["DisplayText", "Value"].includes(k))
      )
        throw new TypeError("Invalid choice item.");
      textValue(item.DisplayText, "Choice display text", 1024);
      textValue(item.Value, "Choice value", 1024);
      if (!item.DisplayText || !item.Value || seen.has(item.Value))
        throw new TypeError("Choice values must be nonempty and unique.");
      seen.add(item.Value);
    }
  }
  if (p.Kind === "DropDownList" && !p.Items?.length)
    throw new TypeError("A drop-down control requires choices.");
  if (p.DateFormat !== undefined || p.DateLocale !== undefined) {
    if (p.Kind !== "Date")
      throw new TypeError("Date options require a date control.");
    formatFieldDate(
      new Date("2000-01-02T00:00:00Z"),
      p.DateFormat ?? "yyyy-MM-dd",
      p.DateLocale ?? "en-US",
    );
  }
  for (const key of [
    "CheckedSymbol",
    "UncheckedSymbol",
    "CheckedFont",
    "UncheckedFont",
  ] as const) {
    if (p[key] === undefined) continue;
    textValue(p[key], key, 255);
    if (p.Kind !== "CheckBox")
      throw new TypeError("Checkbox symbol options require a checkbox.");
    if (
      key.endsWith("Symbol") &&
      ([...p[key]!].length !== 1 || /[\uD800-\uDFFF]/u.test(p[key]!))
    )
      throw new TypeError("Checkbox symbols require one Unicode scalar.");
  }
  if (p.Value !== undefined && typeof p.Value !== "boolean")
    textValue(p.Value, "Control value");
  if (
    p.Kind === "CheckBox" &&
    (typeof p.Value !== "boolean" || p.ShowingPlaceholder)
  )
    throw new TypeError("A checkbox requires a boolean state.");
  if (["PlainText", "RichText"].includes(p.Kind) && p.Value !== undefined)
    throw new TypeError(
      "Text controls store actual content, not a second value cache.",
    );
  return clone(p);
}

export function contentControlText(node: DocumentNode): string {
  return node.type === "Section" ? plainText(node) : inlineText(node);
}
export function contentControlValue(node: DocumentNode): string | boolean {
  const p = validateContentControlProperties(node.props.ContentControl);
  return p.Kind === "CheckBox"
    ? Boolean(p.Value)
    : p.ShowingPlaceholder
      ? ""
      : (p.Value ?? contentControlText(node));
}
function scalarDisplay(
  p: ContentControlProperties,
  value: string | boolean,
): string {
  if (p.Kind === "CheckBox") {
    if (typeof value !== "boolean")
      throw new TypeError("A checkbox value must be boolean.");
    p.Value = value;
    p.ShowingPlaceholder = false;
    return value ? (p.CheckedSymbol ?? "☒") : (p.UncheckedSymbol ?? "☐");
  }
  value = textValue(value, "Control value").replace(/\r\n?/g, "\n");
  if (
    (!p.Multiline || !["PlainText", "RichText"].includes(p.Kind)) &&
    value.includes("\n")
  )
    throw new TypeError("This control requires a single-line value.");
  if (p.MaxLength && [...value].length > p.MaxLength)
    throw new RangeError("The value exceeds the control's maximum length.");
  p.ShowingPlaceholder = value === "";
  if (!["PlainText", "RichText"].includes(p.Kind)) p.Value = value;
  if (p.ShowingPlaceholder)
    return p.Placeholder || "Click or tap here to enter text.";
  if (["DropDownList", "ComboBox"].includes(p.Kind)) {
    const item = p.Items?.find((item) => item.Value === value);
    if (!item && p.Kind === "DropDownList")
      throw new TypeError("Choose a value from the drop-down list.");
    return item?.DisplayText ?? value;
  }
  if (p.Kind === "Date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new TypeError("Dates require YYYY-MM-DD.");
    const date = new Date(value + "T00:00:00Z");
    if (
      !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new TypeError("Invalid Gregorian date.");
    return formatFieldDate(
      date,
      p.DateFormat ?? "yyyy-MM-dd",
      p.DateLocale ?? "en-US",
    );
  }
  return value;
}
/** Prepare a detached value; callers commit only after every validation succeeds. */
export function withContentControlValue(
  node: DocumentNode,
  value: string | boolean,
): DocumentNode {
  const next = clone(node),
    p = validateContentControlProperties(next.props.ContentControl);
  const display = scalarDisplay(p, value);
  next.props.ContentControl = p;
  let style: Record<string, unknown> = {};
  const findRun = (n: DocumentNode): boolean => {
    if (n.type === "Run") {
      style = clone(n.props);
      return true;
    }
    return (n.children ?? []).some(findRun);
  };
  findRun(node);
  delete style.Field;
  delete style.ContentControl;
  let symbolFontChanged = false;
  if (p.Kind === "CheckBox") {
    const font = p.Value ? p.CheckedFont : p.UncheckedFont;
    if (font) {
      symbolFontChanged = style.FontFamily !== font;
      style.FontFamily = font;
    }
  }
  if (
    display !== contentControlText(node) ||
    !node.children?.length ||
    symbolFontChanged
  ) {
    const inlines = [run(display, style)];
    next.children =
      p.Level === "Block"
        ? [
            makeNode(
              "Paragraph",
              inlines,
              clone(node.children?.[0]?.props ?? {}),
            ),
          ]
        : inlines;
  }
  validateContentControlNode(next);
  return next;
}
export function createContentControl(
  options: ContentControlOptions,
  value: string | boolean = "",
): DocumentNode {
  if (
    !options ||
    typeof options !== "object" ||
    "Id" in options ||
    "Value" in options ||
    "ShowingPlaceholder" in options
  )
    throw new TypeError(
      "Create a control with authoring options, not stored state.",
    );
  const p = validateContentControlProperties({
    ...(options.Kind === "RichText" ? { Multiline: true } : {}),
    ...options,
    Id: uid(),
    Level: options.Level ?? "Inline",
    ShowingPlaceholder: options.Kind !== "CheckBox",
    ...(options.Kind === "CheckBox" ? { Value: false } : {}),
  });
  return withContentControlValue(
    makeNode(p.Level === "Block" ? "Section" : "Span", [], {
      ContentControl: p,
    }),
    options.Kind === "CheckBox" && value === "" ? false : value,
  );
}
export function validateContentControlNode(node: DocumentNode): void {
  const p = validateContentControlProperties(node.props.ContentControl);
  if (
    node.type !== (p.Level === "Block" ? "Section" : "Span") ||
    !Array.isArray(node.children) ||
    !node.children.length
  )
    throw new TypeError(
      "Content controls require a nonempty Span or Section wrapper matching their level.",
    );
  if (
    p.Level === "Block" &&
    p.Kind !== "RichText" &&
    (node.children.length !== 1 || node.children[0]?.type !== "Paragraph")
  )
    throw new TypeError("Scalar block controls require one paragraph.");
  const value = textValue(contentControlText(node), "Control content", 1000000);
  if (p.Kind === "RichText" && p.Multiline === false && value.includes("\n"))
    throw new TypeError("This control requires a single-line value.");
  if (value.length > 1000000)
    throw new RangeError("Control content exceeds one million UTF-16 units.");
  if (p.Kind !== "RichText") {
    const inlines =
      p.Level === "Block" ? (node.children[0]!.children ?? []) : node.children;
    if (
      inlines.some(
        (n) =>
          n.type !== "Run" &&
          !(p.Kind === "PlainText" && p.Multiline && n.type === "LineBreak"),
      )
    )
      throw new TypeError("Scalar controls contain text runs only.");
    if (p.Kind === "PlainText") {
      if (!p.ShowingPlaceholder) scalarDisplay(clone(p), value);
    } else if (value !== scalarDisplay(clone(p), p.Value ?? ""))
      throw new TypeError(
        "The scalar control display does not match its value. Use SetContentControlValue.",
      );
  }
  if (!p.ShowingPlaceholder && p.MaxLength && [...value].length > p.MaxLength)
    throw new RangeError("The control exceeds its maximum length.");
}

const storyKeys = [
  "Headers",
  "Footers",
  "FirstPageHeader",
  "FirstPageFooter",
  "EvenPageHeader",
  "EvenPageFooter",
];
export function collectContentControlNodes(root: DocumentNode): DocumentNode[] {
  const result: DocumentNode[] = [],
    ids = new Set<string>();
  let budget = 500000;
  const visit = (n: DocumentNode, depth: number) => {
    if (--budget < 0 || depth > 128)
      throw new RangeError("Content-control traversal limit exceeded.");
    if (n.props.ContentControl !== undefined) {
      validateContentControlNode(n);
      const id = n.props.ContentControl.Id;
      if (ids.has(id)) throw new Error("Duplicate content-control identity.");
      ids.add(id);
      result.push(n);
      if (result.length > 10000)
        throw new RangeError("At most 10,000 content controls are supported.");
    }
    for (const child of n.children ?? []) visit(child, depth + 1);
    for (const key of storyKeys)
      for (const child of n.props[key] ?? []) visit(child, depth + 1);
    for (const key of ["Footnotes", "Endnotes"])
      for (const note of n.props[key] ?? [])
        for (const child of note.Blocks ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return result;
}
function mainRanges(
  root: DocumentNode,
): Map<string, { Start: number; End: number }> {
  type Range = { Start: number; End: number };
  const ranges = new Map<string, Range>();
  const blocks = new Map(textBlocks(root).map((b) => [b.node, b]));
  const inline = (n: DocumentNode, start: number) => {
    const range = { Start: start, End: start + inlineText(n).length };
    if (n.props.ContentControl) ranges.set(n.props.ContentControl.Id, range);
    if (
      ![
        "Figure",
        "Floater",
        "InlineUIContainer",
        "BlockUIContainer",
        "Equation",
        "Image",
      ].includes(n.type)
    )
      for (const child of n.children ?? []) {
        inline(child, start);
        start += inlineText(child).length;
      }
    return range;
  };
  const visit = (n: DocumentNode): Range | undefined => {
    const block = blocks.get(n);
    if (block) return inline(n, block.start);
    let range: Range | undefined;
    for (const child of n.children ?? []) {
      const next = visit(child);
      if (next) range = { Start: range?.Start ?? next.Start, End: next.End };
    }
    if (range && n.props.ContentControl)
      ranges.set(n.props.ContentControl.Id, range);
    return range;
  };
  visit(root);
  return ranges;
}
export function getContentControls(root: DocumentNode): ContentControlInfo[] {
  const nodes = collectContentControlNodes(root),
    ranges = mainRanges(root);
  return nodes.map((node) => ({
    Id: node.props.ContentControl.Id,
    NodeId: node.id,
    Properties: clone(node.props.ContentControl),
    Value: contentControlValue(node),
    Text: contentControlText(node),
    Start: ranges.get(node.props.ContentControl.Id)?.Start ?? null,
    End: ranges.get(node.props.ContentControl.Id)?.End ?? null,
    Content: clone(node.children ?? []),
  }));
}
/** Rekey a complete pasted control; tree-internal slicing must NOT rekey it. */
export function rekeyContentControls(node: DocumentNode): void {
  for (const control of collectContentControlNodes(node))
    control.props.ContentControl.Id = uid();
}
const semantic = (node: DocumentNode): unknown => ({
  type: node.type,
  props: node.props,
  ...(node.text !== undefined ? { text: node.text } : {}),
  children: node.children?.map(semantic),
});
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Editing restrictions, not authentication: trusted hosts can still replace/load the entire model. */
export function enforceContentControlMutation(
  before: DocumentNode,
  after: DocumentNode,
  writes: ContentControlWrite[] = [],
): void {
  const old = collectContentControlNodes(before);
  if (!old.length) {
    collectContentControlNodes(after);
    return;
  }
  // Text edits replace placeholder content without retaining a stale placeholder flag.
  const unchecked = new Map<string, DocumentNode>();
  const visit = (n: DocumentNode) => {
    if (n.props.ContentControl) unchecked.set(n.props.ContentControl.Id, n);
    n.children?.forEach(visit);
    for (const key of storyKeys)
      for (const child of n.props[key] ?? []) visit(child);
    for (const key of ["Footnotes", "Endnotes"])
      for (const note of n.props[key] ?? [])
        for (const child of note.Blocks ?? []) visit(child);
  };
  visit(after);
  for (const n of old) {
    const next = unchecked.get(n.props.ContentControl.Id),
      p = n.props.ContentControl;
    if (
      next &&
      !writes.some((w) => w.Id === p.Id) &&
      p.ShowingPlaceholder &&
      ["PlainText", "RichText"].includes(p.Kind) &&
      !p.LockContents &&
      !equal(n.children?.map(semantic), next.children?.map(semantic))
    )
      next.props.ContentControl.ShowingPlaceholder = false;
  }
  const next = new Map(
    collectContentControlNodes(after).map((n) => [
      n.props.ContentControl.Id,
      n,
    ]),
  );
  for (const n of old) {
    const p = n.props.ContentControl as ContentControlProperties,
      target = next.get(p.Id),
      permit = writes.find((w) => w.Id === p.Id);
    if (!target) {
      if (p.LockContentControl)
        throw new Error(
          `Content control '${p.Title || p.Tag || p.Id}' cannot be removed.`,
        );
      continue;
    }
    const sameContent = equal(
      n.children?.map(semantic),
      target.children?.map(semantic),
    );
    if (!sameContent && p.LockContents)
      throw new Error(`Contents of '${p.Title || p.Tag || p.Id}' are locked.`);
    if (!sameContent && !permit && !["PlainText", "RichText"].includes(p.Kind))
      throw new Error(
        "Use SetContentControlValue to edit a typed content control.",
      );
    const expected = clone(p);
    if (
      !sameContent &&
      p.ShowingPlaceholder &&
      ["PlainText", "RichText"].includes(p.Kind)
    )
      expected.ShowingPlaceholder = false;
    if (!equal(expected, target.props.ContentControl) && !permit)
      throw new Error(
        "Use SetContentControlProperties to change content-control options.",
      );
    if (n.type !== target.type)
      throw new Error("A content control cannot change its wrapper level.");
  }
}
export function validateContentControls(
  root: DocumentNode,
): ContentControlValidation[] {
  return getContentControls(root).flatMap((info) =>
    info.Properties.Required && (info.Value === "" || info.Value === false)
      ? [
          {
            Id: info.Id,
            Tag: info.Properties.Tag ?? "",
            Message: `${info.Properties.Title || info.Properties.Tag || "Content control"} is required.`,
          },
        ]
      : [],
  );
}
