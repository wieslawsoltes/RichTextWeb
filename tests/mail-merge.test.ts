import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import * as RT from "../src/index.js";
import { plainText } from "../src/engine-tree.js";
import {
  createMailMergeSample,
  mailMergeExampleRecords,
} from "../sample/mail-merge.js";
const {
  createMailMergePlan: plan,
  parseMailMergeDelimited: csv,
  validateMailMergeRecords: records,
  createFieldFromInstruction: field,
  FlowDocument,
  Paragraph,
  Run,
  DocumentFeatures,
  RichTextEngine,
  updateDocumentFields,
  MailMergeSession,
} = RT;
const data = [
  { Name: "Charlie", Team: "B", Amount: "10", Due: "2026-03-01" },
  { Name: "ada", Team: "A", Amount: "2", Due: "2026-01-01" },
  { Name: "Ada", Team: "B", Amount: "2", Due: "2026-02-01" },
  { Name: "Grace", Team: "A", Amount: null, Due: null },
];
const template = () =>
  new FlowDocument(
    new Paragraph([
      field("MERGEFIELD Name", "name"),
      new Run("|"),
      field("MERGEREC", "rec"),
      new Run("|"),
      field("MERGESEQ", "seq"),
    ]),
  );
test("recipient queries are detached and stable with three sort keys", () => {
  const before = structuredClone(data);
  const p = plan(data, {
    Sort: [
      { Field: "Amount", Type: "Number" },
      { Field: "Name" },
      { Field: "Team" },
    ],
  });
  assert.deepEqual(
    p.Recipients.map((r) => r.SourceRecord),
    [2, 3, 1, 4],
  );
  assert.deepEqual(p.Fields, ["Name", "Team", "Amount", "Due"]);
  p.Recipients[0].Data.Name = "modified";
  assert.deepEqual(data, before);
});
test("typed descending sorts keep blank keys last and input order for ties", () => {
  const p = plan(data, {
    Sort: [{ Field: "Amount", Type: "Number", Descending: true }],
  });
  assert.deepEqual(
    p.Recipients.map((r) => r.SourceRecord),
    [1, 2, 3, 4],
  );
});
test("ISO date sorting compares timestamps and rejects rollover dates", () => {
  assert.deepEqual(
    plan(data, { Sort: [{ Field: "Due", Type: "Date" }] }).Recipients.map(
      (r) => r.SourceRecord,
    ),
    [2, 3, 1, 4],
  );
  assert.deepEqual(
    plan(
      [{ Date: "2026-09-01T03:00:00+02:00" }, { Date: "2026-09-01T00:00:00Z" }],
      { Sort: [{ Field: "Date", Type: "Date" }] },
    ).Recipients.map((r) => r.SourceRecord),
    [2, 1],
  );
  for (const v of [
    "2026-02-30",
    "2025-02-29",
    "2026-01-01T00:00",
    "12/31/2026",
  ])
    assert.throws(() =>
      plan([{ Date: v }], { Sort: [{ Field: "Date", Type: "Date" }] }),
    );
});
for (const [op, value, expected] of [
  ["Equal", "2", [2, 3]],
  ["NotEqual", "2", [1, 4]],
  ["Less", "5", [2, 3]],
  ["LessOrEqual", "2", [2, 3]],
  ["Greater", "2", [1]],
  ["GreaterOrEqual", "10", [1]],
  ["Blank", "", [4]],
  ["NotBlank", "", [1, 2, 3]],
] as const)
  test(`typed recipient filter ${op}`, () => {
    assert.deepEqual(
      plan(data, {
        Filters: [
          { Field: "Amount", Operator: op, Type: "Number", Value: value },
        ],
      }).Recipients.map((r) => r.SourceRecord),
      expected,
    );
  });
