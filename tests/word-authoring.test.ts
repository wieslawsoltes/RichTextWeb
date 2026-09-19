import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  FlowDocument,
  Paragraph,
  Run,
  Span,
  Equation,
  Figure,
  type DocumentNode,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  DocumentFeatures,
  createField,
  createFieldFromInstruction,
  updateDocumentFields,
} from "../src/document-features.js";
import { evaluateFormula } from "../src/formula.js";
import {
  parseFieldCode,
  formatFieldDate,
  formatFieldNumber,
} from "../src/field-code.js";
import { getDocumentStatistics } from "../src/document-statistics.js";
import { buildTableGrid, sortTableRows } from "../src/table-grid.js";
import { textBlocks, plainText } from "../src/engine-tree.js";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";

const node = (
  type: string,
  children: DocumentNode[] = [],
  props: Record<string, any> = {},
): DocumentNode => ({ type, id: new Run().Id, props, children });
const field = (code: string, cache = "?") =>
  createFieldFromInstruction(code, cache).ToJSON();
const cell = (value: string | DocumentNode, props: Record<string, any> = {}) =>
  node(
    "TableCell",
    [
      node("Paragraph", [
        typeof value === "string" ? new Run(value).ToJSON() : value,
      ]),
    ],
    props,
  );
const table = (values: (string | DocumentNode)[][]) =>
  node("Table", [
    node(
      "TableRowGroup",
      values.map((row) =>
        node(
          "TableRow",
          row.map((v) => cell(v)),
        ),
      ),
    ),
  ]);
const doc = (...blocks: DocumentNode[]) =>
  FlowDocument.FromJSON(node("FlowDocument", blocks));
const all = (root: DocumentNode): DocumentNode[] => [
  root,
  ...(root.children ?? []).flatMap(all),
];
const fields = (root: DocumentNode) => all(root).filter((n) => n.props.Field);
const displays = (root: DocumentNode) =>
  fields(root).map((n) =>
    n.type === "Run" ? n.text : (n.children ?? []).map((c) => c.text).join(""),
  );

for (const [source, expected] of [
  ["2+3*4", 14],
  ["(2+3)*4", 20],
  ["2^3^2", 512],
  ["-2^2", -4],
  ["2^-2", 0.25],
  ["50%*200", 100],
  ["ABS(-3)", 3],
  ["INT(-1.2)", -2],
  ["SIGN(-8)", -1],
  ["SIGN(0)", 0],
  ["SUM(1,2,3)", 6],
  ["AVERAGE(2,4,6)", 4],
  ["COUNT(2,4,6)", 3],
  ["MIN(-1,0,5)", -1],
  ["MAX(-1,0,5)", 5],
  ["PRODUCT(2,3,4)", 24],
  ["MOD(-5,3)", 1],
  ["ROUND(2.675,2)", 2.68],
  ["ROUND(-2.5,0)", -3],
  ["ROUND(1234,-2)", 1200],
  ["AND(1,2,TRUE())", 1],
  ["OR(0,FALSE(),2)", 1],
  ["NOT(3)", 0],
  ["IF(2>1,42,1/0)", 42],
  ["IF(0,missing,3)", 3],
  ["DEFINED(missing)", 0],
  ["DEFINED(2)", 1],
  ["2<>3", 1],
  ["2<=2", 1],
  ["2>=3", 0],
] as const)
  test(`bounded Word arithmetic: ${source}`, () =>
    assert.equal(evaluateFormula(source), expected));

for (const source of [
  "1/0",
  "1e309",
  "2**3",
  "globalThis.process.exit()",
  "alert(1)",
  "1;2",
  "SUM(1,)",
  "IF(1,2)",
  "ROUND(1,99)",
  "2(3)",
  '"1"',
  "(".repeat(65) + "1" + ")".repeat(65),
])
  test(`formula rejects invalid or executable syntax: ${source.slice(0, 45)}`, () =>
    assert.throws(() => evaluateFormula(source)));

test("field tokenizer preserves quoted names, escaped quotes, expressions and switches", () => {
  const parsed = parseFieldCode(
    'MERGEFIELD "Customer \\"Name\\"" \\* Upper \\# "0.00"',
  );
  assert.equal(parsed.Arguments[0], 'Customer "Name"');
  assert.deepEqual(parsed.Switches["*"], ["Upper"]);
  assert.equal(
    parseFieldCode('= SUM(A1:B3) / 2 \\# "#,##0.00"').Expression,
    "SUM(A1:B3) / 2",
  );
  assert.throws(() => parseFieldCode('REF "not closed'));
  assert.throws(() => parseFieldCode("a".repeat(16385)));
});

