import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  PDFDocument,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import {
  FlowDocument,
  Paragraph,
  Run,
  Equation,
  TextPointer,
  TextPointerContext,
  LogicalDirection,
  Thickness,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  renderEquation,
  EquationTemplates,
  sanitizeMathML,
  equationTokens,
  replaceEquationToken,
  clearEquationCache,
} from "../src/equations.js";
import { equationToOMML, ommlToMathML } from "../src/equations-omml.js";
import {
  fromHTML,
  toHTML,
  fromMarkdown,
  toMarkdown,
  fromXAML,
  toXAML,
  fromDOCX,
  toDOCX,
} from "../src/formats.js";
import { toPDF } from "../src/formats-pdf.js";
import { pageSettings } from "../src/pagination.js";
import { CollaborativeDocumentSession } from "../src/collaboration-document.js";

for (const template of EquationTemplates)
  test(`equation template: ${template.Name} renders vectors and editable Office Math`, () => {
    const rendered = renderEquation({
      Source: template.Source,
      DisplayMode: true,
    });
    assert.match(rendered.SVG, /<svg/);
    assert.match(rendered.SVG, /<path/);
    assert.ok(rendered.WidthEx > 0 && rendered.HeightEx > 0);
    assert.match(rendered.MathML, /<math/);
    assert.doesNotMatch(
      rendered.SVG,
      /<(?:image|foreignObject|script)\b|href=|url\(/i,
    );
    const office = equationToOMML(template.Source);
    assert.match(office, /<m:oMath/);
    const restored = ommlToMathML(office);
    assert.match(
      renderEquation({ Source: restored, Format: "mathml" }).SVG,
      /<path/,
    );
  });

test("equations have isolated macro state, bounded expansion and immutable cached output", () => {
  const custom = renderEquation(
    String.raw`\newcommand{\privateVariable}{x}\privateVariable`,
  );
  assert.match(custom.MathML, />x</);
  assert.throws(() => renderEquation(String.raw`\privateVariable`));
  assert.throws(() => renderEquation(String.raw`\def\a{\a}\a`));
  assert.throws(
    () => renderEquation("x".repeat(16385)),
    /limit|length|exceed|16/i,
  );
  assert.ok(Object.isFrozen(custom));
  clearEquationCache();
  assert.equal(renderEquation("x^2"), renderEquation("x^2"));
});

for (const source of [
  '<math><mi onclick="alert(1)">x</mi></math>',
  "<math><maction><mi>x</mi></maction></math>",
  "<math><annotation-xml><script>alert(1)</script></annotation-xml></math>",
  '<math><mi href="javascript:alert(1)">x</mi></math>',
  '<math><mstyle style="background:url(https://example.com/x)"><mi>x</mi></mstyle></math>',
  "<math><mfrac><mi>x</mi></mfrac></math>",
  "<math><mi><msup><mi>x</mi><mn>2</mn></msup></mi></math>",
  "<math><mrow>not a token</mrow></math>",
])
  test(`unsafe/malformed equation rejects: ${source.slice(0, 55)}`, () => {
    assert.throws(() => sanitizeMathML(source));
  });

test("canonical MathML ignores formatting whitespace and supports visual structural token edits", () => {
  const source = "<math>\n<mfrac>\n<mi>a</mi>\n<mi>b</mi>\n</mfrac>\n</math>";
  const result = renderEquation({ Source: source, Format: "mathml" });
  const tokens = equationTokens(result.MathML);
  assert.equal(tokens[0].Text, "a");
  for (const operation of [
    "fraction",
    "power",
    "subscript",
    "root",
    "sum",
    "integral",
    "matrix",
  ] as const) {
    const changed = replaceEquationToken(
      result.MathML,
      tokens[0].Path,
      "z",
      operation,
    );
    assert.match(changed, />z</);
    assert.match(
      renderEquation({ Source: changed, Format: "mathml" }).SVG,
      /<path/,
    );
  }
});

test("equations are single-position inline objects with identity-preserving edit history", () => {
  const doc = new FlowDocument(new Paragraph("before after")),
    engine = new RichTextEngine(doc);
  engine.Select(7);
  const id = engine.InsertEquation(String.raw`\frac{a}{b}`);
  assert.equal(doc.Text, "before \uFFFCafter");
  const equation = doc.FindById(id);
  assert.ok(equation instanceof Equation);
  assert.equal(FlowDocument.FromJSON(doc.ToJSON()).Text, doc.Text);
  engine.UpdateEquation(id, "x^2", "latex", true);
  assert.equal((doc.FindById(id) as Equation).Source, "x^2");
  engine.Undo();
  assert.equal((doc.FindById(id) as Equation).Source, String.raw`\frac{a}{b}`);
  engine.Undo();
  assert.equal(doc.Text, "before after");
  engine.Redo();
  assert.equal(doc.Text, "before \uFFFCafter");
  engine.Select(7, 8);
  engine.InsertText("math ");
  assert.equal(doc.Text, "before math after");
  engine.Undo();
  assert.ok(doc.FindById(id) instanceof Equation);
  engine.Dispose();
});

test("equations round-trip HTML, Markdown, MathML and inert extended FlowDocument XAML", () => {
  const doc = new FlowDocument([
    new Paragraph([new Run("Formula: "), new Equation("x^2")]),
    new Paragraph(new Equation(String.raw`\frac{a+b}{c}`, "latex", true)),
  ]);
  for (const [write, read] of [
    [toHTML, fromHTML],
    [toMarkdown, fromMarkdown],
    [toXAML, fromXAML],
  ] as const) {
    const saved = write(doc),
      restored = read(saved);
    assert.equal(
      restored.Text,
      doc.Text,
      `Text changed in ${write.name}: ${saved}`,
    );
    const equations = restored
      .ToJSON()
      .children!.flatMap((p) => p.children ?? [])
      .filter((n) => n.type === "Equation");
    assert.equal(equations.length, 2, write.name);
    assert.equal(equations[1].props.DisplayMode, true, write.name);
    assert.equal(
      equations[1].props.EquationSource,
      String.raw`\frac{a+b}{c}`,
      write.name,
    );
  }
  const mathml = "<math><msup><mi>x</mi><mn>2</mn></msup></math>";
  assert.equal(fromHTML(`<p>Inline ${mathml}</p>`).Text, "Inline \uFFFC");
  const xml = toXAML(new FlowDocument(new Paragraph(new Equation("{a+b}"))));
  assert.equal(
    (fromXAML(xml).Blocks.Get(0) as Paragraph).Inlines.Get(0).GetValue(
      "EquationSource",
    ),
    "{a+b}",
  );
  assert.equal(
    fromMarkdown("Price $12 and $14. Keep \\$ literal.").Text,
    "Price $12 and $14. Keep $ literal.",
  );
});

test("DOCX equations are native Office Math and preserve exact source through lossless extension", async () => {
  const doc = new FlowDocument(
    new Paragraph([
      new Run("Before "),
      new Equation(String.raw`\int_0^1 x^2\,dx`, "latex", true),
      new Run(" after"),
    ]),
  );
  const bytes = await toDOCX(doc),
    zip = await JSZip.loadAsync(bytes),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<m:oMath/);
  assert.doesNotMatch(xml, /<w:drawing/);
  const restored = await fromDOCX(bytes);
  assert.equal(restored.Text, doc.Text);
  assert.equal(
    (restored.Blocks.Get(0) as Paragraph).Inlines.Get(1).GetValue(
      "EquationSource",
    ),
    String.raw`\int_0^1 x^2\,dx`,
  );
  const foreign = new JSZip();
  foreign.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p>${equationToOMML(String.raw`\frac{a}{b}`)}</w:p></w:body></w:document>`,
  );
  const imported = await fromDOCX(
    await foreign.generateAsync({ type: "uint8array" }),
  );
  assert.equal(imported.Text, "\uFFFC");
  assert.equal(imported.Blocks.Get(0).Children[0].Type, "Equation");
});

test("equation PDF export uses actual vector operators rather than raster pictures", async () => {
  const doc = new FlowDocument([
    new Paragraph("Equation output"),
    new Paragraph(
      new Equation(String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, "latex", true),
    ),
  ]);
  const pdf = await PDFDocument.load(await toPDF(doc));
  assert.equal(pdf.getPageCount(), 1);
  let content = "";
  for (const p of pdf.getPages()) {
    const raw = p.node.Contents(),
      streams =
        raw instanceof PDFArray
          ? raw.asArray().map((r) => pdf.context.lookup(r))
          : [raw];
    for (const stream of streams)
      if (stream instanceof PDFRawStream)
        content += Buffer.from(decodePDFRawStream(stream).decode()).toString(
          "latin1",
        );
  }
  assert.match(content, /\n[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ c/);
  assert.doesNotMatch(content, /\/Image-/);
  assert.match(content, /Tj/);
});

test("rich coauthoring retains concurrent equation and neighboring text edits", () => {
  const equation = new Equation("x^2"),
    doc = new FlowDocument(new Paragraph([new Run("Text"), equation])).ToJSON();
  const a = new CollaborativeDocumentSession({
      DocumentId: "math",
      ActorId: "a",
      Document: doc,
    }),
    b = new CollaborativeDocumentSession({
      DocumentId: "math",
      ActorId: "b",
      Document: doc,
    });
  const x = a.SetProperty(equation.Id, "EquationSource", "y^2"),
    y = b.ReplaceText(doc.children![0].children![0].id, 0, 4, "Changed");
  a.Receive(y);
  b.Receive(x);
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
  assert.equal(a.Text, "Changed\uFFFC");
  assert.equal(
    a.DocumentJSON.children![0].children![1].props.EquationSource,
    "y^2",
  );
});

test("page and column break commands split at caret in one reversible edit", () => {
  for (const command of ["InsertPageBreak", "InsertColumnBreak"]) {
    const doc = new FlowDocument(new Paragraph("left right")),
      engine = new RichTextEngine(doc);
    engine.Select(5);
    engine.Execute(command);
    assert.equal(doc.Text, "left \nright");
    assert.equal(doc.Blocks.Count, 2);
    assert.equal(
      doc.Blocks.Get(1).GetValue(
        command === "InsertPageBreak" ? "BreakPageBefore" : "BreakColumnBefore",
      ),
      true,
    );
    engine.Undo();
    assert.equal(doc.Text, "left right");
    engine.Redo();
    assert.equal(doc.Text, "left \nright");
    engine.Dispose();
  }
});

test("DOCX line and column breaks preserve text and split native paragraphs", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First</w:t><w:br w:type="page"/><w:t>Second</w:t><w:br w:type="column"/><w:t>Third</w:t></w:r></w:p></w:body></w:document>',
  );
  const doc = await fromDOCX(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(doc.Text, "First\nSecond\nThird");
  assert.equal(doc.Blocks.Get(1).GetValue("BreakPageBefore"), true);
  assert.equal(doc.Blocks.Get(2).GetValue("BreakColumnBefore"), true);
  const second = await fromDOCX(await toDOCX(doc));
  assert.equal(second.Text, doc.Text);
  assert.equal(second.Blocks.Get(2).GetValue("BreakColumnBefore"), true);
});

test("default paper geometry and .NET Thickness strings agree with the model", () => {
  const doc = new FlowDocument(new Paragraph("Geometry"));
  const settings = pageSettings(doc.ToJSON().props);
  assert.equal(settings.PageWidth, doc.PageWidth);
  assert.equal(settings.PageHeight, doc.PageHeight);
  assert.equal(settings.ColumnGap, doc.ColumnGap);
  const p = pageSettings({ PagePadding: "10,20,30,40" });
  assert.deepEqual(p.Padding, { Left: 10, Top: 20, Right: 30, Bottom: 40 });
  assert.deepEqual(pageSettings({ PagePadding: "10 20 30 40" }).Padding, {
    Left: 40,
    Top: 10,
    Right: 20,
    Bottom: 30,
  });
  const html = toHTML(new FlowDocument(new Paragraph("indent")));
  assert.ok(html);
});

test("paragraph first-line indent and exact line height round-trip through native DOCX", async () => {
  const p = new Paragraph("Paragraph metrics");
  p.SetValue("TextIndent", -24);
  p.LineHeight = 28;
  p.Margin = new Thickness(32, 8, 12, 16);
  const restored = await fromDOCX(await toDOCX(new FlowDocument(p))),
    r = restored.Blocks.Get(0);
  assert.equal(r.GetValue("TextIndent"), -24);
  assert.equal(r.LineHeight, 28);
  assert.deepEqual(r.ToJSON().props.Margin, {
    Left: 32,
    Right: 12,
    Top: 8,
    Bottom: 16,
  });
});

test("native bridge exchanges equations and applies native equation and page commands", async () => {
  const { RichTextWebBridge, BridgeProtocol } =
    await import("../src/bridge.js");
  const engine = new RichTextEngine(new FlowDocument(new Paragraph("Native ")));
  engine.Select(7);
  const bridge = new RichTextWebBridge(engine, () => {});
  let sequence = 0;
  const call = (method: string, params: Record<string, unknown>) => {
    const response = bridge.HandleMessage({
      ...BridgeProtocol,
      kind: "request",
      id: `math-${++sequence}`,
      method,
      params,
    });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response;
  };
  call("execute", {
    command: "InsertEquation",
    parameter: { Source: "x^2", DisplayMode: true },
  });
  assert.equal(engine.Document.Text, "Native \uFFFC");
  const saved = engine.Document.ToJSON();
  call("setDocument", { document: saved });
  assert.equal(engine.Document.Text, "Native \uFFFC");
  const id = engine.Document.Blocks.Get(0).Children[1].Id;
  call("execute", {
    command: "UpdateEquation",
    parameter: { Id: id, Source: "y^2", Format: "latex", DisplayMode: false },
  });
  assert.equal(engine.Document.FindById(id)!.GetValue("EquationSource"), "y^2");
  bridge.Dispose();
  engine.Dispose();
});

test("React equation workbench server rendering needs no browser globals", async () => {
  const { createElement } = await import("react"),
    { renderToString } = await import("react-dom/server"),
    { ReactEquationEditor } = await import("../src/react.js");
  const rendered = renderToString(
    createElement(ReactEquationEditor, {
      value: { Source: "x^2" },
      "aria-label": "Equation",
    }),
  );
  assert.match(rendered, /<rich-equation-editor/);
  assert.match(rendered, /aria-label="Equation"/);
  assert.doesNotMatch(rendered, /\[object Object\]/);
});
