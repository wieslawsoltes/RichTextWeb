import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { MathML } from "mathjax-full/js/input/mathml.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { SerializedMmlVisitor } from "mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import {
  parseMarkup,
  escapeMarkup,
  textContent,
  type MarkupNode,
} from "./formats-markup.js";
import type { DocumentNode, EquationInputFormat } from "./model.js";

export interface EquationOptions {
  Source: string;
  Format?: EquationInputFormat;
  DisplayMode?: boolean;
  AlternativeText?: string;
}
export interface EquationRenderResult {
  readonly SVG: string;
  readonly MathML: string;
  readonly WidthEx: number;
  readonly HeightEx: number;
  readonly DepthEx: number;
  readonly Text: string;
}
export interface EquationTemplate {
  Name: string;
  Category: string;
  Source: string;
}

/** Templates are ordinary editable TeX, not images or executable macros. */
export const EquationTemplates: readonly EquationTemplate[] = Object.freeze(
  [
    ["Fraction", "Structures", String.raw`\frac{a}{b}`],
    ["Square root", "Structures", String.raw`\sqrt{x}`],
    ["Nth root", "Structures", String.raw`\sqrt[n]{x}`],
    ["Power", "Structures", String.raw`x^{n}`],
    ["Subscript", "Structures", String.raw`a_{i}`],
    ["Subscript and power", "Structures", String.raw`a_{i}^{n}`],
    ["Binomial", "Structures", String.raw`\binom{n}{k}`],
    ["Parentheses", "Structures", String.raw`\left(\frac{a}{b}\right)`],
    ["Absolute value", "Structures", String.raw`\left|x\right|`],
    ["Vector", "Structures", String.raw`\vec{v}`],
    ["Overline", "Structures", String.raw`\overline{AB}`],
    [
      "Underbrace",
      "Structures",
      String.raw`\underbrace{a+\cdots+a}_{n\text{ times}}`,
    ],
    ["Sum", "Calculus", String.raw`\sum_{i=1}^{n}a_i`],
    ["Product", "Calculus", String.raw`\prod_{i=1}^{n}a_i`],
    ["Integral", "Calculus", String.raw`\int_a^b f(x)\,dx`],
    ["Double integral", "Calculus", String.raw`\iint_D f(x,y)\,dx\,dy`],
    ["Contour integral", "Calculus", String.raw`\oint_C f(z)\,dz`],
    ["Limit", "Calculus", String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`],
    ["Derivative", "Calculus", String.raw`\frac{d}{dx}f(x)`],
    [
      "Partial derivative",
      "Calculus",
      String.raw`\frac{\partial^2 u}{\partial x^2}`,
    ],
    ["Matrix", "Matrices", String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`],
    [
      "Bracketed matrix",
      "Matrices",
      String.raw`\begin{bmatrix}1&0&0\\0&1&0\\0&0&1\end{bmatrix}`,
    ],
    [
      "Determinant",
      "Matrices",
      String.raw`\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc`,
    ],
    [
      "Cases",
      "Matrices",
      String.raw`f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}`,
    ],
    [
      "Aligned equations",
      "Matrices",
      String.raw`\begin{aligned}a&=b+c\\d&=e+f\end{aligned}`,
    ],
    [
      "Quadratic formula",
      "Algebra",
      String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    ],
    [
      "Binomial theorem",
      "Algebra",
      String.raw`(a+b)^n=\sum_{k=0}^{n}\binom{n}{k}a^{n-k}b^k`,
    ],
    ["Pythagorean theorem", "Algebra", String.raw`a^2+b^2=c^2`],
    ["Euler identity", "Algebra", String.raw`e^{i\pi}+1=0`],
    [
      "Trigonometric identity",
      "Algebra",
      String.raw`\sin^2\theta+\cos^2\theta=1`,
    ],
    [
      "Fourier transform",
      "Calculus",
      String.raw`\hat f(\xi)=\int_{-\infty}^{\infty}f(x)e^{-2\pi i x\xi}\,dx`,
    ],
    [
      "Taylor series",
      "Calculus",
      String.raw`f(x)=\sum_{n=0}^{\infty}\frac{f^{(n)}(a)}{n!}(x-a)^n`,
    ],
    [
      "Normal distribution",
      "Statistics",
      String.raw`f(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}`,
    ],
    [
      "Bayes theorem",
      "Statistics",
      String.raw`P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}`,
    ],
    [
      "Sample variance",
      "Statistics",
      String.raw`s^2=\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^2`,
    ],
    [
      "Set notation",
      "Symbols",
      String.raw`A\subseteq B,\quad A\cup B,\quad A\cap B,\quad x\in\mathbb{R}`,
    ],
    [
      "Logic",
      "Symbols",
      String.raw`\forall x\in A,\quad \exists y\in B:\quad x\Rightarrow y`,
    ],
    ["Bra-ket", "Physics", String.raw`\langle\psi|\hat H|\psi\rangle`],
    [
      "Schrodinger equation",
      "Physics",
      String.raw`i\hbar\frac{\partial}{\partial t}\Psi=\hat H\Psi`,
    ],
    ["Chemical reaction", "Chemistry", String.raw`\ce{2 H2 + O2 -> 2 H2O}`],
    ["Chemical equilibrium", "Chemistry", String.raw`\ce{N2 + 3 H2 <=> 2 NH3}`],
    ["Isotope", "Chemistry", String.raw`\ce{^{14}_{6}C -> ^{14}_{7}N + e-}`],
  ].map(([Name, Category, Source]) =>
    Object.freeze({ Name, Category, Source }),
  ),
);