test("numeric pictures support grouping, precision, percentage and sign/zero sections", () => {
  assert.equal(formatFieldNumber(1234.567, "#,##0.00"), "1,234.57");
  assert.equal(
    formatFieldNumber(-12.5, '"$"0.00;("$"0.00);"zero"'),
    "($12.50)",
  );
  assert.equal(formatFieldNumber(0, '0.00;(0.00);"zero"'), "zero");
  assert.equal(formatFieldNumber(0.125, "0.0%"), "12.5%");
  assert.equal(formatFieldNumber(42, "00000"), "00042");
  assert.throws(() => formatFieldNumber(3, "0.0000000000000"));
  assert.throws(() => formatFieldNumber(3, "0.00 evil"));
});

test("date pictures are UTC and honor Word month/minute and literal tokens", () => {
  const now = new Date("2026-09-19T23:08:05Z");
  assert.equal(
    formatFieldDate(now, "yyyy-MM-dd HH:mm:ss"),
    "2026-09-19 23:08:05",
  );
  assert.equal(
    formatFieldDate(now, 'dddd, MMMM d, yyyy "at" h:mm AM/PM'),
    "Saturday, September 19, 2026 at 11:08 PM",
  );
  assert.throws(() => formatFieldDate(now, "unsupported"));
});

