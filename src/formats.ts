import { materializeDocumentStyles } from "./document-styles.js";
import {
  renderEquation,
  equationOptions,
  sanitizeMathML,
  serializeMathNode,
} from "./equations.js";
import {
  FlowDocument,
  FigureLength,
  FigureUnitType,
  FigureHorizontalAnchor,
  FigureVerticalAnchor,
  WrapDirection,
  type DocumentNode,
} from "./model.js";
import { normalizeFloatingLayout } from "./floating-layout.js";
import { Marked } from "marked";
import {
  parseMarkup,
  escapeMarkup,
  safeURL,
  type MarkupNode,
  textContent,
} from "./formats-markup.js";
export { toDOCX, fromDOCX } from "./formats-docx.js";
export { toPDF, PDFEditor } from "./formats-pdf.js";
export type {
  PDFExportOptions,
  PDFPageInfo,
  PDFTextOptions,
  PDFRectangleOptions,
  PDFImageOptions,
} from "./formats-pdf.js";
import { toDOCX, fromDOCX } from "./formats-docx.js";
import { toPDF } from "./formats-pdf.js";

let nextId = 0;
export function makeNode(
  type: string,
  children: DocumentNode[] = [],
  props: Record<string, any> = {},
  text?: string,
): DocumentNode {
  return {
    type,
    id: "import-" + (++nextId).toString(36),
    props,
    ...(text !== undefined ? { text } : {}),
    ...(children.length ? { children } : {}),
  };
}
const run = (text: string, props: Record<string, any> = {}) =>
  makeNode("Run", [], props, text);
const paragraph = (
  inlines: DocumentNode[] = [],
  props: Record<string, any> = {},
) => makeNode("Paragraph", inlines, props);
const docFromNodes = (
  blocks: DocumentNode[],
  props: Record<string, any> = {},
) =>
  FlowDocument.FromJSON(
    makeNode("FlowDocument", blocks.length ? blocks : [paragraph()], props),
  );
export function toText(doc: FlowDocument): string {
  return doc.Text;
}
export function fromText(text: string): FlowDocument {
  return docFromNodes(
    text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => paragraph([run(line)])),
  );
}

const isColor = (value: unknown) =>
  /^(?:#[a-f0-9]{3,8}|rgba?\([\d.% ,/]+\)|hsla?\([\d.% ,/]+\)|[a-z]+)$/i.test(
    String(value),
  );