test("text comparisons are case insensitive by default without removing accents", () => {
  assert.equal(
    plan(data, {
      Filters: [{ Field: "Name", Operator: "Equal", Value: "ADA" }],
    }).Recipients.length,
    2,
  );
  assert.equal(
    plan(data, {
      CaseSensitive: true,
      Filters: [{ Field: "Name", Operator: "Equal", Value: "Ada" }],
    }).Recipients.length,
    1,
  );
  assert.equal(
    plan([{ Name: "café" }], {
      Filters: [{ Field: "Name", Operator: "Equal", Value: "cafe" }],
    }).Recipients.length,
    0,
  );
});
test("contains, not contains and any/all filters share explicit semantics", () => {
  const filters: RT.MailMergeCondition[] = [
    { Field: "Name", Operator: "Contains", Value: "AD" },
    { Field: "Team", Operator: "Equal", Value: "A" },
  ];
  assert.deepEqual(
    plan(data, { Filters: filters }).Recipients.map((r) => r.SourceRecord),
    [2],
  );
  assert.deepEqual(
    plan(data, { Filters: filters, Match: "Any" }).Recipients.map(
      (r) => r.SourceRecord,
    ),
    [2, 3, 4],
  );
  assert.deepEqual(
    plan(data, {
      Filters: [{ Field: "Name", Operator: "NotContains", Value: "AD" }],
    }).Recipients.map((r) => r.SourceRecord),
    [1, 4],
  );
  assert.equal(plan(data, { Filters: [], Match: "Any" }).Recipients.length, 4);
});
test("null, absent and whitespace are blank; zero and false are not", () => {
  const p = plan([{ A: null }, {}, { A: " \t" }, { A: 0 }, { A: false }], {
    Filters: [{ Field: "A", Operator: "Blank" }],
  });
  assert.deepEqual(
    p.Recipients.map((r) => r.SourceRecord),
    [1, 2, 3],
  );
});
test("malformed typed operands cannot hide in a short-circuited filter", () => {
  assert.throws(
    () =>
      plan([{ A: "bad", B: "yes" }], {
        Match: "Any",
        Filters: [
          { Field: "B", Operator: "Equal", Value: "yes" },
          { Field: "A", Operator: "Greater", Type: "Number", Value: 1 },
        ],
      }),
    /numeric/,
  );
});
test("source selection and output range preserve query ordinals and output sequence", () => {
  const p = plan(data, {
    Filters: [{ Field: "Amount", Operator: "NotBlank" }],
    Sort: [{ Field: "Name" }],
    Exclude: [3],
    FirstRecord: 2,
  });
  assert.equal(p.MatchedRecords, 3);
  assert.deepEqual(
    p.Recipients.map(({ SourceRecord, RecordNumber, SequenceNumber }) => [
      SourceRecord,
      RecordNumber,
      SequenceNumber,
    ]),
    [[1, 3, 1]],
  );
  assert.equal(plan(data, { Include: [] }).Recipients.length, 0);
  assert.deepEqual(
    plan(data, { Include: [4, 2], Exclude: [4] }).Recipients.map(
      (r) => r.SourceRecord,
    ),
    [2],
  );
});
test("invalid query schema, ranges, selections and sorts reject before planning", () => {
  for (const options of [
    { Match: "invalid" },
    { Sort: [{ Field: "absent" }] },
    { Filters: [{ Field: "Amount", Operator: "Execute" }] },
    { Sort: [{ Field: "Name", Type: "Object" }] },
    { Sort: Array(4).fill({ Field: "Name" }) },
    { Include: [0] },
    { Exclude: [5] },
    { Include: [2, 2] },
    { Include: [1.5] },
    { FirstRecord: 0 },
    { FirstRecord: 3, LastRecord: 2 },
    { CaseSensitive: "true" },
    { FailOnUnresolved: 1 },
    { Locale: "not_a_locale" },
    { Unknown: true },
    {
      Filters: [
        { Field: "Name", Operator: "Contains", Type: "Number", Value: 2 },
      ],
    },
    { Sort: [{ Field: "Name", Descending: "yes" }] },
  ])
    assert.throws(() => plan(data, options as any));
});
test("recipient records reject non-data values and accessors without invoking them", () => {
  for (const v of [
    null,
    {},
    "data",
    [null],
    [["a"]],
    [{ X: {} }],
    [{ X: NaN }],
    [{ X: Infinity }],
    [{ X: undefined }],
    [{ X: () => 1 }],
    [new Date()],
    [{ "": "value" }],
  ])
    assert.throws(() => records(v));
  let called = false;
  assert.throws(() =>
    records([
      {
        get X() {
          called = true;
          return 42;
        },
      },
    ]),
  );
  assert.equal(called, false);
});
test("recipient special property names remain inert own keys", () => {
  const input = JSON.parse(
    '[{"__proto__":"plain","constructor":"also plain","toString":"text"}]',
  );
  const p = plan(input, {
    Filters: [{ Field: "__proto__", Operator: "Equal", Value: "plain" }],
  });
  assert.equal(Object.getPrototypeOf(p.Recipients[0].Data), null);
  assert.equal(p.Recipients[0].Data.__proto__, "plain");
  assert.equal(({} as any).plain, undefined);
});
test("recipient validation enforces row, field, cell and string budgets", () => {
  assert.throws(() => records(Array(10001).fill({ A: 1 })));
  assert.throws(() => records([{ A: "x".repeat(65537) }]));
  assert.throws(() =>
    records([
      Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`f${i}`, 1])),
    ]),
  );
  assert.throws(() =>
    records(
      Array(1000).fill(
        Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, 1])),
      ),
    ),
  );
  assert.throws(() => csv("x".repeat(4000001)));
});
test("CSV preserves quoted delimiters, escaped quotes, multiline values and strings", () => {
  const rows = csv(
    '\ufeff Name ,Code,Note\r\nAda,001,"a,b"\r\nGrace,002,"a ""quote""\r\nline"\r\n',
  );
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { Name: "Ada", Code: "001", Note: "a,b" },
      { Name: "Grace", Code: "002", Note: 'a "quote"\r\nline' },
    ],
  );
});
test("CSV distinguishes terminal blank rows, empty values and trailing delimiters", () => {
  assert.deepEqual(
    csv("A,B\nx,\n").map((r) => ({ ...r })),
    [{ A: "x", B: "" }],
  );
  assert.equal(csv("A\n").length, 0);
  assert.equal(csv("A\n\n").length, 1);
  assert.equal(csv('A\n""')[0].A, "");
  assert.equal(csv("").length, 0);
});
test("TSV and semicolon formats keep spreadsheet-like strings inert", () => {
  assert.equal(csv("A\tB\n=SUM(1)\t2", "\t")[0].A, "=SUM(1)");
  assert.equal(csv('A;B\n"x;y";2', ";")[0].A, "x;y");
});
for (const source of [
  "A,A\nx,y",
  "A,\nx,y",
  "A,B\nx",
  'A\n"unclosed',
  'A\na"b',
  'A\n"a"tail',
  'A\n"a" "b"',
])
  test(`malformed recipient CSV is rejected: ${JSON.stringify(source)}`, () =>
    assert.throws(() => csv(source)));