const tags = new Set(
  "math mrow mi mn mo mtext mspace mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mlabeledtr mtd mstyle mphantom mpadded menclose mfenced mmultiscripts mprescripts none semantics annotation".split(
    " ",
  ),
);
const textTags = new Set(["mi", "mn", "mo", "mtext"]);
const attributes = new Set(
  "display displaystyle scriptlevel mathvariant mathsize mathcolor mathbackground stretchy symmetric fence separator largeop movablelimits form accent accentunder lspace rspace width height depth voffset linethickness bevelled numalign denomalign rowalign columnalign rowspacing columnspacing columnlines rowlines frame framespacing equalrows equalcolumns align open close separators notation rowspan columnspan minsize maxsize".split(
    " ",
  ),
);

/** Strictly bounded, inert presentation MathML. No XML entities, HTML, links, or actions. */
export function sanitizeMathML(source: string): string {
  if (typeof source !== "string" || source.length > 262144)
    throw new RangeError("MathML exceeds the 256 KiB limit.");
  const parsed = parseMarkup(source, true);
  const roots = parsed.children.filter(
    (n) => n.name !== "#text" || n.text?.trim(),
  );
  if (roots.length !== 1 || roots[0].name.split(":").at(-1) !== "math")
    throw new TypeError("MathML must have exactly one math root.");
  let count = 0;
  const visit = (node: MarkupNode, depth: number): string => {
    if (++count > 5000 || depth > 96)
      throw new RangeError("Equation exceeds the MathML complexity limit.");
    if (node.name === "#text") return escapeMarkup(node.text);
    const name = node.name.split(":").at(-1)!;
    if (!tags.has(name))
      throw new TypeError(`Unsupported or unsafe MathML element: ${name}`);
    if (name === "annotation") return "";
    const attrs: string[] =
      name === "math" ? ['xmlns="http://www.w3.org/1998/Math/MathML"'] : [];
    for (const [key, value] of Object.entries(node.attrs)) {
      if (
        key === "xmlns" ||
        key.startsWith("xmlns:") ||
        key.startsWith("data-mjx-")
      )
        continue;
      if (!attributes.has(key))
        throw new TypeError(`Unsupported or unsafe MathML attribute: ${key}`);
      if (value.length > 256 || /[<>"'`;{}\\]|url\s*\(/i.test(value))
        throw new TypeError(`Unsafe MathML attribute value: ${key}`);
      if (
        (key === "mathcolor" || key === "mathbackground") &&
        !/^(#[\da-f]{3,8}|[a-z]+)$/i.test(value)
      )
        throw new TypeError("Math colors must be names or hexadecimal colors.");
      attrs.push(`${key}="${escapeMarkup(value)}"`);
    }
    const children = node.children.filter(
      (child) =>
        textTags.has(name) || child.name !== "#text" || child.text?.trim(),
    );
    const arity: Record<string, number> = {
      mfrac: 2,
      mroot: 2,
      msub: 2,
      msup: 2,
      msubsup: 3,
      munder: 2,
      mover: 2,
      munderover: 3,
    };
    if (name in arity && children.length !== arity[name])
      throw new TypeError(`${name} requires ${arity[name]} children.`);
    if (textTags.has(name) && children.some((child) => child.name !== "#text"))
      throw new TypeError(
        "Math tokens cannot contain active or structural children.",
      );
    if (
      !textTags.has(name) &&
      children.some((child) => child.name === "#text" && child.text?.trim())
    )
      throw new TypeError("Math text must be inside a token element.");
    return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>${children.map((c) => visit(c, depth + 1)).join("")}</${name}>`;
  };
  return visit(roots[0], 0);
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const createTeX = () =>
  new TeX({
    packages: [
      "base",
      "ams",
      "newcommand",
      "configmacros",
      "boldsymbol",
      "mathtools",
      "braket",
      "cancel",
      "color",
      "mhchem",
    ].map((name) => {
      if (!AllPackages.includes(name))
        throw new Error(`The bundled equation package is missing: ${name}`);
      return name;
    }),
    maxBuffer: 16384,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
const mathml = new MathML({ parseAs: "xml", forceReparse: true });
const mathDocument = mathjax.document("", {
  InputJax: mathml,
  OutputJax: new SVG({ fontCache: "none" }),
});
const visitor = new SerializedMmlVisitor();
const cache = new Map<string, EquationRenderResult>();

/** Synchronous deterministic vector math. SVG outlines need no font binaries, network, or DOM. */
export function renderEquation(
  options: EquationOptions | string,
): EquationRenderResult {
  const value = typeof options === "string" ? { Source: options } : options;
  if (!value || typeof value.Source !== "string")
    throw new TypeError("Equation Source must be a string.");
  const format = value.Format ?? "latex",
    display = value.DisplayMode ?? false;
  if (format !== "latex" && format !== "mathml")
    throw new TypeError("Equation Format must be latex or mathml.");
  if (value.Source.length > (format === "latex" ? 16384 : 262144))
    throw new RangeError("Equation source exceeds its input limit.");
  if (
    format === "latex" &&
    /\\(?:require|autoload|href|url|html\w*|style|class|cssId|includegraphics|unicode)\b/i.test(
      value.Source,
    )
  )
    throw new TypeError(
      "External resources, HTML and link macros are disabled in equations.",
    );
  const key = `${format}:${display}:${value.Source}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const source =
    format === "mathml" ? sanitizeMathML(value.Source) : value.Source;
  const document =
    format === "latex"
      ? mathjax.document("", {
          InputJax: createTeX(),
          OutputJax: new SVG({ fontCache: "none" }),
        })
      : mathDocument;
  // Reset tags and macro state between independent equations; document content cannot poison a later conversion.
  const root = document.convert(source || String.raw`\phantom{x}`, {
    display,
    end: 20,
  });
  const mml = sanitizeMathML(visitor.visitTree(root));
  if (mml.includes("<merror"))
    throw new TypeError("The equation could not be parsed.");
  // Render canonical MathML rather than parsing mutable TeX twice.
  const svg = adaptor.outerHTML(
    mathDocument.convert(mml, { display, em: 16, ex: 8, containerWidth: 1280 }),
  );
  if (
    svg.length > 4 * 1024 * 1024 ||
    /<(?:script|foreignObject)|\s(?:on\w+|href|xlink:href)\s*=/i.test(svg)
  )
    throw new TypeError(
      "Equation output exceeded the safe vector rendering boundary.",
    );
  const WidthEx = Number(svg.match(/\bwidth="([\d.]+)ex"/)?.[1] ?? 1);
  const HeightEx = Number(svg.match(/\bheight="([\d.]+)ex"/)?.[1] ?? 2);
  const DepthEx = -Number(svg.match(/vertical-align:\s*([\d.-]+)ex/)?.[1] ?? 0);
  if (
    ![WidthEx, HeightEx, DepthEx].every(Number.isFinite) ||
    Math.max(WidthEx, HeightEx) > 2000
  )
    throw new RangeError("Equation dimensions exceed the safe layout limit.");
  const Text = textContent(parseMarkup(mml, true)).replace(/\s+/g, " ").trim();
  const result = Object.freeze({
    SVG: svg,
    MathML: mml,
    WidthEx,
    HeightEx,
    DepthEx,
    Text,
  });
  cache.set(key, result);
  while (cache.size > 128) cache.delete(cache.keys().next().value!);
  return result;
}
export function clearEquationCache(): void {
  cache.clear();
}
export function equationOptions(node: DocumentNode): EquationOptions {
  return {
    Source: node.props.EquationSource ?? "",
    Format: node.props.EquationFormat ?? "latex",
    DisplayMode: !!node.props.DisplayMode,
    AlternativeText: node.props.AlternativeText ?? "",
  };
}
export function equationToMathML(options: EquationOptions | string): string {
  return renderEquation(options).MathML;
}
export function equationToSVG(options: EquationOptions | string): string {
  return renderEquation(options).SVG;
}

export interface MathToken {
  Path: number[];
  Kind: string;
  Text: string;
}
export function equationTokens(mathML: string): MathToken[] {
  const root = parseMarkup(sanitizeMathML(mathML), true).children[0];
  const result: MathToken[] = [];
  const walk = (node: MarkupNode, path: number[]) => {
    if (textTags.has(node.name))
      result.push({ Path: path, Kind: node.name, Text: textContent(node) });
    else
      node.children.forEach((child, i) => {
        if (child.name !== "#text") walk(child, [...path, i]);
      });
  };
  walk(root, []);
  return result;
}
export function serializeMathNode(node: MarkupNode): string {
  return node.name === "#text"
    ? escapeMarkup(node.text)
    : `<${node.name}${Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeMarkup(v)}"`)
        .join(
          "",
        )}>${node.children.map(serializeMathNode).join("")}</${node.name}>`;
}
/** Replace a selected visual token with text or a structural MathML expression. */
export function replaceEquationToken(
  mathML: string,
  path: readonly number[],
  text: string,
  structure?:
    "fraction" | "power" | "subscript" | "root" | "sum" | "integral" | "matrix",
): string {
  const root = parseMarkup(sanitizeMathML(mathML), true).children[0];
  let target = root,
    parent: MarkupNode | null = null,
    index = 0;
  for (const part of path) {
    if (!Number.isInteger(part) || !target.children[part])
      throw new RangeError("The selected equation token no longer exists.");
    parent = target;
    index = part;
    target = target.children[part];
  }
  if (!textTags.has(target.name))
    throw new TypeError("Select a visible math token first.");
  const token = (kind: string, value: string): MarkupNode => ({
    name: kind,
    attrs: {},
    children: [{ name: "#text", attrs: {}, children: [], text: value }],
  });
  const group = (kind: string, children: MarkupNode[]): MarkupNode => ({
    name: kind,
    attrs: {},
    children,
  });
  let next = token(target.name, text.slice(0, 2048));
  if (structure === "fraction") next = group("mfrac", [next, token("mi", "b")]);
  if (structure === "power") next = group("msup", [next, token("mn", "2")]);
  if (structure === "subscript") next = group("msub", [next, token("mi", "i")]);
  if (structure === "root") next = group("msqrt", [next]);
  if (structure === "sum" || structure === "integral")
    next = group("mrow", [
      group("munderover", [
        token("mo", structure === "sum" ? "∑" : "∫"),
        token("mn", "0"),
        token("mi", "n"),
      ]),
      next,
    ]);
  if (structure === "matrix")
    next = group("mtable", [
      group("mtr", [group("mtd", [next]), group("mtd", [token("mi", "b")])]),
      group("mtr", [
        group("mtd", [token("mi", "c")]),
        group("mtd", [token("mi", "d")]),
      ]),
    ]);
  if (!parent)
    throw new TypeError("A math root cannot be replaced with a token.");
  parent.children[index] = next;
  return sanitizeMathML(serializeMathNode(root));
}

export * from "./equation-structure.js";