function cssLength(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value + "px";
  if (/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/.test(String(value)))
    return /[a-z%]$/i.test(String(value)) ? String(value) : value + "px";
  return undefined;
}
function thickness(value: any): string | undefined {
  if (typeof value === "object" && value)
    return [
      value.Top ?? 0,
      value.Right ?? 0,
      value.Bottom ?? 0,
      value.Left ?? 0,
    ]
      .map(cssLength)
      .join(" ");
  if (typeof value === "string" && value.includes(",")) {
    const v = value
      .split(",")
      .map((v) => cssLength(v.trim()))
      .filter(Boolean);
    return (
      v.length === 4
        ? [v[1], v[2], v[3], v[0]]
        : v.length === 2
          ? [v[1], v[0]]
          : v
    ).join(" ");
  }
  return cssLength(value);
}
function styles(props: Record<string, any>): string {
  const result: string[] = [];
  const add = (name: string, value?: string) => {
    if (value) result.push(name + ":" + value);
  };
  if (props.FontFamily && /^[\w ,"'-]+$/.test(props.FontFamily))
    add("font-family", props.FontFamily);
  add("font-size", cssLength(props.FontSize));
  if (/^(?:normal|bold|[1-9]00)$/i.test(String(props.FontWeight)))
    add("font-weight", String(props.FontWeight).toLowerCase());
  if (/^(?:normal|italic|oblique)$/i.test(String(props.FontStyle)))
    add("font-style", String(props.FontStyle).toLowerCase());
  const decorations = String(props.TextDecorations ?? "")
    .toLowerCase()
    .replace(/strikethrough/g, "line-through");
  if (/^(?:(?:none|underline|line-through|overline)\s*)+$/.test(decorations))
    add("text-decoration", decorations);
  if (isColor(props.Foreground)) add("color", props.Foreground);
  if (isColor(props.Background)) add("background-color", props.Background);
  if (
    /^(?:left|center|right|justify|start|end)$/i.test(
      String(props.TextAlignment),
    )
  )
    add("text-align", String(props.TextAlignment).toLowerCase());
  add("margin", thickness(props.Margin));
  add("padding", thickness(props.Padding));
  add(
    "line-height",
    typeof props.LineHeight === "number" &&
      props.LineHeight > 0 &&
      props.LineHeight <= 4
      ? String(props.LineHeight)
      : cssLength(props.LineHeight),
  );
  add("width", cssLength(props.Width));
  add("height", cssLength(props.Height));
  if (props.FlowDirection)
    add(
      "direction",
      /righttoleft|rtl/i.test(String(props.FlowDirection)) ? "rtl" : "ltr",
    );
  if (
    /^(?:pre|pre-wrap|pre-line|normal|break-spaces)$/.test(
      String(props.WhiteSpace),
    )
  )
    add("white-space", props.WhiteSpace);
  if (/^(?:Superscript|Subscript)$/i.test(String(props.BaselineAlignment)))
    add(
      "vertical-align",
      /superscript/i.test(String(props.BaselineAlignment)) ? "super" : "sub",
    );
  if (props.BreakPageBefore) add("break-before", "page");
  else if (props.BreakColumnBefore) add("break-before", "column");
  return result.join(";");
}
const floatingBlockDisplays: Record<string, string> = {
  p: "block",
  section: "block",
  div: "block",
  h1: "block",
  h2: "block",
  h3: "block",
  h4: "block",
  h5: "block",
  h6: "block",
  table: "table",
  tbody: "table-row-group",
  tr: "table-row",
  td: "table-cell",
  ol: "block",
  ul: "block",
  li: "list-item",
};
const floatingPropertyNames = new Set([
  "Width",
  "Height",
  "WrapStyle",
  "HorizontalAlignment",
  "HorizontalOffset",
  "VerticalOffset",
  "Rotation",
  "WrapDistance",
  "Shape",
  "HorizontalAnchor",
  "VerticalAnchor",
  "WrapDirection",
  "CanDelayPlacement",
]);
function floatingProperties(props: unknown): Record<string, any> {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => floatingPropertyNames.has(key)),
  );
}
function safeFloatingProperties(
  props: unknown,
  kind: "Figure" | "Floater" | "Image",
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(floatingProperties(props))) {
    try {
      if (
        (key === "Width" || key === "Height") &&
        value &&
        typeof value === "object"
      ) {
        if (
          kind !== "Figure" ||
          Array.isArray(value) ||
          typeof value.Value !== "number" ||
          !Object.values(FigureUnitType).includes(value.FigureUnitType)
        )
          continue;
        result[key] = new FigureLength(
          value.Value,
          value.FigureUnitType,
        ).toJSON();
      } else if (
        key === "HorizontalAnchor" ||
        key === "VerticalAnchor" ||
        key === "WrapDirection"
      ) {
        if (kind !== "Figure") continue;
        const allowed =
          key === "HorizontalAnchor"
            ? FigureHorizontalAnchor
            : key === "VerticalAnchor"
              ? FigureVerticalAnchor
              : WrapDirection;
        if (
          typeof value === "string" &&
          Object.values(allowed).includes(value as any)
        )
          result[key] = value;
      } else if (key === "CanDelayPlacement") {
        if (kind === "Figure" && typeof value === "boolean")
          result[key] = value;
      } else {
        if (kind === "Floater" && key === "Height") continue;
        if ((key === "Width" || key === "Height") && value === 0) {
          result[key] = 0;
          continue;
        }
        Object.assign(result, normalizeFloatingLayout({ [key]: value }));
      }
    } catch {
      /* Invalid external layout values are omitted; safe story content remains. */
    }
  }
  return result;
}
function readFloatingProperties(
  raw: string | undefined,
  kind: "Figure" | "Floater" | "Image",
): Record<string, any> {
  if (!raw || raw.length > 4096) return {};
  try {
    return safeFloatingProperties(JSON.parse(raw), kind);
  } catch {
    return {};
  }
}
function floatingStyleProperties(
  props: Record<string, any>,
  kind: "Figure" | "Floater" | "Image",
): Record<string, any> {
  const result = { ...props };
  delete result.Width;
  delete result.Height;
  for (const key of ["Width", "Height"]) {
    const value = props[key];
    if (typeof value === "number")
      Object.assign(result, safeFloatingProperties({ [key]: value }, kind));
    else if (
      kind === "Figure" &&
      typeof value === "string" &&
      /^\d+(?:\.\d+)?%$/.test(value)
    ) {
      const fraction = parseFloat(value) / 100;
      if (fraction <= 1)
        result[key] = new FigureLength(fraction, "Content").toJSON();
    }
  }
  return result;
}
function floatingStyles(props: Record<string, any>): string {
  const wrap = props.WrapStyle ?? "Square",
    align =
      props.HorizontalAlignment ??
      (/Left/.test(props.HorizontalAnchor) ? "Left" : "Right");
  const result = [
    "display:inline-block",
    "position:relative",
    "max-width:100%",
  ];
  if (wrap === "Square" || wrap === "Tight")
    result.push(`float:${align === "Left" ? "left" : "right"}`);
  if (wrap === "TopAndBottom") result.push("display:block", "clear:both");
  if (wrap === "BehindText" || wrap === "InFrontOfText")
    result.push(
      "position:absolute",
      `z-index:${wrap === "BehindText" ? 0 : 1}`,
    );
  for (const name of ["Width", "Height"] as const) {
    const value = props[name],
      number =
        typeof value === "number"
          ? value
          : value?.FigureUnitType === "Pixel"
            ? value.Value
            : undefined;
    if (Number.isFinite(number) && number >= 0)
      result.push(`${name.toLowerCase()}:${Math.min(20000, number)}px`);
    else if (
      ["Page", "Content"].includes(value?.FigureUnitType) &&
      Number.isFinite(value.Value)
    )
      result.push(
        `${name.toLowerCase()}:${Math.min(100, Math.max(0, value.Value * 100))}%`,
      );
  }
  for (const [name, css] of [
    ["HorizontalOffset", "left"],
    ["VerticalOffset", "top"],
    ["WrapDistance", "margin"],
  ])
    if (Number.isFinite(props[name]))
      result.push(`${css}:${Math.max(-20000, Math.min(20000, props[name]))}px`);
  if (wrap === "Tight" && props.Shape === "Ellipse")
    result.push("shape-outside:ellipse(50% 50%)");
  if (Number.isFinite(props.Rotation))
    result.push(
      `transform:rotate(${Math.max(-360, Math.min(360, props.Rotation))}deg)`,
    );
  return result.join(";");
}
function htmlNode(node: DocumentNode, phrasingBlocks = false): string {
  const p = node.props ?? {},
    css = styles(p),
    attr = css ? ` style="${escapeMarkup(css)}"` : "";
  const floating = node.type === "Figure" || node.type === "Floater";
  const body = (node.children ?? [])
    .map((child) => htmlNode(child, phrasingBlocks || floating))
    .join("");
  const wrap = (tag: string, extra = "") =>
    phrasingBlocks && floatingBlockDisplays[tag]
      ? `<span data-rt-block="${tag}" style="display:${floatingBlockDisplays[tag]}${css ? ";" + escapeMarkup(css) : ""}"${extra}>${body}</span>`
      : `<${tag}${attr}${extra}>${body}</${tag}>`;
  switch (node.type) {
    case "FlowDocument":
      return `<article data-richtextweb="document"${attr}>${body}</article>`;
    case "Section":
      return wrap("section");
    case "Paragraph":
      return wrap(
        Number(p.HeadingLevel) >= 1 && Number(p.HeadingLevel) <= 6
          ? "h" + Number(p.HeadingLevel)
          : "p",
      );
    case "Run": {
      const text = node.text ?? "",
        preserve = /[\t\r\n]| {2,}|^ | $/.test(text),
        runCss =
          css + (preserve ? (css ? ";" : "") + "white-space:pre-wrap" : "");
      return runCss
        ? `<span style="${escapeMarkup(runCss)}">${escapeMarkup(text)}</span>`
        : escapeMarkup(text);
    }
    case "Bold":
      return wrap("strong");
    case "Italic":
      return wrap("em");
    case "Underline":
      return wrap("u");
    case "Span":
      return wrap("span");
    case "Hyperlink": {
      const href = safeURL(p.NavigateUri);
      return href
        ? wrap("a", ` href="${escapeMarkup(href)}" rel="noopener noreferrer"`)
        : wrap("span");
    }
    case "LineBreak":
      return "<br>";
    case "List": {
      const ordered = /decimal|latin|roman|number/i.test(String(p.MarkerStyle));
      return wrap(
        ordered ? "ol" : "ul",
        ordered && Number.isFinite(Number(p.StartIndex))
          ? ` start="${Math.max(1, Number(p.StartIndex))}"`
          : "",
      );
    }
    case "ListItem":
      return wrap("li");
    case "Table":
      return wrap("table");
    case "TableRowGroup":
      return wrap("tbody");
    case "TableRow":
      return wrap("tr");
    case "TableCell":
      return wrap(
        "td",
        ` colspan="${Math.max(1, Math.min(1000, Number(p.ColumnSpan) || 1))}" rowspan="${Math.max(1, Math.min(1000, Number(p.RowSpan) || 1))}"`,
      );
    case "Equation": {
      const options = equationOptions(node),
        rendered = renderEquation(options);
      return `<span data-rt-equation="${options.Format}" data-rt-source="${escapeMarkup(options.Source)}" data-rt-display="${!!options.DisplayMode}" role="math" aria-label="${escapeMarkup(options.AlternativeText || rendered.Text)}" style="${escapeMarkup(css)};display:${options.DisplayMode ? "block;text-align:center;margin:.6em 0" : "inline-block"};line-height:normal;direction:ltr">${rendered.SVG}</span>`;
    }
    case "Image": {
      const src = safeURL(p.Source, true);
      const layout = safeFloatingProperties(p, "Image");
      const floatingImage = Object.keys(layout).some(
        (key) => key !== "Width" && key !== "Height",
      );
      const imageCss = [css, floatingImage ? floatingStyles(layout) : ""]
        .filter(Boolean)
        .join(";");
      return src
        ? `<img${imageCss ? ` style="${escapeMarkup(imageCss)}"` : ""}${Object.keys(layout).length ? ` data-rt-layout="${escapeMarkup(JSON.stringify(layout))}"` : ""} src="${escapeMarkup(src)}" alt="${escapeMarkup(p.AlternativeText ?? "")}">`
        : escapeMarkup(p.AlternativeText ?? "");
    }
    case "Figure":
    case "Floater":
      return `<span data-rt-floating="${node.type}" data-rt-layout="${escapeMarkup(JSON.stringify(safeFloatingProperties(p, node.type as "Figure" | "Floater")))}" style="${escapeMarkup(css + ";" + floatingStyles(p))}">${body}</span>`;
    case "InlineUIContainer":
      return wrap("span");
    case "BlockUIContainer":
      return wrap("div");
    default:
      return body || escapeMarkup(node.text ?? "");
  }
}
/** Safe inert HTML. Scriptable URLs, event handlers and arbitrary CSS never enter the result. */
export function toHTML(doc: FlowDocument): string {
  return htmlNode(materializeDocumentStyles(doc.ToJSON()));
}
function parsedLength(value: string): number | string {
  return /^-?[\d.]+(?:px|pt)?$/.test(value)
    ? parseFloat(value) * (value.endsWith("pt") ? 96 / 72 : 1)
    : value;
}
function parseStyle(source: string): Record<string, any> {
  const props: Record<string, any> = {};
  const map: Record<string, string> = {
    "font-family": "FontFamily",
    "font-size": "FontSize",
    "font-weight": "FontWeight",
    "font-style": "FontStyle",
    "text-decoration": "TextDecorations",
    "text-decoration-line": "TextDecorations",
    color: "Foreground",
    "background-color": "Background",
    "text-align": "TextAlignment",
    margin: "Margin",
    padding: "Padding",
    "line-height": "LineHeight",
    width: "Width",
    height: "Height",
  };
  for (const declaration of source.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase(),
      value = declaration
        .slice(colon + 1)
        .trim()
        .replace(/\s*!important$/i, "");
    if (key === "break-before" || key === "page-break-before") {
      if (value === "page" || value === "always") props.BreakPageBefore = true;
      else if (value === "column") props.BreakColumnBefore = true;
      continue;
    }
    if (key === "direction" && /^(?:rtl|ltr)$/.test(value)) {
      props.FlowDirection = value === "rtl" ? "RightToLeft" : "LeftToRight";
      continue;
    }
    if (
      key === "white-space" &&
      /^(?:pre|pre-wrap|pre-line|normal|break-spaces)$/.test(value)
    ) {
      props.WhiteSpace = value;
      continue;
    }
    if (key === "vertical-align" && /^(?:super|sub)$/.test(value)) {
      props.BaselineAlignment = value === "super" ? "Superscript" : "Subscript";
      continue;
    }
    const prop = map[key];
    if (!prop || /url\s*\(|expression\s*\(|[<>\\]/i.test(value)) continue;
    if (["FontSize", "Width", "Height", "LineHeight"].includes(prop)) {
      if (/^-?[\d.]+(?:px|pt|em|rem|%)?$/.test(value)) {
        const parsed = parsedLength(value);
        if (prop === "FontSize") {
          const size =
            typeof parsed === "number"
              ? parsed
              : parseFloat(parsed) * (parsed.endsWith("%") ? 0.16 : 16);
          if (Number.isFinite(size) && size > 0) props[prop] = size;
        } else props[prop] = parsed;
      }
    } else if (prop === "Margin" || prop === "Padding") {
      const parts = value.split(/\s+/);
      if (
        parts.length <= 4 &&
        parts.every((v) => /^-?[\d.]+(?:px|pt)?$/.test(v))
      ) {
        const v = parts.map((v) => Number(parsedLength(v)));
        props[prop] = {
          Top: v[0],
          Right: v[1] ?? v[0],
          Bottom: v[2] ?? v[0],
          Left: v[3] ?? v[1] ?? v[0],
        };
      }
    } else props[prop] = value;
  }
  return props;
}
const suppressedHTML = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "svg",
  "head",
  "meta",
  "link",
  "base",
  "input",
  "button",
  "textarea",
  "select",
]);
const htmlBlocks = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "hr",
]);
function htmlInlines(
  nodes: MarkupNode[],
  preserveSpace = false,
): DocumentNode[] {
  const result: DocumentNode[] = [];
  for (const node of nodes) {
    const name = node.name,
      p = parseStyle(node.attrs.style ?? "");
    if (name === "#text") {
      const text = preserveSpace
        ? node.text!
        : node.text!.replace(/[\t\r\n ]+/g, " ");
      if (text) result.push(run(text));
      continue;
    }
    if (suppressedHTML.has(name)) continue;
    if (node.attrs["data-rt-equation"] || name === "math") {
      const format =
        node.attrs["data-rt-equation"] === "latex" ? "latex" : "mathml";
      const source =
        name === "math"
          ? sanitizeMathML(serializeMathNode(node))
          : (node.attrs["data-rt-source"] ?? "");
      renderEquation({
        Source: source,
        Format: format,
        DisplayMode: node.attrs["data-rt-display"] === "true",
      });
      result.push(
        makeNode("Equation", [], {
          ...p,
          EquationSource: source,
          EquationFormat: format,
          DisplayMode: node.attrs["data-rt-display"] === "true",
          AlternativeText: node.attrs["aria-label"] ?? "",
        }),
      );
      continue;
    }
    if (
      node.attrs["data-rt-floating"] === "Figure" ||
      node.attrs["data-rt-floating"] === "Floater"
    ) {
      const kind = node.attrs["data-rt-floating"];
      const restored = (item: MarkupNode): MarkupNode => ({
        ...item,
        name:
          item.name === "span" &&
          Object.prototype.hasOwnProperty.call(
            floatingBlockDisplays,
            item.attrs["data-rt-block"],
          )
            ? item.attrs["data-rt-block"]
            : item.name,
        children: item.children.map(restored),
      });
      const layout = readFloatingProperties(node.attrs["data-rt-layout"], kind);
      const blocks = htmlBlockNodes(node.children.map(restored), preserveSpace);
      result.push(
        makeNode(kind, blocks.length ? blocks : [paragraph([])], {
          ...floatingStyleProperties(p, kind),
          ...layout,
        }),
      );
      continue;
    }
    if (name === "br") {
      result.push(makeNode("LineBreak"));
      continue;
    }
    if (name === "img") {
      const source = safeURL(node.attrs.src, true);
      if (source)
        result.push(
          makeNode("Image", [], {
            ...p,
            ...readFloatingProperties(node.attrs["data-rt-layout"], "Image"),
            Source: source,
            AlternativeText: node.attrs.alt ?? "",
            ...(node.attrs.width
              ? { Width: Number(node.attrs.width) || undefined }
              : {}),
            ...(node.attrs.height
              ? { Height: Number(node.attrs.height) || undefined }
              : {}),
          }),
        );
      else if (node.attrs.alt) result.push(run(node.attrs.alt));
      continue;
    }
    const children = htmlInlines(
      node.children,
      name === "code" ||
        name === "pre" ||
        (p.WhiteSpace
          ? ["pre", "pre-wrap", "break-spaces"].includes(p.WhiteSpace)
          : preserveSpace),
    );
    const types: Record<string, string> = {
      b: "Bold",
      strong: "Bold",
      i: "Italic",
      em: "Italic",
      u: "Underline",
      a: "Hyperlink",
    };
    if (name === "s" || name === "del" || name === "strike")
      p.TextDecorations = "line-through";
    if (name === "code") p.FontFamily = "monospace";
    if (name === "sup" || name === "sub")
      p.BaselineAlignment = name === "sup" ? "Superscript" : "Subscript";
    if (name === "a") {
      const uri = safeURL(node.attrs.href);
      if (uri) p.NavigateUri = uri;
    }
    if (name === "font") {
      if (isColor(node.attrs.color)) p.Foreground = node.attrs.color;
      if (node.attrs.face) p.FontFamily = node.attrs.face;
    }
    if (children.length)
      result.push(makeNode(types[name] ?? "Span", children, p));
  }
  return result;
}
function htmlBlockNodes(
  nodes: MarkupNode[],
  preserveSpace = false,
): DocumentNode[] {
  const result: DocumentNode[] = [];
  let pending: MarkupNode[] = [];
  const flush = () => {
    if (!pending.length) return;
    const inlines = htmlInlines(pending, preserveSpace);
    if (inlines.some((n) => n.type !== "Run" || n.text?.trim()))
      result.push(paragraph(inlines));
    pending = [];
  };
  for (const node of nodes) {
    if (suppressedHTML.has(node.name)) continue;
    if (!htmlBlocks.has(node.name)) {
      if (node.name === "html" || node.name === "body") {
        flush();
        result.push(...htmlBlockNodes(node.children, preserveSpace));
      } else pending.push(node);
      continue;
    }
    flush();
    const p = parseStyle(node.attrs.style ?? ""),
      name = node.name,
      nodePreserveSpace = p.WhiteSpace
        ? ["pre", "pre-wrap", "break-spaces"].includes(p.WhiteSpace)
        : preserveSpace;
    if (/^h[1-6]$/.test(name)) p.HeadingLevel = Number(name[1]);
    if (name === "blockquote") {
      p.Margin = { Left: 24, Top: 8, Right: 0, Bottom: 8 };
      result.push(
        makeNode(
          "Section",
          htmlBlockNodes(node.children, nodePreserveSpace),
          p,
        ),
      );
    } else if (name === "ul" || name === "ol")
      result.push(
        makeNode(
          "List",
          node.children
            .filter((n) => n.name === "li")
            .map((n) =>
              makeNode(
                "ListItem",
                htmlBlockNodes(n.children, nodePreserveSpace),
              ),
            ),
          {
            ...p,
            MarkerStyle: name === "ol" ? "Decimal" : "Disc",
            StartIndex: Math.max(1, parseInt(node.attrs.start ?? "1", 10) || 1),
          },
        ),
      );
    else if (name === "table") {
      const rows: DocumentNode[] = [];
      const gather = (n: MarkupNode) => {
        if (n.name === "tr")
          rows.push(
            makeNode(
              "TableRow",
              n.children
                .filter((c) => c.name === "td" || c.name === "th")
                .map((c) =>
                  makeNode(
                    "TableCell",
                    htmlBlockNodes(c.children, nodePreserveSpace),
                    {
                      ...parseStyle(c.attrs.style ?? ""),
                      ColumnSpan: Math.max(
                        1,
                        Math.min(
                          1000,
                          parseInt(c.attrs.colspan ?? "1", 10) || 1,
                        ),
                      ),
                      RowSpan: Math.max(
                        1,
                        Math.min(
                          1000,
                          parseInt(c.attrs.rowspan ?? "1", 10) || 1,
                        ),
                      ),
                      ...(c.name === "th" ? { FontWeight: "Bold" } : {}),
                    },
                  ),
                ),
            ),
          );
        else for (const c of n.children) gather(c);
      };
      gather(node);
      result.push(makeNode("Table", [makeNode("TableRowGroup", rows)], p));
    } else if (name === "hr") result.push(paragraph([run("—")], p));
    else if (
      name === "div" ||
      name === "section" ||
      name === "article" ||
      name === "main" ||
      name === "header" ||
      name === "footer"
    ) {
      if (node.children.some((c) => htmlBlocks.has(c.name))) {
        const blocks = htmlBlockNodes(node.children, nodePreserveSpace);
        if (Object.keys(p).length) result.push(makeNode("Section", blocks, p));
        else result.push(...blocks);
      } else
        result.push(
          paragraph(htmlInlines(node.children, nodePreserveSpace), p),
        );
    } else {
      if (name === "pre") p.FontFamily = "monospace";
      result.push(
        paragraph(
          htmlInlines(node.children, name === "pre" || nodePreserveSpace),
          p,
        ),
      );
    }
  }
  flush();
  return result;
}
export function fromHTML(html: string): FlowDocument {
  return docFromNodes(htmlBlockNodes(parseMarkup(html).children));
}
/** Canonical HTML sanitization through the document model; unsupported markup is removed. */
export function sanitizeHTML(html: string): string {
  return toHTML(fromHTML(html));
}