test("CSV prototype-like headers are safe and empty header files validate names", () => {
  assert.equal(csv("__proto__,Name\nsafe,Ada")[0].__proto__, "safe");
  assert.throws(() => csv("A\u0000\n"));
});
test("mail merge sessions snapshot input, options, clock and template without live edits", () => {
  const doc = template(),
    engine = new RichTextEngine(doc),
    before = doc.ToJSON(),
    source = [{ Name: "Ada" }, { Name: "Grace" }];
  engine.Select(2);
  const session = new DocumentFeatures(engine).CreateMailMergeSession(source);
  source[0].Name = "changed";
  doc.Title = "live edit";
  const p = session.Preview();
  assert.equal(p.Document.Text, "Ada|1|1");
  assert.equal(p.Document.Title, before.props.Title);
  p.Document.Title = "preview edit";
  p.Recipient.Data.Name = "other";
  const planCopy = session.Plan;
  planCopy.Recipients[0].Data.Name = "plan edit";
  assert.equal(session.Preview().Document.Text, "Ada|1|1");
  assert.equal(session.Generate()[1].Text, "Grace|2|2");
  assert.equal(engine.Selection.Start.Offset, 2);
  assert.equal(engine.CanUndo, false);
});
test("MERGEREC follows query order and MERGESEQ follows selected output order", () => {
  const session = new MailMergeSession(template(), data, {
    Sort: [{ Field: "Name" }],
    Exclude: [3],
    FirstRecord: 2,
  });
  assert.equal(session.Count, 2);
  assert.deepEqual(
    session.Generate().map((d) => d.Text),
    ["Charlie|3|1", "Grace|4|2"],
  );
});
test("legacy MailMerge returns independent documents with the new optional query argument", () => {
  const engine = new RichTextEngine(template()),
    before = engine.Document.ToJSON();
  const output = new DocumentFeatures(engine).MailMerge(
    data,
    {},
    { Include: [1, 4] },
  );
  assert.deepEqual(
    output.map((d) => d.Text),
    ["Charlie|1|1", "Grace|4|2"],
  );
  output[0].Title = "first";
  assert.notEqual(output[1].Title, "first");
  assert.deepEqual(engine.Document.ToJSON(), before);
});
test("preview reports unresolved fields while strict generation fails without partial live edits", () => {
  const engine = new RichTextEngine(template()),
    before = engine.Document.ToJSON();
  const session = new DocumentFeatures(engine).CreateMailMergeSession(
    [{ Name: "Ada" }, {}],
    { FailOnUnresolved: true },
  );
  assert.equal(session.Preview(2).Fields.Unresolved.length, 1);
  assert.throws(() => session.Generate(), /Recipient 2/);
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.CanUndo, false);
  assert.equal(
    new MailMergeSession(template(), [{}]).Generate()[0].Text,
    "name|1|1",
  );
});
test("empty selections and invalid preview indices never generate a made-up recipient", () => {
  const session = new MailMergeSession(template(), data, { Include: [] });
  assert.equal(session.Count, 0);
  assert.deepEqual(session.Generate(), []);
  for (const n of [0, 1, -1, NaN]) assert.throws(() => session.Preview(n));
});
test("generation has a hard output budget while individual previews still work", () => {
  const session = new MailMergeSession(
    template(),
    Array.from({ length: 1001 }, () => ({ Name: "A" })),
  );
  assert.equal(session.Preview(1001).Document.Text, "A|1001|1001");
  assert.throws(() => session.Generate(), /budget/);
});
test("session clock and context variables do not drift after construction", () => {
  const now = new Date("2026-09-20T12:00:00Z"),
    variables = { V: "a" };
  const doc = new FlowDocument(
    new Paragraph([
      field('TIME \\@ "HH:mm:ss"'),
      new Run("|"),
      field("DOCVARIABLE V"),
    ]),
  );
  const session = new MailMergeSession(
    doc,
    [{}],
    {},
    { Now: now, Variables: variables },
  );
  now.setUTCFullYear(2000);
  now.setUTCHours(23);
  variables.V = "b";
  assert.equal(session.Preview().Document.Text, "12:00:00|a");
});
test("current dependencies are the merge default and explicit Snapshot remains available", () => {
  const name = field("MERGEFIELD Name", "old"),
    ref = field(`REF ${name.Id}`, "ref");
  const doc = new FlowDocument(new Paragraph([ref, new Run("|"), name]));
  assert.equal(
    new MailMergeSession(doc, [{ Name: "new" }]).Generate()[0].Text,
    "new|new",
  );
  assert.equal(
    new MailMergeSession(
      doc,
      [{ Name: "new" }],
      {},
      { ReferenceMode: "Snapshot" },
    ).Generate()[0].Text,
    "old|new",
  );
});
test("merge numbering requires valid explicit context outside a merge", () => {
  const root = template().ToJSON();
  assert.equal(
    updateDocumentFields(root, { Data: { Name: "Ada" } }).Unresolved.length,
    2,
  );
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    const r = template().ToJSON();
    assert.equal(
      updateDocumentFields(r, {
        Data: { Name: "Ada" },
        MergeRecord: value,
        MergeSequence: value,
      }).Unresolved.length,
      2,
    );
  }
});
for (const [value, expected] of [
  ["Ada", "(ADA)!"],
  ["", ""],
  [null, ""],
  [0, "(0)!"],
  [false, "(FALSE)!"],
] as const)
  test(`merge prefixes/suffixes distinguish empty values from ${String(value)}`, () => {
    const root = new FlowDocument(
      new Paragraph(
        field('MERGEFIELD Name \\b "(" \\f ")!" \\* Upper', "cache"),
      ),
    ).ToJSON();
    const result = updateDocumentFields(root, { Data: { Name: value } });
    assert.deepEqual(result.Unresolved, []);
    assert.equal(plainText(root), expected);
  });
