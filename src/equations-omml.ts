import {
  equationToMathML,
  sanitizeMathML,
  type EquationOptions,
} from "./equations.js";
import {
  parseMarkup,
  escapeMarkup as esc,
  textContent,
  type MarkupNode,
} from "./formats-markup.js";

const local = (n: MarkupNode) => n.name.split(":").at(-1)!;
const elements = (n: MarkupNode) =>
  n.children.filter((c) => c.name !== "#text");
const wrap = (tag: string, body: string, props = "") =>
  `<m:${tag}>${props}${body}</m:${tag}>`;
const run = (text: string, properties = "") =>
  `<m:r>${properties ? `<m:rPr>${properties}</m:rPr>` : ""}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
const math = (tag: string, body: string, attrs = "") =>
  `<${tag}${attrs}>${body}</${tag}>`;
const attr = (name: string, value: string) => ` ${name}="${esc(value)}"`;

/** Convert presentation MathML into native editable Office Math, not a picture fallback. */
export function equationToOMML(options: EquationOptions | string): string {
  const root = parseMarkup(equationToMathML(options), true).children[0];
  const convert = (n: MarkupNode): string => {
    if (n.name === "#text") return n.text?.trim() ? run(n.text) : "";
    const name = local(n),
      children = elements(n),
      c = children.map(convert),
      body = c.join("");
    const e = (i: number, tag = "e") => wrap(tag, c[i] ?? "");
    const properties = (tag: string, values: Record<string, string>) =>
      wrap(
        tag + "Pr",
        Object.entries(values)
          .map(([key, value]) => `<m:${key} m:val="${esc(value)}"/>`)
          .join(""),
      );
    switch (name) {
      case "math":
      case "mrow":
      case "semantics":
      case "mstyle":
        return body;
      case "mi":
      case "mn":
      case "mo":
      case "mtext": {
        const variant =
          n.attrs.mathvariant ?? (name === "mi" ? "italic" : "normal");
        const sty = /bold/.test(variant)
          ? /italic/.test(variant)
            ? "bi"
            : "b"
          : /italic/.test(variant)
            ? "i"
            : "p";
        const script = /double-struck/.test(variant)
          ? "double-struck"
          : /fraktur/.test(variant)
            ? "fraktur"
            : /script/.test(variant)
              ? "script"
              : /sans-serif/.test(variant)
                ? "sans-serif"
                : /monospace/.test(variant)
                  ? "monospace"
                  : "roman";
        return run(
          textContent(n),
          `<m:sty m:val="${sty}"/><m:scr m:val="${script}"/>${name === "mtext" ? "<m:nor/>" : ""}`,
        );
      }
      case "mspace":
        return run(" ");
      case "mfrac":
        return wrap(
          "f",
          e(0, "num") + e(1, "den"),
          properties("f", {
            type:
              n.attrs.bevelled === "true"
                ? "skw"
                : /^(0|0px|0pt)$/.test(n.attrs.linethickness)
                  ? "noBar"
                  : "bar",
          }),
        );
      case "msqrt":
        return wrap(
          "rad",
          wrap("deg", "") + wrap("e", body),
          properties("rad", { degHide: "1" }),
        );
      case "mroot":
        return wrap(
          "rad",
          e(1, "deg") + e(0),
          properties("rad", { degHide: "0" }),
        );
      case "msub":
        return wrap("sSub", e(0) + e(1, "sub"));
      case "msup":
        return wrap("sSup", e(0) + e(1, "sup"));
      case "msubsup":
        return wrap("sSubSup", e(0) + e(1, "sub") + e(2, "sup"));
      case "mover": {
        const chr = children[1] ? textContent(children[1]) : "";
        if (n.attrs.accent === "true" || /^[¯‾→^ˆ~˜˙¨⃗]$/.test(chr))
          return wrap("acc", e(0), properties("acc", { chr }));
        if (chr === "⏞" || chr === "⏟")
          return wrap(
            "groupChr",
            e(0),
            properties("groupChr", { chr, pos: "top", vertJc: "bot" }),
          );
        return wrap("limUpp", e(0) + e(1, "lim"));
      }
      case "munder": {
        const chr = children[1] ? textContent(children[1]) : "";
        if (chr === "_" || chr === "¯" || chr === "‾")
          return wrap("bar", e(0), properties("bar", { pos: "bot" }));
        if (chr === "⏟" || chr === "⏞")
          return wrap(
            "groupChr",
            e(0),
            properties("groupChr", { chr, pos: "bot", vertJc: "top" }),
          );
        return wrap("limLow", e(0) + e(1, "lim"));
      }
      case "munderover":
        return wrap(
          "limUpp",
          wrap("e", wrap("limLow", e(0) + e(1, "lim"))) + e(2, "lim"),
        );
      case "mfenced":
        return wrap(
          "d",
          c.map((x) => wrap("e", x)).join(""),
          properties("d", {
            begChr: n.attrs.open ?? "(",
            endChr: n.attrs.close ?? ")",
            sepChr: n.attrs.separators ?? ",",
          }),
        );
      case "mtable":
        return wrap(
          "m",
          children
            .map((row) =>
              wrap(
                "mr",
                elements(row)
                  .map((cell) => wrap("e", convert(cell)))
                  .join(""),
              ),
            )
            .join(""),
        );
      case "mtd":
      case "mtr":
      case "mlabeledtr":
        return body;
      case "menclose": {
        const notes = (n.attrs.notation ?? "longdiv").split(/\s+/);
        return wrap(
          "borderBox",
          wrap("e", body),
          properties("borderBox", {
            hideTop: notes.includes("box") || notes.includes("top") ? "0" : "1",
            hideBot:
              notes.includes("box") || notes.includes("bottom") ? "0" : "1",
            hideLeft:
              notes.includes("box") || notes.includes("left") ? "0" : "1",
            hideRight:
              notes.includes("box") || notes.includes("right") ? "0" : "1",
            strikeH: notes.includes("horizontalstrike") ? "1" : "0",
            strikeV: notes.includes("verticalstrike") ? "1" : "0",
            strikeBLTR: notes.includes("updiagonalstrike") ? "1" : "0",
            strikeTLBR: notes.includes("downdiagonalstrike") ? "1" : "0",
          }),
        );
      }
      case "mphantom":
        return wrap(
          "phant",
          wrap("e", body),
          properties("phant", { show: "0" }),
        );
      case "mpadded":
        return wrap("box", wrap("e", body));
      case "mmultiscripts": {
        let result = c[0] ?? "",
          i = 1;
        for (
          ;
          i < children.length && local(children[i]) !== "mprescripts";
          i += 2
        )
          result = wrap(
            "sSubSup",
            wrap("e", result) + e(i, "sub") + e(i + 1, "sup"),
          );
        for (i++; i < children.length; i += 2)
          result = wrap(
            "sPre",
            e(i, "sub") + e(i + 1, "sup") + wrap("e", result),
          );
        return result;
      }
      case "none":
      case "mprescripts":
      case "annotation":
        return "";
      default:
        throw new TypeError(`Office Math conversion does not support ${name}.`);
    }
  };
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${convert(root)}</m:oMath>`;
}