function markdownInline(node: DocumentNode): string {
  const inner = (node.children ?? []).map(markdownInline).join("");
  const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, "\\$1");
  switch (node.type) {
    case "Run": {
      let text = escape(node.text ?? "");
      const p = node.props ?? {};
      if (/bold|[6-9]00/i.test(String(p.FontWeight))) text = "**" + text + "**";
      if (/italic/i.test(String(p.FontStyle))) text = "*" + text + "*";
      if (/line-through|strikethrough/i.test(String(p.TextDecorations)))
        text = "~~" + text + "~~";
      return text;
    }
    case "Bold":
      return "**" + inner + "**";
    case "Italic":
      return "*" + inner + "*";
    case "Underline":
      return "<u>" + inner + "</u>";
    case "Hyperlink": {
      const uri = safeURL(node.props.NavigateUri);
      return uri
        ? `[${inner}](${uri.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`
        : inner;
    }
    case "Equation": {
      const options = equationOptions(node);
      if (options.Format !== "mathml" && !options.Source.includes("\n"))
        return `$${options.Source}$`;
      return `<span data-rt-equation="${options.Format}" data-rt-source="${escapeMarkup(options.Source)}" data-rt-display="${!!options.DisplayMode}">[equation]</span>`;
    }
    case "Image": {
      const uri = safeURL(node.props.Source, true);
      return uri
        ? `![${escape(String(node.props.AlternativeText ?? ""))}](${uri.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`
        : "";
    }
    case "Figure":
    case "Floater":
      return "\n\n" + markdownBlocks(node.children ?? []) + "\n\n";
    case "LineBreak":
      return "  \n";
    default:
      return inner;
  }
}
function markdownBlocks(nodes: DocumentNode[], depth = 0): string {
  return nodes
    .map((node) => {
      if (
        node.type === "Paragraph" &&
        node.children?.length === 1 &&
        node.children[0].type === "Equation" &&
        node.children[0].props.DisplayMode &&
        node.children[0].props.EquationFormat !== "mathml"
      )
        return `$$\n${node.children[0].props.EquationSource}\n$$`;
      if (node.type === "Paragraph")
        return (
          (node.props.HeadingLevel
            ? "#".repeat(
                Math.max(1, Math.min(6, Number(node.props.HeadingLevel))),
              ) + " "
            : "") + (node.children ?? []).map(markdownInline).join("")
        );
      if (node.type === "List")
        return (node.children ?? [])
          .map((item, i) => {
            const prefix = /decimal|latin|roman/i.test(
              String(node.props.MarkerStyle),
            )
              ? String((Number(node.props.StartIndex) || 1) + i) + ". "
              : "- ";
            return (
              prefix +
              markdownBlocks(item.children ?? [], depth + 1).replace(
                /\n/g,
                "\n" + " ".repeat(prefix.length),
              )
            );
          })
          .join("\n");
      if (node.type === "Table") {
        const rows: DocumentNode[] = [];
        const gather = (n: DocumentNode) => {
          if (n.type === "TableRow") rows.push(n);
          else for (const c of n.children ?? []) gather(c);
        };
        gather(node);
        if (!rows.length) return "";
        const lines = rows.map(
          (row) =>
            "| " +
            (row.children ?? [])
              .map((cell) =>
                markdownBlocks(cell.children ?? [])
                  .replace(/\|/g, "\\|")
                  .replace(/\n+/g, "<br>"),
              )
              .join(" | ") +
            " |",
        );
        lines.splice(
          1,
          0,
          "| " + (rows[0]!.children ?? []).map(() => "---").join(" | ") + " |",
        );
        return lines.join("\n");
      }
      return node.children
        ? markdownBlocks(node.children, depth)
        : markdownInline(node);
    })
    .join("\n\n");
}
export function toMarkdown(doc: FlowDocument): string {
  return markdownBlocks(materializeDocumentStyles(doc.ToJSON()).children ?? []);
}
const markdownParser = new Marked({ gfm: true, async: false });
const equationMarkup = (source: string, display: boolean) =>
  `<span data-rt-equation="latex" data-rt-source="${escapeMarkup(source)}" data-rt-display="${display}">[equation]</span>`;
