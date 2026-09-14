import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, Paragraph } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import { toHTML, fromHTML, toDOCX, fromDOCX } from "../src/formats.js";
import {
  renderEquation,
  equationTokens,
  equationMatrixAt,
  editEquationMatrix,
  insertEquationToken,
  deleteEquationToken,
  mathMLToLaTeX,
} from "../src/equations.js";
const math = (source: string) =>
  renderEquation({ Source: source, Format: "mathml" });
const matrix = () =>
  renderEquation(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`).MathML;
const selected = (s: string, label: string) =>
  equationTokens(s).find((t) => t.Text === label)!.Path;

for (const operation of [
  "InsertRowBefore",
  "InsertRowAfter",
  "InsertColumnBefore",
  "InsertColumnAfter",
  "DeleteRow",
  "DeleteColumn",
] as const)
  test(`matrix authoring: ${operation} preserves rectangular structure and renders`, () => {
    const original = matrix(),
      path = selected(original, "c");
    const next = editEquationMatrix(original, path, operation);
    assert.match(math(next).SVG, /<path/);
    const token = equationTokens(next).find(
      (t) => !["(", ")"].includes(t.Text),
    )!;
    const p = equationMatrixAt(next, token.Path);
    assert.equal(
      p.Rows,
      operation.startsWith("InsertRow") ? 3 : operation === "DeleteRow" ? 1 : 2,
    );
    assert.equal(
      p.Columns,
      operation.startsWith("InsertColumn")
        ? 3
        : operation === "DeleteColumn"
          ? 1
          : 2,
    );
    assert.equal(original, matrix(), "Source is immutable");
  });
test("matrix authoring rejects last-cell deletion, merged cells, stale paths and nonmatrix targets", () => {
  const source =
    "<math><mtable><mtr><mtd><mi>x</mi></mtd></mtr></mtable></math>";
  for (const operation of ["DeleteRow", "DeleteColumn"] as const)
    assert.throws(
      () => editEquationMatrix(source, selected(source, "x"), operation),
      /at least one/,
    );
  assert.throws(
    () => editEquationMatrix(matrix(), [99], "InsertRowAfter"),
    /no longer exists/,
  );
  assert.throws(
    () => equationMatrixAt("<math><mi>x</mi></math>", [0]),
    /matrix cell/,
  );
  assert.throws(
    () =>
      equationMatrixAt(
        source.replace("<mtd>", '<mtd columnspan="2">'),
        [0, 0, 0, 0],
      ),
    /unmerged/,
  );
});
test("matrix authoring enforces limits and chooses the innermost nested matrix", () => {
  const source = `<math><mtable><mtr>${"<mtd><mi>x</mi></mtd>".repeat(32)}</mtr></mtable></math>`;
  assert.throws(
    () => editEquationMatrix(source, [0, 0, 0, 0], "InsertColumnAfter"),
    /at most 32/,
  );
  const nested = `<math><mtable><mtr><mtd>${matrix().replace(/<\/?math[^>]*>/g, "")}</mtd></mtr></mtable></math>`;
  assert.equal(equationMatrixAt(nested, selected(nested, "c")).Rows, 2);
});
test("token insertion and deletion retain fixed-arity operands and escape plain text", () => {
  const original = math(
    "<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>",
  ).MathML;
  const next = insertEquationToken(original, selected(original, "a"), "+");
  assert.match(next, /<mfrac><mrow><mi>a<\/mi><mo>\+<\/mo><\/mrow>/);
  assert.match(math(next).SVG, /<path/);
  const removed = deleteEquationToken(original, selected(original, "b"));
  assert.ok(equationTokens(removed).some((t) => t.Text === "□"));
  assert.match(math(removed).SVG, /<path/);
  const untrusted = insertEquationToken(
    original,
    selected(original, "a"),
    "<script>",
  );
  assert.doesNotMatch(untrusted, /<script>/);
  assert.throws(
    () =>
      insertEquationToken(original, selected(original, "a"), "x".repeat(2049)),
    /2048/,
  );
});
for (const tex of [
  String.raw`\frac{a}{b}`,
  String.raw`\sqrt[n]{x}`,
  "a_i^2",
  String.raw`\sum_{i=0}^n x_i`,
  String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  String.raw`\text{a & b}`,
  String.raw`\vec{x}`,
  String.raw`\left|\frac{x}{y}\right|`,
])
  test(`MathML to editable TeX: ${tex}`, () => {
    const original = renderEquation(tex),
      converted = mathMLToLaTeX(original.MathML);
    assert.doesNotMatch(converted, /<math|<mi|<mrow/);
    const rendered = renderEquation(converted);
    assert.match(rendered.SVG, /<path/);
    assert.ok(rendered.WidthEx > 0);
  });
test("unsupported MathML to TeX fails rather than silently replacing structure with XML text", () => {
  assert.throws(
    () =>
      mathMLToLaTeX('<math><mpadded width="2em"><mi>x</mi></mpadded></math>'),
    /Keep MathML/,
  );
});
test("Enter and multiline paste do not inherit physical or column breaks into continuation paragraphs", () => {
  for (const property of ["BreakPageBefore", "BreakColumnBefore"]) {
    const p = new Paragraph("first tail");
    p.SetValue(property, true);
    const d = new FlowDocument(p),
      e = new RichTextEngine(d);
    e.Select(5);
    e.InsertText("\nsecond\nthird");
    assert.equal(d.Blocks.Get(0).GetValue(property), true);
    for (const p of d.Blocks.ToArray().slice(1)) {
      assert.equal(p.GetValue("BreakColumnBefore"), false);
      assert.equal(p.GetValue("BreakPageBefore"), false);
    }
    e.Undo();
    assert.equal(d.Text, "first tail");
    e.Dispose();
  }
});
test("column breaks survive HTML and DOCX round trips, while page breaks take precedence", async () => {
  const p = new Paragraph("column");
  p.BreakColumnBefore = true;
  const d = new FlowDocument(p),
    html = toHTML(d);
  assert.match(html, /break-before:column/);
  assert.equal(
    fromHTML(html).Blocks.Get(0).GetValue("BreakColumnBefore"),
    true,
  );
  const back = await fromDOCX(await toDOCX(d));
  assert.ok(back.ToJSON().children?.some((p) => p.props.BreakColumnBefore));
  p.BreakPageBefore = true;
  assert.match(toHTML(d), /break-before:page/);
  assert.doesNotMatch(toHTML(d), /break-before:column/);
});

import { pageAtOffset, pagePreviewWindow } from "../src/page-window.js";
test("page boundary lookup handles affinity and blank pages without linear scans", () => {
  const Pages = Array.from({ length: 10000 }, (_, i) => ({
    PageNumber: i + 1,
    StartOffset: i * 10,
    EndOffset: (i + 1) * 10,
    HasOverflow: false,
  }));
  assert.equal(pageAtOffset({ Pages }, 54320)?.PageNumber, 5433);
  assert.equal(pageAtOffset({ Pages }, 54320, true)?.PageNumber, 5432);
  assert.equal(pageAtOffset({ Pages }, 54321, true)?.PageNumber, 5433);
  assert.equal(pageAtOffset({ Pages }, 0, true)?.PageNumber, 1);
  assert.equal(pageAtOffset({ Pages }, 100000)?.PageNumber, 10000);
  assert.equal(pageAtOffset({ Pages: [] }, 0), null);
  assert.throws(() => pageAtOffset({ Pages }, NaN), /nonnegative/);
  const blank = [
    Pages[0],
    { ...Pages[1], StartOffset: 10, EndOffset: 10 },
    { ...Pages[2], StartOffset: 10 },
  ];
  assert.equal(pageAtOffset({ Pages: blank }, 10)?.PageNumber, 3);
  assert.equal(pageAtOffset({ Pages: blank }, 10, true)?.PageNumber, 1);
});
test("multiple-pages realization prioritizes every visible page, not just eight overscan sheets", () => {
  const list = pagePreviewWindow({
    PageCount: 5000,
    Columns: 4,
    PageHeight: 100,
    Gap: 24,
    ScrollTop: 248,
    ViewportHeight: 370,
  });
  for (let page = 9; page <= 20; page++) assert.ok(list.includes(page));
  assert.deepEqual(
    list.slice(0, 12),
    Array.from({ length: 12 }, (_, i) => i + 9),
  );
  assert.equal(list.length, 20);
  assert.equal(new Set(list).size, list.length);
});
test("page realization validates geometry and bounds pathological hosts", () => {
  assert.deepEqual(
    pagePreviewWindow({
      PageCount: 1,
      Columns: 4,
      PageHeight: 400,
      ScrollTop: -20,
      ViewportHeight: 800,
    }),
    [1],
  );
  assert.deepEqual(
    pagePreviewWindow({
      PageCount: 0,
      Columns: 1,
      PageHeight: 400,
      ScrollTop: 0,
      ViewportHeight: 800,
    }),
    [],
  );
  assert.throws(
    () =>
      pagePreviewWindow({
        PageCount: 50,
        Columns: 4,
        PageHeight: 0,
        ScrollTop: 0,
        ViewportHeight: 100,
      }),
    /geometry/,
  );
  assert.equal(
    pagePreviewWindow({
      PageCount: 100000,
      Columns: 12,
      PageHeight: 1,
      Gap: 0,
      ScrollTop: 0,
      ViewportHeight: 100000,
    }).length,
    128,
  );
});