test("extended fields resolve scalars, conditions, sequence switches, dates and section context", () => {
  const codes = [
    "DOCPROPERTY Title \\* Upper",
    'DOCVARIABLE Price \\# "0.00"',
    'IF Price >= 10 "approved" "review"',
    "SEQ Figure \\r 4",
    "SEQ Figure \\c",
    "SEQ Figure",
    "SEQ Figure \\h",
    "SEQ Figure \\* ROMAN",
    'DATE \\@ "yyyy-MM-dd"',
    'CREATEDATE \\@ "yyyy"',
    'SAVEDATE \\@ "HH:mm"',
    "SECTION",
    "SECTIONPAGES",
  ];
  const root = doc(
    node(
      "Paragraph",
      codes.flatMap((c, i) => [
        ...(i ? [new Run("|").ToJSON()] : []),
        field(c),
      ]),
    ),
  ).ToJSON();
  root.props.Title = "Report";
  root.props.DocumentVariables = { Price: 12.5 };
  root.props.CreatedAt = "2020-01-01T00:00:00Z";
  root.props.ModifiedAt = "2026-09-19T10:15:00Z";
  const result = updateDocumentFields(root, {
    Now: new Date("2026-09-19T00:00:00Z"),
    SectionNumber: 2,
    SectionPageCount: 8,
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(
    plainText(root),
    "REPORT|12.50|approved|4|4|5||VII|2026-09-19|2020|10:15|2|8",
  );
});

test("unknown, malformed and unavailable fields retain cached text and report diagnostics", () => {
  const root = doc(
    node("Paragraph", [
      field("DDE shell command", "safe"),
      field("REF absent", "cached"),
      field("SEQ Figure \\s 1", "9"),
    ]),
  ).ToJSON();
  fields(root)[1].props.Field.Instruction = 'REF "broken';
  const before = structuredClone(root),
    result = updateDocumentFields(root);
  assert.equal(result.Unresolved.length, 3);
  assert.deepEqual(root, before);
});

test("table formulas use forward numeric dependencies rather than formatted display caches", () => {
  const root = doc(
    table([
      [field('= B1 * 2 \\# "0.00"'), field('= SUM(A2:B2) \\# "$0.00"')],
      ["12.5", "7.5"],
      [field("= R1C1 + R1C2"), field("= SUM(ABOVE)")],
    ]),
  ).ToJSON();
  const result = updateDocumentFields(root);
  assert.deepEqual(result.Unresolved, []);
  assert.deepEqual(displays(root), ["40.00", "$20.00", "60", "27.5"]);
});

test("positional formulas exclude header rows and count merged cells only once", () => {
  const t = table([
    ["900", "800", "700"],
    ["10", "20", "30"],
    [field("= SUM(ABOVE)"), field("= SUM(A2:C2)"), field("= SUM(LEFT)")],
  ]);
  t.children![0].children![0].props.IsHeader = true;
  const root = doc(t).ToJSON();
  assert.deepEqual(updateDocumentFields(root).Unresolved, []);
  assert.deepEqual(displays(root), ["10", "60", "70"]);
  const merged = table([
    ["5", "7"],
    [field("= SUM(A1:B1)"), field("= SUM(C)")],
  ]);
  const first = merged.children![0].children![0];
  first.children!.splice(1, 1);
  first.children![0].props.ColumnSpan = 2;
  const mergedRoot = doc(merged).ToJSON();
  assert.deepEqual(updateDocumentFields(mergedRoot).Unresolved, []);
  assert.deepEqual(displays(mergedRoot), ["5", "5"]);
});

test("LEFT, RIGHT, BELOW and same-cell ranges follow logical table coordinates", () => {
  const root = doc(
    table([
      [field("= SUM(RIGHT)"), "2", "3"],
      ["4", field("= SUM(BELOW)"), field("= SUM(A2:C2)")],
      ["6", "7", field("= SUM(LEFT)")],
    ]),
  ).ToJSON();
  assert.deepEqual(updateDocumentFields(root).Unresolved, []);
  assert.deepEqual(displays(root), ["5", "7", "11", "13"]);
});

test("cyclic, out-of-range and nonnumeric single-cell dependencies preserve all affected caches", () => {
  const root = doc(
    table([
      [field("= B1", "one"), field("= A1", "two")],
      ["text", field("= A2", "three")],
      [field("= Z99", "four"), "0"],
    ]),
  ).ToJSON();
  const result = updateDocumentFields(root);
  assert.equal(result.Unresolved.length, 4);
  assert.equal(result.Updated, 0);
  assert.deepEqual(displays(root), ["one", "two", "three", "four"]);
});

test("formulas can use explicit numeric variables and bookmarks without a table", () => {
  const root = doc(
    node("Paragraph", [new Run("12 ").ToJSON(), field("= Price * 2 + Rate")]),
  ).ToJSON();
  root.props.DocumentVariables = { Rate: 0.5 };
  root.props.Annotations = [
    {
      Id: "bookmark",
      Kind: "Bookmark",
      Start: 0,
      End: 2,
      Data: { Name: "Price" },
    },
  ];
  assert.deepEqual(updateDocumentFields(root).Unresolved, []);
  assert.deepEqual(displays(root), ["24.5"]);
});

test("formula insertion, field locks, unlinking and document variables use engine history", () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph(""))),
    features = new DocumentFeatures(engine);
  features.SetDocumentVariable("Price", 8);
  const id = features.InsertFormula("Price * 2", "0.00");
  assert.equal(features.UpdateFields().Updated, 1);
  assert.equal(engine.Document.Text, "16.00");
  features.SetFieldLocked(id, true);
  assert.equal(features.UpdateFields({ Variables: { Price: 99 } }).Updated, 0);
  features.UnlinkField(id);
  assert.equal(fields(engine.Document.ToJSON()).length, 0);
  engine.Undo();
  assert.equal(fields(engine.Document.ToJSON())[0].props.Field.Locked, true);
  engine.Undo();
  assert.equal(
    fields(engine.Document.ToJSON())[0].props.Field.Locked,
    undefined,
  );
  assert.equal(features.UpdateFields({ Variables: { Price: 9 } }).Updated, 1);
  assert.equal(engine.Document.Text, "18.00");
  assert.throws(() => features.InsertFormula("globalThis.alert(1)"));
  assert.throws(() => features.SetDocumentVariable("", 1));
});

test("field offset mapping treats equations and floating stories as one main-story atom", () => {
  const equation = new Equation("x"),
    figure = new Figure(new Paragraph("a much longer nested story"));
  const engine = new RichTextEngine(
      new FlowDocument(
        new Paragraph([
          equation,
          figure,
          createFieldFromInstruction("MERGEFIELD Name", "?"),
          new Run(" TARGET"),
        ]),
      ),
    ),
    features = new DocumentFeatures(engine);
  engine.Select(4, 10);
  const mark = engine.AddBookmark("target");
  const before = engine.Document.ToJSON();
  assert.deepEqual(
    features.UpdateFields({ Data: { Name: "expanded" } }).TextChanges,
    [{ Start: 2, RemovedLength: 1, InsertedLength: 8 }],
  );
  const mapped = engine.Annotations.find((a) => a.Id === mark.Id)!;
  assert.equal(engine.Document.Text.slice(mapped.Start, mapped.End), "TARGET");
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
});