markdownParser.use({
  extensions: [
    {
      name: "blockEquation",
      level: "block",
      start: (source: string) => source.indexOf("$$"),
      tokenizer(source: string) {
        const match =
          source.match(/^\$\$[ \t]*\n([\s\S]+?)\n\$\$[ \t]*(?:\n|$)/) ??
          source.match(/^\$\$([^\n]+?)\$\$[ \t]*(?:\n|$)/);
        if (match)
          return { type: "blockEquation", raw: match[0], source: match[1] };
      },
      renderer(token: any) {
        return `<p>${equationMarkup(token.source, true)}</p>`;
      },
    },
    {
      name: "inlineEquation",
      level: "inline",
      start: (source: string) => source.indexOf("$"),
      tokenizer(source: string) {
        const match = source.match(
          /^\$(?![\s$])((?:\\.|[^$\n\\])+?)\$(?![\d$])/,
        );
        if (match && !/\s$/.test(match[1]))
          return { type: "inlineEquation", raw: match[0], source: match[1] };
      },
      renderer(token: any) {
        return equationMarkup(token.source, false);
      },
    },
  ],
});
export function fromMarkdown(markdown: string): FlowDocument {
  if (typeof markdown !== "string" || markdown.length > 32 * 1024 * 1024)
    throw new RangeError("Markdown input exceeds the 32 MiB limit.");
  return fromHTML(markdownParser.parse(markdown, { async: false }) as string);
}

