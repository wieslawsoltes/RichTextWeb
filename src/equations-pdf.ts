import {
  PDFPage,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rgb,
  type Color,
} from "pdf-lib";
import { parseMarkup, type MarkupNode } from "./formats-markup.js";
import type { EquationRenderResult } from "./equations.js";

function number(value: string | undefined, fallback = 0): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e8)
    throw new RangeError("Invalid equation vector coordinate.");
  return result;
}
function paint(value: string, current: Color): Color | undefined {
  if (value === "none") return undefined;
  if (value === "currentColor" || !value) return current;
  const named: Record<string, string> = {
    black: "000000",
    white: "ffffff",
    red: "ff0000",
    green: "008000",
    blue: "0000ff",
    yellow: "ffff00",
    orange: "ffa500",
    purple: "800080",
    gray: "808080",
    grey: "808080",
    cyan: "00ffff",
    magenta: "ff00ff",
    teal: "008080",
    navy: "000080",
    maroon: "800000",
    lime: "00ff00",
    olive: "808000",
    silver: "c0c0c0",
  };
  let hex = value.startsWith("#") ? value.slice(1) : named[value.toLowerCase()];
  if (hex?.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  if (!hex || !/^[\da-f]{6}$/i.test(hex))
    throw new TypeError(
      `PDF equation color is not supported: ${value}. Use a six-digit hexadecimal color.`,
    );
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
}

/** Draw safe MathJax outlines as PDF paths, retaining vector quality without font binaries. */
export function drawEquationPDF(
  page: PDFPage,
  result: EquationRenderResult,
  x: number,
  top: number,
  width: number,
  height: number,
  foreground: Color = rgb(0, 0, 0),
): void {
  const root = parseMarkup(result.SVG, true);
  const svg = root.children
    .find((n) => n.name === "mjx-container")
    ?.children.find((n) => n.name === "svg");
  if (!svg) throw new TypeError("Equation output has no SVG viewport.");
  const box = (svg.attrs.viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map((v) => number(v));
  if (box.length !== 4 || box[2] <= 0 || box[3] <= 0)
    throw new TypeError("Equation output has an invalid SVG viewport.");
  const sx = width / box[2],
    sy = height / box[3];
  const transforms = (source: string) => {
    let remainder = source;
    for (const match of source.matchAll(
      /(translate|scale|matrix)\s*\(([^)]*)\)/g,
    )) {
      remainder = remainder.replace(match[0], "");
      const n = match[2]
        .trim()
        .split(/[\s,]+/)
        .map((v) => number(v));
      if (match[1] === "translate" && (n.length === 1 || n.length === 2))
        page.pushOperators(
          concatTransformationMatrix(1, 0, 0, 1, n[0], n[1] ?? 0),
        );
      else if (match[1] === "scale" && (n.length === 1 || n.length === 2))
        page.pushOperators(
          concatTransformationMatrix(n[0], 0, 0, n[1] ?? n[0], 0, 0),
        );
      else if (match[1] === "matrix" && n.length === 6)
        page.pushOperators(
          concatTransformationMatrix(n[0], n[1], n[2], n[3], n[4], n[5]),
        );
      else throw new TypeError("Invalid equation SVG transform.");
    }
    if (remainder.trim())
      throw new TypeError("Unsupported equation SVG transform.");
  };
  const walk = (
    node: MarkupNode,
    fill: Color | undefined,
    stroke: Color | undefined,
    strokeWidth: number,
    current: Color,
  ): void => {
    if (node.name === "#text") {
      if (node.text?.trim())
        throw new TypeError(
          "PDF equation contains a glyph without an outline.",
        );
      return;
    }
    if (!["g", "path", "rect", "svg"].includes(node.name))
      throw new TypeError(
        `PDF equation requires an unsupported SVG primitive: ${node.name}`,
      );
    page.pushOperators(pushGraphicsState());
    try {
      transforms(node.attrs.transform ?? "");
      const style = Object.fromEntries(
        (node.attrs.style ?? "")
          .split(";")
          .filter(Boolean)
          .map((pair) => pair.split(":").map((s) => s.trim())),
      );
      const currentColor =
        paint(node.attrs.color ?? style.color ?? "currentColor", current) ??
        current;
      const f =
        node.attrs.fill !== undefined
          ? paint(node.attrs.fill, currentColor)
          : fill;
      const s =
        node.attrs.stroke !== undefined
          ? paint(node.attrs.stroke, currentColor)
          : stroke;
      const sw =
        node.attrs["stroke-width"] !== undefined
          ? number(node.attrs["stroke-width"])
          : strokeWidth;
      if (node.name === "path") {
        // pdf-lib flips the path Y axis; cancel that local flip, since SVG's complete CTM is already applied.
        page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
        page.drawSvgPath(node.attrs.d ?? "", {
          x: 0,
          y: 0,
          color: f,
          borderColor: sw > 0 ? s : undefined,
          borderWidth: sw,
        });
      } else if (node.name === "rect") {
        page.drawRectangle({
          x: number(node.attrs.x),
          y: number(node.attrs.y),
          width: number(node.attrs.width),
          height: number(node.attrs.height),
          color: f,
          borderColor: sw > 0 ? s : undefined,
          borderWidth: sw,
        });
      } else
        for (const child of node.children) walk(child, f, s, sw, currentColor);
    } finally {
      page.pushOperators(popGraphicsState());
    }
  };
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      sx,
      0,
      0,
      -sy,
      x - box[0] * sx,
      top + box[1] * sy,
    ),
  );
  try {
    for (const node of svg.children)
      walk(node, foreground, undefined, 0, foreground);
  } finally {
    page.pushOperators(popGraphicsState());
  }
}