test("stable multi-key table sorting preserves rich IDs, headers, bookmarks, selection and history", () => {
  const t = table([
    ["Name", "Score", "Date"],
    ["B", "2", "2026-02-01"],
    ["A", "9", "2026-03-01"],
    ["A", "2", "2026-01-01"],
    ["A", "2", "2026-01-01"],
  ]);
  const engine = new RichTextEngine(doc(t));
  engine.Select(0);
  engine.SetTableHeaderRows(1);
  const blocks = textBlocks(engine.Document.ToJSON()),
    selected = blocks.find((b) => b.text === "B")!;
  const richId = selected.node.children![0].id;
  engine.Select(selected.start, selected.end);
  const mark = engine.AddBookmark("moving");
  const before = engine.Document.ToJSON();
  engine.Execute("SortTable", {
    Keys: [
      { Column: 0 },
      { Column: 1, Type: "Number" },
      { Column: 2, Type: "Date" },
    ],
  });
  const after = engine.Document.ToJSON(),
    rows = buildTableGrid(after.children![0]).rows;
  assert.deepEqual(
    rows.map((row) => (row.children ?? []).map(plainText)),
    [
      ["Name", "Score", "Date"],
      ["A", "2", "2026-01-01"],
      ["A", "2", "2026-01-01"],
      ["A", "9", "2026-03-01"],
      ["B", "2", "2026-02-01"],
    ],
  );
  assert.equal(engine.Selection.Text, "B");
  assert(all(after).some((n) => n.id === richId));
  const mapped = engine.Annotations.find((a) => a.Id === mark.Id)!;
  assert.equal(engine.Document.Text.slice(mapped.Start, mapped.End), "B");
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  engine.Redo();
  assert.deepEqual(engine.Document.ToJSON(), after);
});

test("invalid sort input and vertical merges leave a detached table unchanged", () => {
  const t = table([
      ["A", "2"],
      ["B", "not a number"],
    ]),
    before = structuredClone(t);
  assert.throws(() =>
    sortTableRows(t, { Keys: [{ Column: 1, Type: "Number" }] }),
  );
  assert.deepEqual(t, before);
  assert.throws(() => sortTableRows(t, { Keys: [] }));
  assert.throws(() => sortTableRows(t, { Keys: [{ Column: 99 }] }));
  const merged = table([
    ["A", "2"],
    ["B", "3"],
  ]);
  merged.children![0].children![0].children![0].props.RowSpan = 2;
  merged.children![0].children![1].children!.shift();
  assert.throws(
    () => sortTableRows(merged, { Keys: [{ Column: 1 }] }),
    /merged/,
  );
  const huge = table([["x"]]);
  huge.children![0].children![0].children![0].props.ColumnSpan = 1e9;
  assert.throws(() => buildTableGrid(huge), /10,000/);
});

test("table sorting is a rejectable structural revision", () => {
  const engine = new RichTextEngine(doc(table([["B"], ["A"]])));
  const before = engine.Document.ToJSON();
  engine.TrackChanges = true;
  engine.SortTable({ Keys: [{ Column: 0 }] });
  assert.equal(
    engine.Annotations.filter((a) => a.Kind === "TableStructure").length,
    1,
  );
  assert.equal(engine.Document.Text, "A\nB");
  engine.RejectAllRevisions();
  assert.equal(engine.Document.Text, "B\nA");
  assert.deepEqual(engine.Document.ToJSON().children, before.children);
});