/** Import the Office Math structural vocabulary as editable presentation MathML. */
export function ommlToMathML(source: string | MarkupNode): string {
  const root =
    typeof source === "string" ? parseMarkup(source, true).children[0] : source;
  let count = 0;
  const convert = (n: MarkupNode, depth = 0): string => {
    if (++count > 5000 || depth > 96)
      throw new RangeError("Office equation exceeds complexity limits.");
    if (n.name === "#text") return "";
    const name = local(n),
      children = elements(n);
    const body = () =>
      children
        .filter((c) => !local(c).endsWith("Pr"))
        .map((c) => convert(c, depth + 1))
        .join("");
    const get = (tag: string) => children.find((c) => local(c) === tag);
    const part = (tag: string) =>
      math("mrow", get(tag) ? convert(get(tag)!, depth + 1) : "");
    const property = (group: string, key: string, fallback: string) => {
      const pr = get(group + "Pr"),
        value = pr && elements(pr).find((c) => local(c) === key);
      return value?.attrs["m:val"] ?? value?.attrs.val ?? fallback;
    };
    switch (name) {
      case "oMath":
      case "oMathPara":
      case "e":
      case "num":
      case "den":
      case "deg":
      case "sub":
      case "sup":
      case "lim":
      case "fName":
        return body();
      case "r": {
        const t = get("t"),
          value = t ? textContent(t) : "";
        const pr = get("rPr"),
          nor = pr && elements(pr).some((c) => local(c) === "nor"),
          sty = property("r", "sty", "i"),
          scr = property("r", "scr", "roman");
        let variant =
          sty === "p"
            ? "normal"
            : sty === "b"
              ? "bold"
              : sty === "bi"
                ? "bold-italic"
                : "italic";
        if (scr !== "roman") variant = (sty === "b" ? "bold-" : "") + scr;
        const tag = nor
          ? "mtext"
          : /^[-+]?\d+(?:[.,]\d+)?$/.test(value)
            ? "mn"
            : /^[\p{L}\p{M}]+$/u.test(value)
              ? "mi"
              : "mo";
        return math(tag, esc(value), attr("mathvariant", variant));
      }
      case "t":
        return math("mi", esc(textContent(n)));
      case "f":
        return math(
          "mfrac",
          part("num") + part("den"),
          property("f", "type", "bar") === "noBar"
            ? ' linethickness="0"'
            : property("f", "type", "bar") === "skw"
              ? ' bevelled="true"'
              : "",
        );
      case "rad":
        return property("rad", "degHide", "0") === "1" ||
          !get("deg") ||
          !textContent(get("deg")!).trim()
          ? math("msqrt", part("e"))
          : math("mroot", part("e") + part("deg"));
      case "sSup":
        return math("msup", part("e") + part("sup"));
      case "sSub":
        return math("msub", part("e") + part("sub"));
      case "sSubSup":
        return math("msubsup", part("e") + part("sub") + part("sup"));
      case "sPre":
        return math(
          "mmultiscripts",
          part("e") + "<mprescripts/>" + part("sub") + part("sup"),
        );
      case "limLow":
        return math("munder", part("e") + part("lim"));
      case "limUpp":
        return math("mover", part("e") + part("lim"));
      case "acc":
        return math(
          "mover",
          part("e") + math("mo", esc(property("acc", "chr", "ˆ"))),
          ' accent="true"',
        );
      case "bar":
        return math(
          property("bar", "pos", "top") === "bot" ? "munder" : "mover",
          part("e") + "<mo>¯</mo>",
          property("bar", "pos", "top") === "bot"
            ? ' accentunder="true"'
            : ' accent="true"',
        );
      case "groupChr":
        return math(
          property("groupChr", "pos", "bot") === "bot" ? "munder" : "mover",
          part("e") + math("mo", esc(property("groupChr", "chr", "⏟"))),
        );
      case "d":
        return math(
          "mfenced",
          children
            .filter((c) => local(c) === "e")
            .map((c) => math("mrow", convert(c, depth + 1)))
            .join(""),
          attr("open", property("d", "begChr", "(")) +
            attr("close", property("d", "endChr", ")")) +
            attr("separators", property("d", "sepChr", "|")),
        );
      case "m":
        return math(
          "mtable",
          children
            .filter((c) => local(c) === "mr")
            .map((c) => convert(c, depth + 1))
            .join(""),
        );
      case "mr":
        return math(
          "mtr",
          children
            .filter((c) => local(c) === "e")
            .map((c) => math("mtd", convert(c, depth + 1)))
            .join(""),
        );
      case "eqArr":
        return math(
          "mtable",
          children
            .filter((c) => local(c) === "e")
            .map((c) => math("mtr", math("mtd", convert(c, depth + 1))))
            .join(""),
        );
      case "nary": {
        let op = math(
          "mo",
          esc(property("nary", "chr", "∫")),
          ' largeop="true"',
        );
        const sub = property("nary", "subHide", "0") !== "1",
          sup = property("nary", "supHide", "0") !== "1",
          limits = property("nary", "limLoc", "subSup") === "undOvr";
        if (sub && sup)
          op = math(
            limits ? "munderover" : "msubsup",
            op + part("sub") + part("sup"),
          );
        else if (sub) op = math(limits ? "munder" : "msub", op + part("sub"));
        else if (sup) op = math(limits ? "mover" : "msup", op + part("sup"));
        return math("mrow", op + part("e"));
      }
      case "func":
        return math("mrow", part("fName") + "<mo>\u2061</mo>" + part("e"));
      case "phant":
        return math(
          property("phant", "show", "0") === "1" ? "mrow" : "mphantom",
          part("e"),
        );
      case "box":
        return part("e");
      case "borderBox": {
        const notes: string[] = [];
        for (const [key, notation] of [
          ["hideTop", "top"],
          ["hideBot", "bottom"],
          ["hideLeft", "left"],
          ["hideRight", "right"],
        ])
          if (property("borderBox", key, "0") !== "1") notes.push(notation);
        for (const [key, notation] of [
          ["strikeH", "horizontalstrike"],
          ["strikeV", "verticalstrike"],
          ["strikeBLTR", "updiagonalstrike"],
          ["strikeTLBR", "downdiagonalstrike"],
        ])
          if (property("borderBox", key, "0") === "1") notes.push(notation);
        return math("menclose", part("e"), attr("notation", notes.join(" ")));
      }
      default:
        if (
          name.endsWith("Pr") ||
          ["ctrlPr", "rPr", "brk", "aln"].includes(name)
        )
          return "";
        throw new TypeError(`Unsupported Office Math element ${name}.`);
    }
  };
  return sanitizeMathML(
    `<math xmlns="http://www.w3.org/1998/Math/MathML">${convert(root)}</math>`,
  );
}