const knownTypes = new Set([
  "Equation",
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
  "TableColumn",
  "TableRowGroup",
  "TableRow",
  "TableCell",
  "InlineUIContainer",
  "BlockUIContainer",
  "Image",
  "Figure",
  "Floater",
]);
const knownProperties = new Set([
  "EquationSource",
  "EquationFormat",
  "DisplayMode",
  "BreakColumnBefore",
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "TextDecorations",
  "Foreground",
  "Background",
  "TextAlignment",
  "Margin",
  "Padding",
  "LineHeight",
  "PageWidth",
  "PageHeight",
  "PagePadding",
  "ColumnCount",
  "BreakPageBefore",
  "HeadingLevel",
  "NavigateUri",
  "Source",
  "Width",
  "Height",
  "AlternativeText",
  "MarkerStyle",
  "StartIndex",
  "RowSpan",
  "ColumnSpan",
  "FlowDirection",
  "KeepTogether",
  "KeepWithNext",
  "BaselineAlignment",
  ...floatingPropertyNames,
]);
const numericProperties = new Set([
  "FontSize",
  "LineHeight",
  "PageWidth",
  "PageHeight",
  "ColumnCount",
  "HeadingLevel",
  "Width",
  "Height",
  "StartIndex",
  "RowSpan",
  "ColumnSpan",
  "HorizontalOffset",
  "VerticalOffset",
  "Rotation",
  "WrapDistance",
]);
function xamlNode(node: DocumentNode, root = false): string {
  const props = Object.entries(node.props ?? {})
    .filter(([key, value]) => knownProperties.has(key) && value != null)
    .map(([key, value]) => {
      if (
        node.type === "Figure" &&
        (key === "Width" || key === "Height") &&
        typeof value === "object"
      )
        value = new FigureLength(value.Value, value.FigureUnitType).ToString();
      else if (typeof value === "object")
        value = [
          value.Left ?? 0,
          value.Top ?? 0,
          value.Right ?? 0,
          value.Bottom ?? 0,
        ].join(",");
      return ` ${key}="${escapeMarkup(value)}"`;
    })
    .join("");
  const attrs =
    (root
      ? ' xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xml:space="preserve"'
      : "") + props;
  const columns =
    node.type === "Table" &&
    Array.isArray(node.props.Columns) &&
    node.props.Columns.length
      ? `<Table.Columns>${node.props.Columns.map((column: DocumentNode) => xamlNode(column)).join("")}</Table.Columns>`
      : "";
  return `<${node.type}${attrs}>${columns}${node.type === "Run" ? escapeMarkup(node.text ?? "") : (node.children ?? []).map((n) => xamlNode(n)).join("")}</${node.type}>`;
}
export function toXAML(doc: FlowDocument): string {
  return xamlNode(materializeDocumentStyles(doc.ToJSON()), true);
}
export function fromXAML(xaml: string): FlowDocument {
  const root = parseMarkup(xaml, true);
  const convert = (
    node: MarkupNode,
    parent = "",
    inheritedPreserve = false,
  ): DocumentNode[] => {
    const name = node.name.split(":").pop()!,
      preserve =
        node.attrs["xml:space"] === "preserve" ||
        (node.attrs["xml:space"] !== "default" && inheritedPreserve);
    if (name === "#text")
      return node.text?.trim() ||
        (preserve &&
          /^(?:Paragraph|Span|Bold|Italic|Underline|Hyperlink)$|\.Inlines$/.test(
            parent,
          ))
        ? [run(node.text ?? "")]
        : [];
    if (/\.(?:Blocks|Inlines|ListItems|RowGroups|Rows|Cells)$/.test(name))
      return node.children.flatMap((child) => convert(child, name, preserve));
    if (!knownTypes.has(name)) return [];
    const props: Record<string, any> = {};
    for (const [key, value] of Object.entries(node.attrs)) {
      if (!knownProperties.has(key)) continue;
      if (key !== "EquationSource" && value.startsWith("{"))
        throw new Error("XAML markup extensions are not supported.");
      if (key === "Source" || key === "NavigateUri") {
        const uri = safeURL(value, key === "Source");
        if (uri) props[key] = uri;
      } else if (name === "Figure" && (key === "Width" || key === "Height")) {
        props[key] = FigureLength.Parse(value).toJSON();
      } else if (name === "TableColumn" && key === "Width") {
        if (/^(?:Auto|\*|(?:\d+(?:\.\d+)?|\.\d+)\*)$/i.test(value))
          props[key] = value;
        else if (Number.isFinite(Number(value)) && Number(value) >= 0)
          props[key] = Number(value);
      } else if (numericProperties.has(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) props[key] = n;
      } else if (
        [
          "BreakPageBefore",
          "BreakColumnBefore",
          "DisplayMode",
          "KeepTogether",
          "KeepWithNext",
          "CanDelayPlacement",
        ].includes(key)
      )
        props[key] = value.toLowerCase() === "true";
      else if (["Margin", "Padding", "PagePadding"].includes(key)) {
        const parts = value.split(",").map(Number);
        if (parts.every(Number.isFinite))
          props[key] =
            parts.length === 1
              ? parts[0]
              : {
                  Left: parts[0],
                  Top: parts[1],
                  Right: parts[2] ?? parts[0],
                  Bottom: parts[3] ?? parts[1],
                };
      } else props[key] = value;
    }
    if (name === "Table") {
      const propertyNodes = node.children.filter(
        (child) => child.name.split(":").pop() === "Table.Columns",
      );
      if (propertyNodes.length) {
        props.Columns = propertyNodes.flatMap((property) =>
          property.children.flatMap((child) =>
            convert(child, "Table.Columns", preserve),
          ),
        );
        if (
          props.Columns.some(
            (column: DocumentNode) => column.type !== "TableColumn",
          )
        )
          throw new TypeError("Table.Columns requires TableColumn children.");
      }
    }
    const text =
      name === "Run" ? (node.attrs.Text ?? textContent(node)) : undefined;
    return [
      makeNode(
        name,
        name === "Run"
          ? []
          : node.children.flatMap((child) => convert(child, name, preserve)),
        props,
        text,
      ),
    ];
  };
  const nodes = root.children.flatMap((child) => convert(child));
  const document = nodes.find((n) => n.type === "FlowDocument");
  if (!document) throw new Error("Expected a FlowDocument root element.");
  return FlowDocument.FromJSON(document);
}

