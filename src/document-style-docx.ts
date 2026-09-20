import { child, descendants, type MarkupNode } from "./formats-markup.js";
import {
  resolveDocumentStyle,
  validateDocumentStyles,
  type DocumentStyle,
} from "./document-styles.js";
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const val = (n?: MarkupNode) => n?.attrs["w:val"];
const bool = (n?: MarkupNode) =>
  !!n && !["0", "false", "off"].includes(val(n) ?? "");
const twip = (n: unknown) => Math.round(Number(n ?? 0) * 15);
/** Native style definitions retain inheritance; bold/italic setters are converted to OOXML toggles. */
export function documentStylesXML(
  styles: DocumentStyle[],
  runXML: (props: Record<string, any>) => string,
): string {
  validateDocumentStyles(styles);
  return styles
    .map((s) => {
      const p = s.Properties,
        base = s.BasedOn ? resolveDocumentStyle(styles, s.BasedOn) : {};
      let paragraph = "";
      if (p.HeadingLevel !== undefined)
        paragraph += `<w:outlineLvl w:val="${p.HeadingLevel ? p.HeadingLevel - 1 : 9}"/>`;
      if (p.TextAlignment)
        paragraph += `<w:jc w:val="${p.TextAlignment === "Justify" ? "both" : p.TextAlignment.toLowerCase()}"/>`;
      if (p.FlowDirection)
        paragraph += `<w:bidi w:val="${p.FlowDirection === "RightToLeft" ? 1 : 0}"/>`;
      for (const [key, tag] of [
        ["KeepTogether", "keepLines"],
        ["KeepWithNext", "keepNext"],
        ["BreakPageBefore", "pageBreakBefore"],
      ])
        if (p[key] !== undefined)
          paragraph += `<w:${tag} w:val="${p[key] ? 1 : 0}"/>`;
      const m =
        typeof p.Margin === "number"
          ? { Left: p.Margin, Top: p.Margin, Right: p.Margin, Bottom: p.Margin }
          : (p.Margin ?? {});
      const spacing = [
        m.Top === undefined ? "" : ` w:before="${twip(m.Top)}"`,
        m.Bottom === undefined ? "" : ` w:after="${twip(m.Bottom)}"`,
        p.LineHeight === undefined
          ? ""
          : ` w:line="${twip(p.LineHeight)}" w:lineRule="exact"`,
      ].join("");
      const indent = [
        m.Left === undefined ? "" : ` w:left="${twip(m.Left)}"`,
        m.Right === undefined ? "" : ` w:right="${twip(m.Right)}"`,
        p.TextIndent === undefined
          ? ""
          : ` w:${p.TextIndent < 0 ? "hanging" : "firstLine"}="${twip(Math.abs(p.TextIndent))}"`,
      ].join("");
      if (spacing) paragraph += `<w:spacing${spacing}/>`;
      if (indent) paragraph += `<w:ind${indent}/>`;
      const character = { ...p };
      delete character.FontWeight;
      delete character.FontStyle;
      let runs = runXML(character),
        toggles = "";
      for (const [key, tag, on] of [
        ["FontWeight", "b", "Bold"],
        ["FontStyle", "i", "Italic"],
      ])
        if (p[key] !== undefined && (p[key] === on) !== (base[key] === on))
          toggles += `<w:${tag}/>`;
      if (toggles)
        runs = runs
          ? runs.replace("</w:rPr>", toggles + "</w:rPr>")
          : `<w:rPr>${toggles}</w:rPr>`;
      return `<w:style w:type="${s.Kind.toLowerCase()}" w:styleId="${escape(s.Id)}"${s.IsDefault ? ' w:default="1"' : ""}><w:name w:val="${escape(s.Name)}"/>${s.BasedOn ? `<w:basedOn w:val="${escape(s.BasedOn)}"/>` : ""}${s.Next ? `<w:next w:val="${escape(s.Next)}"/>` : ""}${paragraph ? `<w:pPr>${paragraph}</w:pPr>` : ""}${runs}</w:style>`;
    })
    .join("");
}
/** Import a supported style subset; unsupported semantics are explicitly diagnosed. */
export function readDocumentStyles(
  root: MarkupNode,
  readRun: (node?: MarkupNode) => Record<string, any>,
): { Styles: DocumentStyle[]; Warnings: string[] } {
  const warnings: string[] = [],
    source = new Map<string, MarkupNode>(),
    result = new Map<string, DocumentStyle>();
  const warn = (id: string, message: string) => {
    if (warnings.length < 100) warnings.push(`${id}: ${message}`);
  };
  for (const s of descendants(root, "w:style")) {
    const id = s.attrs["w:styleId"] ?? "";
    if (!["paragraph", "character"].includes(s.attrs["w:type"] ?? "")) {
      warn(id, "Unsupported table/numbering style.");
      continue;
    }
    if (
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(id) ||
      source.has(id) ||
      source.size >= 256
    ) {
      warn(id, "Invalid, duplicate or over-budget style identity.");
      continue;
    }
    source.set(id, s);
  }
  const read = (id: string, path: Set<string>): DocumentStyle | undefined => {
    if (result.has(id)) return result.get(id);
    const node = source.get(id);
    if (!node) return undefined;
    if (path.has(id) || path.size >= 64) {
      warn(id, "Cyclic or over-budget base style ignored.");
      return undefined;
    }
    const seen = new Set(path);
    seen.add(id);
    const kind =
      node.attrs["w:type"] === "character" ? "Character" : "Paragraph";
    const parentId = val(child(node, "w:basedOn"));
    const parent =
      parentId && source.get(parentId)?.attrs["w:type"] === node.attrs["w:type"]
        ? read(parentId, seen)
        : undefined;
    const base = parent
      ? resolveDocumentStyle([...result.values()], parent.Id)
      : {};
    const r = child(node, "w:rPr"),
      p = child(node, "w:pPr");
    const props = readRun(r);
    delete props.CharacterStyleId;
    for (const key of Object.keys(props))
      if (props[key] === undefined) delete props[key];
    if (
      props.TextDecorations &&
      !["None", "Underline"].includes(props.TextDecorations)
    ) {
      delete props.TextDecorations;
      warn(
        id,
        "Unsupported decoration omitted; other supported setters retained.",
      );
    }
    for (const [key, tag, on] of [
      ["FontWeight", "b", "Bold"],
      ["FontStyle", "i", "Italic"],
    ]) {
      delete props[key];
      if (bool(child(r, `w:${tag}`)))
        props[key] = base[key] === on ? "Normal" : on;
    }
    if (kind === "Paragraph") {
      const alignment = val(child(p, "w:jc"));
      if (alignment && ["left", "right", "center", "both"].includes(alignment))
        props.TextAlignment =
          alignment === "both"
            ? "Justify"
            : alignment[0]!.toUpperCase() + alignment.slice(1);
      if (child(p, "w:bidi"))
        props.FlowDirection = bool(child(p, "w:bidi"))
          ? "RightToLeft"
          : "LeftToRight";
      for (const [key, tag] of [
        ["KeepTogether", "keepLines"],
        ["KeepWithNext", "keepNext"],
        ["BreakPageBefore", "pageBreakBefore"],
      ])
        if (child(p, `w:${tag}`)) props[key] = bool(child(p, `w:${tag}`));
      const outline = val(child(p, "w:outlineLvl"));
      if (outline !== undefined && /^(?:[0-5]|9)$/.test(outline))
        props.HeadingLevel = outline === "9" ? 0 : Number(outline) + 1;
      const spacing = child(p, "w:spacing"),
        indent = child(p, "w:ind"),
        margin: Record<string, number> = {};
      for (const [key, el, attr] of [
        ["Top", spacing, "before"],
        ["Bottom", spacing, "after"],
        ["Left", indent, "left"],
        ["Right", indent, "right"],
      ] as const) {
        const n = el?.attrs["w:" + attr];
        if (n !== undefined) margin[key] = Number(n) / 15;
      }
      if (Object.keys(margin).length) props.Margin = margin;
      if (spacing?.attrs["w:line"]) {
        if (spacing.attrs["w:lineRule"] === "exact")
          props.LineHeight = Number(spacing.attrs["w:line"]) / 15;
        else
          warn(
            id,
            "Relative or minimum line spacing is not a named-style setter.",
          );
      }
      if (indent?.attrs["w:hanging"] !== undefined)
        props.TextIndent = -Number(indent.attrs["w:hanging"]) / 15;
      else if (indent?.attrs["w:firstLine"] !== undefined)
        props.TextIndent = Number(indent.attrs["w:firstLine"]) / 15;
    }
    const supportedRun = [
      "w:b",
      "w:i",
      "w:u",
      "w:sz",
      "w:rFonts",
      "w:color",
      "w:shd",
      "w:highlight",
      "w:vertAlign",
      "w:lang",
    ];
    const supportedParagraph = [
      "w:jc",
      "w:bidi",
      "w:keepLines",
      "w:keepNext",
      "w:pageBreakBefore",
      "w:outlineLvl",
      "w:spacing",
      "w:ind",
    ];
    if (
      r?.children.some(
        (c) => c.name !== "#text" && !supportedRun.includes(c.name),
      ) ||
      p?.children.some(
        (c) => c.name !== "#text" && !supportedParagraph.includes(c.name),
      )
    )
      warn(id, "Unsupported style properties were not interpreted.");
    const style: DocumentStyle = {
      Id: id,
      Name: (val(child(node, "w:name")) || id).slice(0, 256),
      Kind: kind,
      Properties: props,
    };
    if (parent) style.BasedOn = parent.Id;
    else if (parentId)
      warn(id, "Missing, cyclic or incompatible parent ignored.");
    // Add Next after all styles have been parsed, avoiding forward-reference validation.
    try {
      validateDocumentStyles([...result.values(), style]);
      result.set(id, style);
      return style;
    } catch {
      warn(
        id,
        "Invalid supported style values; retained body uses fallback formatting.",
      );
      return undefined;
    }
  };
  for (const id of source.keys()) read(id, new Set());
  let hasDefault = false;
  for (const [id, style] of result) {
    const n = source.get(id)!;
    if (style.Kind === "Paragraph") {
      const next = val(child(n, "w:next"));
      if (next && result.get(next)?.Kind === "Paragraph") style.Next = next;
      else if (next)
        warn(id, "Unknown or incompatible next paragraph style ignored.");
      if (
        !hasDefault &&
        ["1", "true", "on"].includes(n.attrs["w:default"] ?? "")
      ) {
        style.IsDefault = true;
        hasDefault = true;
      }
    }
    if (child(n, "w:link"))
      warn(id, "Linked paragraph/character style metadata is not interpreted.");
  }
  return {
    Styles: validateDocumentStyles([...result.values()]),
    Warnings: warnings,
  };
}