test("blank numeric merge values skip numeric pictures but missing fields stay diagnostic", () => {
  for (const value of ["", null]) {
    const root = new FlowDocument(
      new Paragraph(field('MERGEFIELD A \\# "0.00" \\b "$"', "cache")),
    ).ToJSON();
    assert.deepEqual(
      updateDocumentFields(root, { Data: { A: value } }).Unresolved,
      [],
    );
    assert.equal(plainText(root), "");
  }
  const root = new FlowDocument(
    new Paragraph(field('MERGEFIELD A \\b "$"', "cache")),
  ).ToJSON();
  assert.equal(updateDocumentFields(root, { Data: {} }).Unresolved.length, 1);
  assert.equal(plainText(root), "cache");
});
test("unsupported mapped merge fields and malformed prefix switches retain cache", () => {
  for (const code of [
    "MERGEFIELD A \\m",
    "MERGEFIELD A \\v",
    "MERGEFIELD A \\b",
    "MERGEFIELD A \\f one two",
    "MERGEREC extra",
  ]) {
    const root = new FlowDocument(new Paragraph(field(code, "cache"))).ToJSON();
    assert.equal(
      updateDocumentFields(root, { Data: { A: "new" } }).Unresolved.length,
      1,
    );
    assert.equal(plainText(root), "cache");
  }
});
test("native DOCX retains merge numbering, affixes and recalculates without private metadata", async () => {
  const doc = new FlowDocument(
    new Paragraph([
      field('MERGEFIELD Name \\b "Dear " \\f ","', "cache"),
      new Run("|"),
      field("MERGEREC", "R"),
      new Run("|"),
      field("MERGESEQ", "S"),
    ]),
  );
  const zip = await JSZip.loadAsync(await RT.toDOCX(doc));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /MERGEREC/);
  assert.match(xml, /MERGESEQ/);
  assert.match(xml, /\\b/);
  zip.remove("customXml/richtextweb-review.xml");
  const imported = await RT.fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const session = new MailMergeSession(
    imported,
    [{ Name: "Ada" }, { Name: "Grace" }],
    { Include: [2], FailOnUnresolved: true },
  );
  assert.equal(session.Generate()[0].Text, "Dear Grace,|2|1");
});
test("table formula location and grid caches are independent when body/header ids coincide", () => {
  const doc = RT.fromHTML("<table><tr><td>3</td><td>X</td></tr></table>");
  const engine = new RichTextEngine(doc),
    features = new DocumentFeatures(engine);
  engine.Select(2, 3);
  features.InsertFormula("SUM(LEFT)");
  const root = doc.ToJSON(),
    header = structuredClone(root.children![0]);
  const runs = (node: RT.DocumentNode): RT.DocumentNode[] => [
    node,
    ...(node.children ?? []).flatMap(runs),
  ];
  const source = runs(header).find((n) => n.type === "Run" && n.text === "3")!;
  source.text = "8";
  root.props.Headers = [header];
  assert.deepEqual(updateDocumentFields(root).Unresolved, []);
  assert.equal(plainText(root), "3\n3");
  assert.equal(plainText(header), "8\n8");
});
test("the actual invitation sample filters, sorts, previews and merges with resolved fields", async () => {
  const doc = createMailMergeSample(RT),
    before = doc.ToJSON();
  const options: RT.MailMergeOptions = {
    Filters: [{ Field: "Team", Operator: "Equal", Value: "Research" }],
    Sort: [{ Field: "Amount", Type: "Number", Descending: true }],
    Exclude: [1],
    FailOnUnresolved: true,
  };
  const session = new MailMergeSession(doc, mailMergeExampleRecords, options);
  assert.equal(session.Count, 2);
  assert.match(session.Preview().Document.Text, /Dear Katherine,/);
  assert.match(session.Preview().Document.Text, /\$420\.00/);
  assert.match(session.Preview(2).Document.Text, /Query record 3 · Output 2/);
  assert.match(session.Preview(2).Document.Text, /starter project pack/);
  const zip = await JSZip.loadAsync(await RT.toDOCX(doc));
  zip.remove("customXml/richtextweb-review.xml");
  const imported = await RT.fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.deepEqual(
    new MailMergeSession(imported, mailMergeExampleRecords, options)
      .Generate()
      .map((d) => d.Text),
    session.Generate().map((d) => d.Text),
  );
  assert.deepEqual(doc.ToJSON(), before);
});