const rtfEscape = (value: string) =>
  value.replace(/[\\{}\n\r\t]|[^\x20-\x7e]/g, (char) => {
    if (char === "\n") return "\\line ";
    if (char === "\r") return "";
    if (char === "\t") return "\\tab ";
    if ("\\{}".includes(char)) return "\\" + char;
    const code = char.charCodeAt(0);
    return "\\u" + (code > 32767 ? code - 65536 : code) + "?";
  });
export function toRTF(doc: FlowDocument): string {
  const fonts: string[] = ["Arial"],
    colors: string[] = [];
  const colorValue = (value: unknown): string | undefined => {
    const text = String(value ?? "");
    if (/^#[a-f0-9]{6}$/i.test(text)) return text.slice(1).toUpperCase();
    if (/^#[a-f0-9]{3}$/i.test(text))
      return text
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
        .toUpperCase();
    return (
      {
        black: "000000",
        white: "FFFFFF",
        red: "FF0000",
        green: "008000",
        blue: "0000FF",
        yellow: "FFFF00",
      } as Record<string, string>
    )[text.toLowerCase()];
  };
  const collect = (n: DocumentNode) => {
    if (n.props.FontFamily && !fonts.includes(String(n.props.FontFamily)))
      fonts.push(String(n.props.FontFamily));
    for (const key of ["Foreground", "Background"]) {
      const color = colorValue(n.props[key]);
      if (color && !colors.includes(color)) colors.push(color);
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(doc.ToJSON());
  const emit = (node: DocumentNode): string => {
    const p = node.props ?? {};
    let prefix = "";
    if (node.type === "Bold" || p.FontWeight != null)
      prefix +=
        node.type === "Bold" || /bold|[6-9]00/i.test(String(p.FontWeight))
          ? "\\b "
          : "\\b0 ";
    if (node.type === "Italic" || p.FontStyle != null)
      prefix +=
        node.type === "Italic" || /italic/i.test(String(p.FontStyle))
          ? "\\i "
          : "\\i0 ";
    if (node.type === "Underline" || p.TextDecorations != null)
      prefix +=
        node.type === "Underline" ||
        /underline/i.test(String(p.TextDecorations))
          ? "\\ul "
          : "\\ulnone ";
    if (/line-through|strikethrough/i.test(String(p.TextDecorations)))
      prefix += "\\strike ";
    if (p.BaselineAlignment)
      prefix +=
        p.BaselineAlignment === "Superscript"
          ? "\\super "
          : p.BaselineAlignment === "Subscript"
            ? "\\sub "
            : "\\nosupersub ";
    if (p.FontFamily)
      prefix += "\\f" + fonts.indexOf(String(p.FontFamily)) + " ";
    const color = colorValue(p.Foreground),
      background = colorValue(p.Background);
    if (color) prefix += "\\cf" + (colors.indexOf(color) + 1) + " ";
    if (background)
      prefix += "\\highlight" + (colors.indexOf(background) + 1) + " ";
    if (Number(p.FontSize) > 0)
      prefix += "\\fs" + Math.round(Number(p.FontSize) * 1.5) + " ";
    if (p.TextAlignment)
      prefix +=
        { center: "\\qc ", right: "\\qr ", justify: "\\qj " }[
          String(p.TextAlignment).toLowerCase()
        ] ?? "\\ql ";
    if (node.type === "LineBreak") return "\\line ";
    if (node.type === "Image")
      return rtfEscape(String(p.AlternativeText ?? ""));
    let body =
      node.type === "Run"
        ? rtfEscape(node.text ?? "")
        : (node.children ?? []).map(emit).join("");
    if (node.type === "Paragraph") body += "\\par\n";
    return "{" + prefix + body + "}";
  };
  return (
    "{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl" +
    fonts
      .map(
        (font, i) =>
          "{\\f" + i + " " + rtfEscape(font.replace(/;/g, "")) + ";}",
      )
      .join("") +
    "}{\\colortbl;" +
    colors
      .map(
        (color) =>
          "\\red" +
          parseInt(color.slice(0, 2), 16) +
          "\\green" +
          parseInt(color.slice(2, 4), 16) +
          "\\blue" +
          parseInt(color.slice(4, 6), 16) +
          ";",
      )
      .join("") +
    "}\n" +
    emit(doc.ToJSON()) +
    "}"
  );
}
/** Imports the textual RTF subset (groups, Unicode, inline styling and paragraphs). */
export function fromRTF(rtf: string): FlowDocument {
  if (!/^\s*\{\\rtf\d/.test(rtf)) throw new Error("Invalid RTF header.");
  if (rtf.length > 32 * 1024 * 1024)
    throw new RangeError("RTF exceeds the 32 MiB import limit.");
  const destination = (name: string): string => {
    const start = rtf.indexOf("{\\" + name);
    if (start < 0) return "";
    let depth = 0;
    for (let i = start; i < rtf.length; i++) {
      const c = rtf[i];
      if (c === "\\" && ["{", "}", "\\"].includes(rtf[i + 1] ?? "")) {
        i++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return rtf.slice(start, i + 1);
    }
    return "";
  };
  const fonts = new Map<number, string>();
  for (const match of destination("fonttbl").matchAll(
    /\\f(\d+)(?:\\[a-z]+-?\d*\s*)*\s+([^;{}]+);/gi,
  ))
    fonts.set(Number(match[1]), match[2]!.trim());
  const colors: string[] = [];
  for (const segment of destination("colortbl").split(";").slice(0, -1)) {
    const red = segment.match(/\\red(\d+)/)?.[1],
      green = segment.match(/\\green(\d+)/)?.[1],
      blue = segment.match(/\\blue(\d+)/)?.[1];
    colors.push(
      red != null && green != null && blue != null
        ? "#" +
            [red, green, blue]
              .map((v) =>
                Math.max(0, Math.min(255, Number(v)))
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("")
        : "",
    );
  }
  type State = {
    props: Record<string, any>;
    paragraph: Record<string, any>;
    skip: boolean;
    uc: number;
  };
  let state: State = { props: {}, paragraph: {}, skip: false, uc: 1 };
  const stack: State[] = [],
    blocks: DocumentNode[] = [];
  let inlines: DocumentNode[] = [],
    buffer = "",
    fallback = 0;
  const flush = () => {
    if (buffer && !state.skip) inlines.push(run(buffer, { ...state.props }));
    buffer = "";
  };
  const endParagraph = () => {
    flush();
    blocks.push(paragraph(inlines, { ...state.paragraph }));
    inlines = [];
  };
  const append = (text: string) => {
    if (state.skip) return;
    if (fallback > 0) {
      fallback--;
      return;
    }
    buffer += text;
  };
  const skipDestinations = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "filetbl",
    "listtable",
    "listoverridetable",
    "header",
    "footer",
    "headerl",
    "headerr",
    "footerl",
    "footerr",
    "generator",
    "fldinst",
    "xmlopen",
    "xmlattrname",
    "xmlattrvalue",
    "datastore",
    "themedata",
  ]);
  for (let i = 0; i < rtf.length;) {
    const c = rtf[i++]!;
    if (c === "{") {
      flush();
      if (stack.length > 256)
        throw new RangeError("RTF nesting exceeds 256 levels.");
      stack.push(state);
      state = {
        ...state,
        props: { ...state.props },
        paragraph: { ...state.paragraph },
      };
      continue;
    }
    if (c === "}") {
      flush();
      state = stack.pop() ?? state;
      continue;
    }
    if (c === "\n" || c === "\r") continue;
    if (c !== "\\") {
      append(c);
      continue;
    }
    const next = rtf[i++]!;
    if (next === "\\" || next === "{" || next === "}") {
      append(next);
      continue;
    }
    if (next === "'") {
      const hex = rtf.slice(i, i + 2);
      i += 2;
      if (/^[a-f0-9]{2}$/i.test(hex))
        append(
          new TextDecoder("windows-1252").decode(
            new Uint8Array([parseInt(hex, 16)]),
          ),
        );
      continue;
    }
    if (next === "*") {
      flush();
      state.skip = true;
      continue;
    }
    if (next === "~") {
      append("\u00a0");
      continue;
    }
    if (next === "_") {
      append("‑");
      continue;
    }
    if (next === "-") continue;
    if (!/[a-z]/i.test(next)) continue;
    let word = next;
    while (i < rtf.length && /[a-z]/i.test(rtf[i]!)) word += rtf[i++];
    let numeric = "";
    if (rtf[i] === "-") numeric += rtf[i++];
    while (/\d/.test(rtf[i] ?? "")) numeric += rtf[i++];
    const n = numeric ? Number(numeric) : 1;
    if (rtf[i] === " ") i++;
    flush();
    if (skipDestinations.has(word)) {
      state.skip = true;
      continue;
    }
    if (word === "bin") {
      i += Math.max(0, n);
      continue;
    }
    if (state.skip) continue;
    if (word === "uc") state.uc = Math.max(0, Math.min(16, n));
    else if (word === "u") {
      buffer += String.fromCharCode(n < 0 ? n + 65536 : n);
      fallback = state.uc;
    } else if (word === "par") endParagraph();
    else if (word === "line") inlines.push(makeNode("LineBreak"));
    else if (word === "tab") buffer += "\t";
    else if (word === "b") state.props.FontWeight = n ? "Bold" : "Normal";
    else if (word === "i") state.props.FontStyle = n ? "Italic" : "Normal";
    else if (word === "ul")
      state.props.TextDecorations = n ? "Underline" : "None";
    else if (word === "ulnone") state.props.TextDecorations = "None";
    else if (word === "strike")
      state.props.TextDecorations = n ? "line-through" : "None";
    else if (word === "fs") state.props.FontSize = n / 1.5;
    else if (word === "f" && fonts.has(n))
      state.props.FontFamily = fonts.get(n);
    else if (word === "cf") {
      if (colors[n]) state.props.Foreground = colors[n];
      else delete state.props.Foreground;
    } else if (word === "highlight" || word === "cb") {
      if (colors[n]) state.props.Background = colors[n];
      else delete state.props.Background;
    } else if (word === "super" || word === "sub" || word === "nosupersub")
      state.props.BaselineAlignment =
        word === "super"
          ? "Superscript"
          : word === "sub"
            ? "Subscript"
            : "Baseline";
    else if (word === "plain") state.props = {};
    else if (word === "pard") state.paragraph = {};
    else if (["ql", "qc", "qr", "qj"].includes(word))
      state.paragraph.TextAlignment = (
        { ql: "Left", qc: "Center", qr: "Right", qj: "Justify" } as Record<
          string,
          string
        >
      )[word];
    else if (word === "emdash") buffer += "—";
    else if (word === "endash") buffer += "–";
    else if (word === "bullet") buffer += "•";
  }
  flush();
  if (inlines.length || !blocks.length)
    blocks.push(paragraph(inlines, state.paragraph));
  return docFromNodes(blocks);
}

export type DocumentFormat =
  "text" | "html" | "markdown" | "xaml" | "rtf" | "json";
export class DocumentSerializer {
  static ToText = toText;
  static FromText = fromText;
  static ToHTML = toHTML;
  static FromHTML = fromHTML;
  static ToMarkdown = toMarkdown;
  static FromMarkdown = fromMarkdown;
  static ToXAML = toXAML;
  static FromXAML = fromXAML;
  static ToRTF = toRTF;
  static FromRTF = fromRTF;
  static ToDOCX = toDOCX;
  static FromDOCX = fromDOCX;
  static ToPDF = toPDF;
  static Serialize(
    document: FlowDocument,
    format: DocumentFormat = "json",
  ): string {
    switch (format) {
      case "text":
        return toText(document);
      case "html":
        return toHTML(document);
      case "markdown":
        return toMarkdown(document);
      case "xaml":
        return toXAML(document);
      case "rtf":
        return toRTF(document);
      case "json":
        return JSON.stringify(document.ToJSON());
      default:
        throw new Error("Unsupported format: " + format);
    }
  }
  static Deserialize(
    value: string,
    format: DocumentFormat = "json",
  ): FlowDocument {
    switch (format) {
      case "text":
        return fromText(value);
      case "html":
        return fromHTML(value);
      case "markdown":
        return fromMarkdown(value);
      case "xaml":
        return fromXAML(value);
      case "rtf":
        return fromRTF(value);
      case "json":
        return FlowDocument.FromJSON(JSON.parse(value));
      default:
        throw new Error("Unsupported format: " + format);
    }
  }
}
