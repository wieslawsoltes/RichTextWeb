import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, Paragraph, Run, Span, Figure } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import { RichTextBox } from "../src/control.js";
import {
  DocumentFeatures,
  createFieldFromInstruction as field,
  updateDocumentFields,
} from "../src/document-features.js";
import JSZip from "jszip";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";
import { plainText } from "../src/engine-tree.js";

const current = { ReferenceMode: "Current" as const };
const code = (node: Span, instruction: string) =>
  node.SetValue("Field", { Type: "REF", Instruction: instruction });

test("current references resolve forward chains before committing any field caches", () => {
  const source = field("DOCVARIABLE Value", "old"),
    middle = field(`REF ${source.Id}`, "stale"),
    first = field(`REF ${middle.Id}`, "?");
  const engine = new RichTextEngine(
    new FlowDocument(
      new Paragraph([first, new Run("|"), middle, new Run("|"), source]),
    ),
  );
  const features = new DocumentFeatures(engine),
    before = engine.Document.ToJSON();
  engine.Select(engine.Document.Text.length);
  const result = features.UpdateFields({
    ...current,
    Variables: { Value: "expanded" },
  });
  assert.equal(engine.Document.Text, "expanded|expanded|expanded");
  assert.equal(result.Updated, 3);
  assert.deepEqual(result.Unresolved, []);
  assert.equal(engine.Selection.Start.Offset, engine.Document.Text.length);
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  engine.Redo();
  assert.equal(engine.Document.Text, "expanded|expanded|expanded");
  const revision = engine.Document.Revision;
  assert.equal(
    features.UpdateFields({ ...current, Variables: { Value: "expanded" } })
      .Updated,
    0,
  );
  assert.equal(engine.Document.Revision, revision);
});

test("Snapshot remains the default for headless callers and can be requested explicitly", () => {
  const source = field("DOCVARIABLE Value", "old"),
    reference = field(`REF ${source.Id}`, "?");
  const doc = new FlowDocument(
    new Paragraph([source, new Run("|"), reference]),
  );
  for (const options of [{}, { ReferenceMode: "Snapshot" as const }]) {
    const root = doc.ToJSON();
    updateDocumentFields(root, { ...options, Variables: { Value: "new" } });
    assert.equal(plainText(root), "new|old");
  }
});

test("bookmark references to recalculated caption sequences update once with exact annotation mapping", () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph("Intro"))),
    features = new DocumentFeatures(engine);
  engine.Select(5);
  const caption = features.InsertCaption({ Label: "Figure", Text: "Diagram" });
  const sequence = engine.Document.ToJSON()
    .children!.flatMap((n) => n.children ?? [])
    .find((n) => n.props.Caption)
    ?.children?.find((n) => n.props.Field);
  assert(sequence);
  engine.Select(engine.Document.Text.length);
  engine.InsertParagraph();
  features.InsertCrossReference(caption.LabelNumberBookmark);
  features.SetFieldCode(sequence.id, "SEQ Figure \\r 10");
  const result = features.UpdateFields(current);
  assert.deepEqual(result.Unresolved, []);
  assert.match(engine.Document.Text, /Figure 10: Diagram\nFigure 10$/);
  for (const [name, expected] of [
    [caption.NumberBookmark, "10"],
    [caption.LabelNumberBookmark, "Figure 10"],
    [caption.Bookmark, "Figure 10: Diagram"],
  ]) {
    const mark = engine.Annotations.find((a) => a.Data.Name === name)!;
    assert.equal(engine.Document.Text.slice(mark.Start, mark.End), expected);
  }
});

test("formula operands consume current bookmarked fields even for forward dependencies", () => {
  const source = field("= 6*7", "0"),
    formula = field("= Amount+8", "?");
  const engine = new RichTextEngine(
      new FlowDocument(new Paragraph([formula, new Run("|"), source])),
    ),
    features = new DocumentFeatures(engine);
  engine.Select(2, 3);
  engine.AddBookmark("Amount");
  assert.deepEqual(features.UpdateFields(current).Unresolved, []);
  assert.equal(engine.Document.Text, "50|42");
});