test("captions, number/text/page cross-references and figure indexes are undoable", () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph("Body"))),
    features = new DocumentFeatures(engine);
  engine.Select(4);
  const before = engine.Document.ToJSON(),
    a = features.InsertCaption({ Text: "A figure", NumberFormat: "ROMAN" });
  assert.match(engine.Document.Text, /Body\nFigure I: A figure/);
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  engine.Redo();
  engine.Select(engine.Document.Text.length);
  engine.InsertParagraph();
  features.InsertCrossReference(a.LabelNumberBookmark);
  assert.match(engine.Document.Text, /\nFigure I$/);
  engine.InsertText(" on page ");
  features.InsertCrossReference(
    a.Bookmark,
    { PageNumber: true },
    { PageOfNode: () => 7 },
  );
  assert.match(engine.Document.Text, /Figure I on page 7$/);
  engine.Select(0);
  features.InsertTableOfFigures("Figure", {}, { PageOfNode: () => 7 });
  assert.match(engine.Document.Text, /Table of Figures\nFigure I: A figure\t7/);
  const indexed = engine.Document.ToJSON();
  features.UpdateTableOfContents({ PageOfNode: () => 7 });
  assert.deepEqual(engine.Document.ToJSON(), indexed);
});

test("document statistics count Unicode words and code points, selections and optional notes", () => {
  const document = new FlowDocument([
    new Paragraph("Hello world 😀"),
    new Paragraph("Zażółć gęślą"),
  ]);
  const stats = getDocumentStatistics(document);
  assert.equal(stats.Words, 4);
  assert.equal(
    stats.Characters,
    Array.from("Hello world 😀Zażółć gęślą").length,
  );
  assert.equal(stats.Paragraphs, 2);
  assert.equal(stats.Lines, 2);
  assert.equal(getDocumentStatistics(document, { Start: 6, End: 11 }).Words, 1);
  assert.equal(
    getDocumentStatistics(document, { Start: 0, End: 0 }).Paragraphs,
    0,
  );
  assert.throws(() => getDocumentStatistics(document, { End: 999 }));
  document.SetValue("Footnotes", [
    { Id: "note", Blocks: [new Paragraph("Source note").ToJSON()] },
  ]);
  assert.equal(
    getDocumentStatistics(document, { IncludeNotes: true }).Words,
    6,
  );
  assert.equal(getDocumentStatistics(document).Words, 4);
});

test("native DOCX retains Run field caches, formula codes, locks, variables and scalar properties", async () => {
  const run = new Run("cached");
  run.SetValue("Field", { Instruction: "DOCPROPERTY Title", Locked: true });
  const document = new FlowDocument(
    new Paragraph([
      run,
      new Run(" "),
      createFieldFromInstruction('= SUM(1,2) \\# "0.00"', "3.00"),
    ]),
  );
  document.SetValue("Title", "A & B");
  document.SetValue("Author", "Writer");
  document.SetValue("CreatedAt", "2026-09-19T12:00:00Z");
  document.SetValue("CustomProperties", {
    Price: 12.5,
    Approved: true,
    Customer: "<text>",
  });
  document.SetValue("DocumentVariables", { Name: "Ada & Grace", Rate: 0.5 });
  const bytes = await toDOCX(document),
    zip = await JSZip.loadAsync(bytes);
  assert.equal(zip.file("customXml/richtextweb-review.xml"), null);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /fldLock="true"/);
  assert.match(xml, /cached/);
  assert.match(xml, /= SUM\(1,2\)/);
  const imported = await fromDOCX(bytes);
  assert.equal(imported.Text, "cached 3.00");
  assert.equal(fields(imported.ToJSON())[0].props.Field.Locked, true);
  assert.deepEqual(imported.GetValue("CustomProperties"), {
    Price: 12.5,
    Approved: true,
    Customer: "<text>",
  });
  assert.deepEqual(imported.GetValue("DocumentVariables"), {
    Name: "Ada & Grace",
    Rate: "0.5",
  });
  assert.equal(imported.GetValue("Title"), "A & B");
  assert.equal(imported.GetValue("Author"), "Writer");
  assert.equal(imported.GetValue("CreatedAt"), "2026-09-19T12:00:00.000Z");
});

test("native complex field locks are imported without executing the instruction", async () => {
  const zip = await JSZip.loadAsync(
    await toDOCX(new FlowDocument(new Paragraph(""))),
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin" w:fldLock="1"/></w:r><w:r><w:instrText>= 2+3</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>old</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>',
  );
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(imported.Text, "old");
  assert.equal(fields(imported.ToJSON())[0].props.Field.Locked, true);
  const root = imported.ToJSON();
  assert.equal(updateDocumentFields(root).Updated, 0);
});