test("sparse recipient/query arrays and array accessors are rejected without invoking them", () => {
  let invoked = false;
  const values = Object.defineProperty([], "0", {
    get() {
      invoked = true;
      return {};
    },
  });
  assert.throws(() => records(values), /own data/);
  assert.equal(invoked, false);
  assert.throws(() => records(new Array(2)), /own data/);
  assert.throws(() => plan([{ A: 1 }], { Filters: new Array(1) }), /own data/);
  assert.throws(() => plan([{ A: 1 }], { Include: new Array(1) }), /selection/);
});
test("query option and key accessors are rejected and unknown keys are not ignored", () => {
  let invoked = false;
  assert.throws(
    () =>
      plan([{ A: 1 }], {
        get Locale() {
          invoked = true;
          return "en";
        },
      }),
    /accessors/,
  );
  assert.throws(
    () =>
      plan([{ A: 1 }], {
        Sort: [
          {
            get Field() {
              invoked = true;
              return "A";
            },
          },
        ],
      }),
    /accessors/,
  );
  assert.equal(invoked, false);
  assert.throws(
    () => plan([{ A: 1 }], { Sort: [{ Field: "A", descending: true } as any] }),
    /Unknown query/,
  );
});
test("ISO 24-hour rollover is not accepted as a recipient clock time", () => {
  assert.throws(
    () =>
      plan([{ A: "2026-10-01T24:00:00Z" }], {
        Sort: [{ Field: "A", Type: "Date" }],
      }),
    /clock/,
  );
});