test("references may cover several complete fields, intervening text and paragraph breaks", () => {
  const a = field("DOCVARIABLE A", "a"),
    b = field("DOCVARIABLE B", "b"),
    r = field("REF both", "?");
  const e = new RichTextEngine(
    new FlowDocument([
      new Paragraph([a, new Run("!")]),
      new Paragraph([b]),
      new Paragraph([r]),
    ]),
  );
  e.Select(0, 4);
  e.AddBookmark("both");
  const result = new DocumentFeatures(e).UpdateFields({
    ...current,
    Variables: { A: "Alpha", B: "Beta" },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(e.Document.Text, "Alpha!\nBeta\nAlpha!\nBeta");
});

test("cyclic references retain affected caches while independent fields update", () => {
  const a = field("REF pending", "a"),
    b = field(`REF ${a.Id}`, "b"),
    c = field("= 2+3", "c");
  code(a, `REF ${b.Id}`);
  const root = new FlowDocument(
    new Paragraph([a, new Run("|"), b, new Run("|"), c]),
  ).ToJSON();
  const result = updateDocumentFields(root, current);
  assert.equal(plainText(root), "a|b|5");
  assert.equal(result.Updated, 1);
  assert.equal(result.Unresolved.length, 2);
  assert(result.Unresolved.some((x) => /Circular/.test(x.Reason)));
});

test("a self-referential bookmark is diagnosed rather than expanding on each update", () => {
  const e = new RichTextEngine(
    new FlowDocument(new Paragraph([field("REF self", "cache")])),
  );
  e.Select(0, 5);
  e.AddBookmark("self");
  const f = new DocumentFeatures(e),
    before = e.Document.ToJSON();
  assert.equal(f.UpdateFields(current).Unresolved.length, 1);
  assert.deepEqual(e.Document.ToJSON(), before);
});

test("locked dependencies supply their cached value and break reference cycles", () => {
  const a = field("REF pending", "a"),
    b = field(`REF ${a.Id}`, "locked");
  code(a, `REF ${b.Id}`);
  b.SetValue("Field", { ...b.GetValue("Field"), Locked: true });
  const root = new FlowDocument(new Paragraph([a, new Run("|"), b])).ToJSON();
  assert.deepEqual(updateDocumentFields(root, current).Unresolved, []);
  assert.equal(plainText(root), "locked|locked");
});

test("unresolved dependencies do not publish stale cached values as current results", () => {
  const missing = field("DOCVARIABLE Absent", "old"),
    reference = field(`REF ${missing.Id}`, "keep");
  const root = new FlowDocument(
    new Paragraph([reference, new Run("|"), missing]),
  ).ToJSON();
  const result = updateDocumentFields(root, current);
  assert.equal(result.Unresolved.length, 2);
  assert.equal(plainText(root), "keep|old");
});

test("partial-field bookmarks are diagnosed and retain the reference cache", () => {
  const e = new RichTextEngine(
    new FlowDocument(
      new Paragraph([
        field("DOCVARIABLE Value", "old"),
        new Run("|"),
        field("REF partial", "keep"),
      ]),
    ),
  );
  e.Select(1, 2);
  e.AddBookmark("partial");
  const result = new DocumentFeatures(e).UpdateFields({
    ...current,
    Variables: { Value: "expanded" },
  });
  assert.equal(e.Document.Text, "expanded|keep");
  assert.equal(result.Unresolved.length, 1);
  assert.match(result.Unresolved[0].Reason, /partly overlaps/);
});

test("reference snapshots keep floating stories atomic in the main story", () => {
  const figure = new Figure(new Paragraph("independent"));
  const source = field("DOCVARIABLE Value", "old");
  const e = new RichTextEngine(
    new FlowDocument(
      new Paragraph([figure, source, new Run("|"), field("REF target", "?")]),
    ),
  );
  e.Select(0, 4);
  e.AddBookmark("target");
  assert.deepEqual(
    new DocumentFeatures(e).UpdateFields({
      ...current,
      Variables: { Value: "new" },
    }).Unresolved,
    [],
  );
  assert.equal(e.Document.Text, "\uFFFCnew|\uFFFCnew");
});

test("references to independent story nodes read their pending values without body-offset remapping", () => {
  const source = field("DOCVARIABLE Value", "old"),
    reference = field(`REF ${source.Id}`, "?");
  const e = new RichTextEngine(new FlowDocument(new Paragraph([reference])));
  const f = new DocumentFeatures(e);
  f.SetStory("Headers", [new Paragraph(source).ToJSON()]);
  const result = f.UpdateFields({
    ...current,
    Variables: { Value: "header value" },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(e.Document.Text, "header value");
  assert.equal(result.TextChanges.length, 1);
});

test("explicit container targets retain paragraph separators and resolve child fields", () => {
  const source = new FlowDocument([
    new Paragraph(field("= 20+1", "?")),
    new Paragraph("done"),
  ]).ToJSON();
  const reference = field(`REF ${source.id}`, "?").ToJSON();
  const root = new FlowDocument(new Paragraph("body")).ToJSON();
  root.props.Headers = [source];
  root.children![0].children = [reference];
  assert.deepEqual(updateDocumentFields(root, current).Unresolved, []);
  assert.equal(plainText(root), "21\ndone");
});

test("dependency depth and text expansion have explicit bounded diagnostics", () => {
  const nodes = [field("DOCVARIABLE Value", "x")];
  for (let i = 0; i < 70; i++)
    nodes.push(field(`REF ${nodes.at(-1)!.Id}`, "?"));
  const root = new FlowDocument(new Paragraph(nodes.toReversed())).ToJSON();
  const result = updateDocumentFields(root, {
    ...current,
    Variables: { Value: "end" },
  });
  assert(result.Unresolved.some((x) => /depth|dependency/.test(x.Reason)));
  const large = field("DOCVARIABLE Large", "old"),
    ref = field(`REF ${large.Id}`, "keep");
  const huge = new FlowDocument(new Paragraph([ref, large])).ToJSON();
  const bounded = updateDocumentFields(huge, {
    ...current,
    Variables: { Large: "x".repeat(1_000_001) },
  });
  assert(bounded.Unresolved.some((x) => /budget/.test(x.Reason)));
  assert.equal(huge.children![0].children![0].children![0].text, "keep");
});

test("invalid reference mode rejects before any field cache changes", () => {
  const root = new FlowDocument(new Paragraph(field("= 2+3", "old"))).ToJSON();
  const before = structuredClone(root);
  assert.throws(
    () => updateDocumentFields(root, { ReferenceMode: "bad" as any }),
    /ReferenceMode/,
  );
  assert.deepEqual(root, before);
});

test("reusable control updates dependencies by default, permits snapshot mode and respects readonly", () => {
  const source = field("DOCVARIABLE Value", "old"),
    ref = field(`REF ${source.Id}`, "?");
  const editor = new RichTextBox();
  editor.Document = new FlowDocument(
    new Paragraph([source, new Run("|"), ref]),
  );
  editor.UpdateFields({ Variables: { Value: "new" } });
  assert.equal(editor.Document.Text, "new|new");
  editor.UpdateFields({
    ReferenceMode: "Snapshot",
    Variables: { Value: "next" },
  });
  assert.equal(editor.Document.Text, "next|new");
  editor.IsReadOnly = true;
  assert.equal(editor.UpdateFields({ Variables: { Value: "blocked" } }), false);
  assert.equal(editor.Document.Text, "next|new");
  editor.Dispose();
});

test("empty cached fields at bookmark edges respect annotation affinity", () => {
  const a = field("DOCVARIABLE A", ""),
    b = field("DOCVARIABLE B", "");
  const e = new RichTextEngine(
    new FlowDocument(
      new Paragraph([
        a,
        new Run("body"),
        b,
        new Run("|"),
        field("REF target", "?"),
      ]),
    ),
  );
  e.Select(0, 4);
  e.AddBookmark("target");
  const result = new DocumentFeatures(e).UpdateFields({
    ...current,
    Variables: { A: "before", B: "after" },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(e.Document.Text, "beforebodyafter|body");
  const mark = e.Annotations.find((a) => a.Data.Name === "target")!;
  assert.equal(e.Document.Text.slice(mark.Start, mark.End), "body");
});

test("caption bookmarks exclude subsequent paragraphs but include appended caption text", () => {
  const e = new RichTextEngine(new FlowDocument(new Paragraph("Start"))),
    f = new DocumentFeatures(e);
  e.Select(e.Document.Text.length);
  const caption = f.InsertCaption({ Text: "Original" });
  e.Select(e.Document.Text.length);
  e.InsertText(" extended");
  const target = () =>
    e.Annotations.find((a) => a.Data.Name === caption.Bookmark)!;
  assert.equal(
    e.Document.Text.slice(target().Start, target().End),
    "Figure 1: Original extended",
  );
  e.InsertText("\nFollowing text");
  assert.equal(
    e.Document.Text.slice(target().Start, target().End),
    "Figure 1: Original extended",
  );
  const before = e.Document.ToJSON();
  e.Undo();
  e.Redo();
  assert.deepEqual(e.Document.ToJSON(), before);
  e.Select(e.Document.Text.length);
  e.InsertParagraph();
  f.InsertCrossReference(caption.Bookmark, {}, current);
  assert.equal(f.UpdateFields(current).Unresolved.length, 0);
  assert.match(e.Document.Text, /Following text\nFigure 1: Original extended$/);
});

test("native DOCX bookmark dependencies recalculate without private metadata", async () => {
  const e = new RichTextEngine(
    new FlowDocument(
      new Paragraph([
        field("REF Amount", "stale"),
        new Run("|"),
        field("= 6*7", "0"),
      ]),
    ),
  );
  e.Select(6, 7);
  e.AddBookmark("Amount");
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  zip.remove("customXml/richtextweb-review.xml");
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const features = new DocumentFeatures(new RichTextEngine(imported));
  assert.deepEqual(features.UpdateFields(current).Unresolved, []);
  assert.equal(imported.Text, "42|42");
  features.Engine.Undo();
  assert.equal(imported.Text, "stale|0");
});

test("whole result-node targets use pending values; partial result nodes are diagnosed", () => {
  const source = field("DOCVARIABLE Value", "old");
  const full = field(`REF ${source.Inlines.Get(0).Id}`, "?");
  const root = new FlowDocument(
    new Paragraph([full, new Run("|"), source]),
  ).ToJSON();
  assert.deepEqual(
    updateDocumentFields(root, { ...current, Variables: { Value: "new" } })
      .Unresolved,
    [],
  );
  assert.equal(plainText(root), "new|new");
  const multi = field("DOCVARIABLE Value", "old");
  multi.Inlines.Add(new Run(" tail"));
  const partial = field(`REF ${multi.Inlines.Get(0).Id}`, "keep");
  const second = new FlowDocument(
    new Paragraph([partial, new Run("|"), multi]),
  ).ToJSON();
  assert.equal(
    updateDocumentFields(second, { ...current, Variables: { Value: "new" } })
      .Unresolved.length,
    1,
  );
  assert.equal(plainText(second), "keep|new");
});

test("independent stories may reuse detached field ids without sharing evaluation caches", () => {
  const source = field("DOCVARIABLE Body", "old"),
    header = field("DOCVARIABLE Header", "old").ToJSON();
  header.id = source.Id;
  const root = new FlowDocument(new Paragraph([source])).ToJSON();
  root.props.Headers = [
    { type: "Paragraph", id: "header", props: {}, children: [header] },
  ];
  const result = updateDocumentFields(root, {
    ...current,
    Variables: { Body: "body result", Header: "header result" },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(plainText(root), "body result");
  assert.equal(header.children![0].text, "header result");
  assert.equal(result.TextChanges.length, 1);
});

test("ambiguous cross-story node references are diagnosed instead of choosing a story", () => {
  const source = field("= 2+3", "body"),
    header = field("= 3+4", "header").ToJSON();
  header.id = source.Id;
  const root = new FlowDocument(
    new Paragraph([field(`REF ${source.Id}`, "keep"), new Run("|"), source]),
  ).ToJSON();
  root.props.Headers = [
    { type: "Paragraph", id: "header", props: {}, children: [header] },
  ];
  const result = updateDocumentFields(root, current);
  assert.equal(result.Unresolved.length, 1);
  assert.match(result.Unresolved[0].Reason, /Ambiguous/);
  assert.equal(plainText(root), "keep|5");
  assert.equal(header.children![0].text, "7");
});