test("native DOCX captions and table-of-figures metadata remain editable without a private extension", async () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph(""))),
    features = new DocumentFeatures(engine);
  const caption = features.InsertCaption({ Label: "Table", Text: "Results" });
  engine.Select(engine.Document.Text.length);
  engine.InsertParagraph();
  features.InsertCrossReference(caption.NumberBookmark);
  engine.Select(0);
  features.InsertTableOfFigures("Table");
  const zip = await JSZip.loadAsync(await toDOCX(engine.Document));
  zip.remove("customXml/richtextweb-review.xml");
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /w:pStyle w:val="Caption"/);
  assert.match(xml, /TOC \\c/);
  assert.match(xml, /w:bookmarkStart/);
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(imported.Text, engine.Document.Text);
  assert.equal(
    all(imported.ToJSON()).find((n) => n.props.Caption)?.props.Caption.Label,
    "Table",
  );
  assert.equal(
    all(imported.ToJSON()).find((n) => n.props.TableOfContents)?.props
      .TableOfContents.CaptionLabel,
    "Table",
  );
  const importedFeatures = new DocumentFeatures(new RichTextEngine(imported));
  assert.equal(importedFeatures.UpdateFields().Unresolved.length, 0);
  importedFeatures.UpdateTableOfContents();
  assert.match(imported.Text, /Table of Tables\nTable 1: Results/);
});

test("native DOCX repeat-header rows survive import and numeric positional formulas ignore them", async () => {
  const engine = new RichTextEngine(
    doc(table([["100"], ["2"], [field("= SUM(ABOVE)")]])),
  );
  engine.SetTableHeaderRows(1);
  const bytes = await toDOCX(engine.Document),
    zip = await JSZip.loadAsync(bytes);
  assert.match(
    await zip.file("word/document.xml")!.async("string"),
    /<w:tblHeader\/>/,
  );
  const imported = await fromDOCX(bytes),
    root = imported.ToJSON();
  assert.equal(buildTableGrid(root.children![0]).headerRows.size, 1);
  assert.deepEqual(updateDocumentFields(root).Unresolved, []);
  assert.deepEqual(displays(root), ["2"]);
});

test("field selection, instruction editing and boundary typing keep ordinary text outside caches", () => {
  const engine = new RichTextEngine(
    new FlowDocument(new Paragraph(createFieldFromInstruction("= 2+3", "5"))),
  );
  const features = new DocumentFeatures(engine);
  engine.Select(1);
  const selected = features.GetSelectedField();
  assert(selected);
  features.SetFieldCode(selected.id, "= 20+3");
  features.UpdateFields();
  assert.equal(engine.Selection.Start.Offset, 2);
  engine.InsertText(" outside");
  features.UpdateFields();
  assert.equal(engine.Document.Text, "23 outside");
  assert.equal(fields(engine.Document.ToJSON()).length, 1);
  assert.equal(displays(engine.Document.ToJSON())[0], "23");
  engine.Select(engine.Document.Text.length);
  assert.equal(features.GetSelectedField(), null);
  const before = engine.Document.ToJSON();
  assert.throws(() => features.SetFieldCode(selected.id, "= alert(1)"));
  assert.deepEqual(engine.Document.ToJSON(), before);
});

test("embedded objects separate words but do not increase character counts", () => {
  const document = new FlowDocument(
    new Paragraph([new Run("left"), new Equation("x"), new Run("right")]),
  );
  const stats = getDocumentStatistics(document);
  assert.equal(stats.Words, 2);
  assert.equal(stats.Characters, 9);
});

test("repeat headers partition DOM row groups without losing formatting, rows, IDs or history", () => {
  const t = table([["Heading"], ["A"], ["B"]]);
  t.children![0].props.Foreground = "#123456";
  const rows = buildTableGrid(t).rows.map((r) => r.id);
  const engine = new RichTextEngine(doc(t));
  const before = engine.Document.ToJSON();
  engine.SetTableHeaderRows(1);
  const after = engine.Document.ToJSON().children![0];
  assert.equal(after.children!.length, 2);
  assert.equal(after.children![0].props.IsHeader, true);
  assert.equal(after.children![1].props.IsHeader, false);
  assert.equal(after.children![1].props.Foreground, "#123456");
  assert.deepEqual(
    buildTableGrid(after).rows.map((r) => r.id),
    rows,
  );
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
});
