import type { DocumentNode } from "./model.js";

export type DocumentStyleKind = "Paragraph" | "Character";
/** Portable document style. Properties are absolute values, not Open XML toggle instructions. */
export interface DocumentStyle {
  Id: string;
  Name: string;
  Kind: DocumentStyleKind;
  BasedOn?: string;
  Next?: string;
  IsDefault?: boolean;
  Properties: Record<string, any>;
}
export const characterStyleProperties = [
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "Foreground",
  "Background",
  "TextDecorations",
  "BaselineAlignment",
  "Language",
] as const;
export const paragraphStyleProperties = [
  ...characterStyleProperties,
  "TextAlignment",
  "FlowDirection",
  "Margin",
  "LineHeight",
  "TextIndent",
  "HeadingLevel",
  "BreakPageBefore",
  "KeepTogether",
  "KeepWithNext",
] as const;
const characterKeys = new Set<string>(characterStyleProperties);
const paragraphKeys = new Set<string>(paragraphStyleProperties);
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value);
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const choices: Record<string, string[]> = {
  FontWeight: ["Normal", "Bold"],
  FontStyle: ["Normal", "Italic"],
  TextDecorations: ["None", "Underline"],
  BaselineAlignment: ["Baseline", "Superscript", "Subscript"],
  TextAlignment: ["Left", "Center", "Right", "Justify"],
  FlowDirection: ["LeftToRight", "RightToLeft"],
};
/** Validate completely before catalog mutation. Returned objects never alias the caller's data. */
export function validateDocumentStyles(input: unknown): DocumentStyle[] {
  if (!Array.isArray(input) || input.length > 256)
    throw new Error("Document styles must be an array of at most 256 entries.");
  const result: DocumentStyle[] = [],
    ids = new Map<string, DocumentStyle>();
  for (const value of input) {
    if (!record(value) || !id(value.Id) || ids.has(value.Id))
      throw new Error("A style requires a unique portable Id.");
    if (
      typeof value.Name !== "string" ||
      !value.Name.trim() ||
      value.Name.length > 256
    )
      throw new Error(
        "A style requires a nonempty Name of at most 256 characters.",
      );
    if (!["Paragraph", "Character"].includes(value.Kind))
      throw new Error("Style Kind must be Paragraph or Character.");
    if (
      value.Kind !== "Paragraph" &&
      /^(Normal|Caption|Heading[1-6])$/.test(value.Id)
    )
      throw new Error(
        "Built-in paragraph style identities cannot be used for character styles.",
      );
    if (!record(value.Properties))
      throw new Error("Style Properties must be an object.");
    for (const key of Object.keys(value))
      if (
        ![
          "Id",
          "Name",
          "Kind",
          "BasedOn",
          "Next",
          "IsDefault",
          "Properties",
        ].includes(key)
      )
        throw new Error(`Unsupported style metadata: ${key}.`);
    for (const key of ["BasedOn", "Next"])
      if (value[key] !== undefined && !id(value[key]))
        throw new Error(`Invalid style ${key}.`);
    if (value.IsDefault !== undefined && typeof value.IsDefault !== "boolean")
      throw new Error("IsDefault must be a boolean.");
    if (value.Kind === "Character" && (value.Next || value.IsDefault))
      throw new Error(
        "Only paragraph styles have a Next or default paragraph role.",
      );
    const allowed = value.Kind === "Paragraph" ? paragraphKeys : characterKeys;
    for (const [key, v] of Object.entries(value.Properties)) {
      if (!allowed.has(key))
        throw new Error(`Unsupported ${value.Kind} style property: ${key}.`);
      if (own(choices, key)) {
        if (!choices[key]!.includes(v as string))
          throw new Error(`Unsupported style ${key}.`);
      } else if (
        ["BreakPageBefore", "KeepTogether", "KeepWithNext"].includes(key)
      ) {
        if (typeof v !== "boolean") throw new Error(`${key} must be boolean.`);
      } else if (key === "Margin") {
        if (typeof v === "number") {
          if (!Number.isFinite(v) || v < 0 || v > 10000)
            throw new Error("Invalid style Margin.");
        } else if (
          !record(v) ||
          Object.keys(v).some(
            (k) => !["Left", "Top", "Right", "Bottom"].includes(k),
          ) ||
          Object.values(v).some(
            (n) =>
              typeof n !== "number" ||
              !Number.isFinite(n) ||
              n < 0 ||
              n > 10000,
          )
        )
          throw new Error("Invalid style Margin.");
      } else if (
        ["FontSize", "LineHeight", "TextIndent", "HeadingLevel"].includes(key)
      ) {
        if (
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          Math.abs(v) > 10000 ||
          (["FontSize", "LineHeight"].includes(key) && v <= 0) ||
          (key === "HeadingLevel" && (!Number.isInteger(v) || v < 0 || v > 6))
        )
          throw new Error(`Invalid style ${key}.`);
      } else if (
        typeof v !== "string" ||
        !v ||
        v.length > 256 ||
        /[\x00-\x1f]/.test(v)
      )
        throw new Error(`Invalid style ${key}.`);
    }
    const style = structuredClone(value) as DocumentStyle;
    result.push(style);
    ids.set(style.Id, style);
  }
  if (result.filter((s) => s.IsDefault).length > 1)
    throw new Error("Only one default paragraph style is allowed.");
  for (const style of result) {
    if (style.Next && ids.get(style.Next)?.Kind !== "Paragraph")
      throw new Error(`Unknown or incompatible next style: ${style.Next}.`);
    const seen = new Set<string>();
    let current: DocumentStyle | undefined = style;
    while (current) {
      if (seen.has(current.Id) || seen.size >= 64)
        throw new Error("Style inheritance is cyclic or exceeds 64 levels.");
      seen.add(current.Id);
      if (!current.BasedOn) break;
      const parent = ids.get(current.BasedOn);
      if (!parent || parent.Kind !== current.Kind)
        throw new Error(
          `Unknown or incompatible base style: ${current.BasedOn}.`,
        );
      current = parent;
    }
  }
  return result;
}
interface Catalog {
  styles: DocumentStyle[];
  byId: Map<string, DocumentStyle>;
  resolved: Map<string, Record<string, any>>;
}
// Catalog arrays in canonical snapshots and model local values are immutable to this module.
const catalogs = new WeakMap<object, Catalog>();
function catalog(input: unknown): Catalog {
  if (!Array.isArray(input))
    return { styles: [], byId: new Map(), resolved: new Map() };
  let cached = catalogs.get(input);
  if (!cached) {
    const styles = validateDocumentStyles(input);
    cached = {
      styles,
      byId: new Map(styles.map((s) => [s.Id, s])),
      resolved: new Map(),
    };
    catalogs.set(input, cached);
  }
  return cached;
}
function resolveStyle(c: Catalog, style: DocumentStyle): Record<string, any> {
  let properties = c.resolved.get(style.Id);
  if (!properties) {
    const base = style.BasedOn
      ? resolveStyle(c, c.byId.get(style.BasedOn)!)
      : {};
    properties = { ...base, ...style.Properties };
    // Native paragraph spacing and indentation inherit independently by side.
    if (record(style.Properties.Margin) && base.Margin !== undefined) {
      const inherited =
        typeof base.Margin === "number"
          ? {
              Left: base.Margin,
              Top: base.Margin,
              Right: base.Margin,
              Bottom: base.Margin,
            }
          : base.Margin;
      properties.Margin = { ...inherited, ...style.Properties.Margin };
    }
    c.resolved.set(style.Id, properties);
  }
  return properties;
}
export function resolveDocumentStyle(
  input: unknown,
  styleId: string,
): Record<string, any> {
  // Public callers may mutate and reuse their input array. Never cache it by identity.
  const styles = validateDocumentStyles(input);
  const c: Catalog = {
    styles,
    byId: new Map(styles.map((s) => [s.Id, s])),
    resolved: new Map(),
  };
  const style = c.byId.get(styleId);
  if (!style) throw new Error(`Document style ${styleId} was not found.`);
  return structuredClone(resolveStyle(c, style));
}
/** @internal Named style layer below local properties and above inherited parent values. */
export function nodeStyleProperties(
  type: string,
  props: Record<string, any>,
  input: unknown,
): Record<string, any> {
  if (!Array.isArray(input) || !input.length) return {};
  const c = catalog(input);
  const styleId =
    type === "Paragraph"
      ? (props.ParagraphStyleId ?? c.styles.find((s) => s.IsDefault)?.Id)
      : props.CharacterStyleId;
  const style = c.byId.get(styleId);
  if (
    !style ||
    style.Kind !== (type === "Paragraph" ? "Paragraph" : "Character")
  )
    return {};
  return structuredClone(resolveStyle(c, style));
}
/** Resolve a copy for formats without native style catalogs. The canonical document is not flattened. */
export function materializeDocumentStyles(root: DocumentNode): DocumentNode {
  const copy = structuredClone(root),
    styles = root.props.DocumentStyles;
  if (!styles) return copy;
  const visit = (node: DocumentNode) => {
    node.props = {
      ...nodeStyleProperties(node.type, node.props, styles),
      ...node.props,
    };
    for (const child of node.children ?? []) visit(child);
    for (const key of [
      "Headers",
      "Footers",
      "FirstPageHeader",
      "FirstPageFooter",
      "EvenPageHeader",
      "EvenPageFooter",
    ])
      for (const block of node.props[key] ?? []) visit(block);
    for (const key of ["Footnotes", "Endnotes"])
      for (const note of node.props[key] ?? [])
        for (const block of note.Blocks ?? []) visit(block);
  };
  visit(copy);
  return copy;
}
/** @internal Validate references across main, floating, header/footer and note stories. */
export function visitStyledNodes(
  root: DocumentNode,
  visit: (node: DocumentNode) => void,
): void {
  visit(root);
  for (const child of root.children ?? []) visitStyledNodes(child, visit);
  for (const key of [
    "Headers",
    "Footers",
    "FirstPageHeader",
    "FirstPageFooter",
    "EvenPageHeader",
    "EvenPageFooter",
  ])
    for (const block of root.props[key] ?? []) visitStyledNodes(block, visit);
  for (const key of ["Footnotes", "Endnotes"])
    for (const note of root.props[key] ?? [])
      for (const block of note.Blocks ?? []) visitStyledNodes(block, visit);
}
