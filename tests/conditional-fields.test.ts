import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { FlowDocument, Paragraph } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  DocumentFeatures,
  createFieldFromInstruction as field,
} from "../src/document-features.js";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";

const current = { ReferenceMode: "Current" as const };
function fixture() {
  const condition = field(
    'IF BudgetAmount >= EstimateTotal "Within budget" "Review estimate"',
    "pending",
  );
  const budget = field('DOCVARIABLE Budget \\# "0.00"', "0"),
    cost = field('DOCVARIABLE Cost \\# "0.00"', "0");
  const engine = new RichTextEngine(
    new FlowDocument([
      new Paragraph(condition),
      new Paragraph(budget),
      new Paragraph(cost),
    ]),
  );
  for (const [target, name] of [
    [budget, "BudgetAmount"],
    [cost, "EstimateTotal"],
  ] as const) {
    engine.Select(target.ContentStart.Offset, target.ContentEnd.Offset);
    engine.AddBookmark(name);
  }
  return {
    engine,
    features: new DocumentFeatures(engine),
    condition,
    budget,
    cost,
  };
}

test("IF compares current forward bookmark dependencies with exact undo/redo", () => {
  const { engine, features } = fixture();
  features.UpdateFields({ ...current, Variables: { Budget: 500, Cost: 420 } });
  assert.equal(engine.Document.Text, "Within budget\n500.00\n420.00");
  const before = engine.Document.ToJSON();
  const result = features.UpdateFields({
    ...current,
    Variables: { Budget: 500, Cost: 570 },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(engine.Document.Text, "Review estimate\n500.00\n570.00");
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  engine.Redo();
  assert.equal(engine.Document.Text, "Review estimate\n500.00\n570.00");
  engine.Dispose();
});

test("IF bookmark operands preserve snapshot mode", () => {
  const { engine, features } = fixture();
  features.UpdateFields({ ...current, Variables: { Budget: 500, Cost: 420 } });
  features.UpdateFields({ Variables: { Budget: 500, Cost: 570 } });
  assert.equal(engine.Document.Text, "Within budget\n500.00\n570.00");
  features.UpdateFields({ ...current, Variables: { Budget: 500, Cost: 570 } });
  assert.equal(engine.Document.Text, "Review estimate\n500.00\n570.00");
  engine.Dispose();
});

test("quoted IF operands are literal while unquoted names resolve bookmark text", () => {
  const source = field("DOCVARIABLE State", "old");
  const e = new RichTextEngine(
    new FlowDocument([
      new Paragraph(field('IF Status = "approved" "yes" "no"', "?")),
      new Paragraph(field('IF "Status" = "approved" "yes" "no"', "?")),
      new Paragraph(source),
    ]),
  );
  e.Select(source.ContentStart.Offset, source.ContentEnd.Offset);
  e.AddBookmark("Status");
  const result = new DocumentFeatures(e).UpdateFields({
    ...current,
    Variables: { State: "approved" },
  });
  assert.deepEqual(result.Unresolved, []);
  assert.equal(e.Document.Text, "yes\nno\napproved");
  e.Dispose();
});

for (const [comparison, expected] of [
  ["2 > 1", "yes"],
  ["1 > 2", ""],
])
  test(`IF permits omitted false text: ${comparison}`, () => {
    const e = new RichTextEngine(
      new FlowDocument(new Paragraph(field(`IF ${comparison} "yes"`, "old"))),
    );
    assert.deepEqual(
      new DocumentFeatures(e).UpdateFields(current).Unresolved,
      [],
    );
    assert.equal(e.Document.Text, expected);
    e.Dispose();
  });

test("IF self bookmark dependencies preserve caches with cycle diagnostics", () => {
  const condition = field('IF Self = "ok" "yes" "no"', "old");
  const e = new RichTextEngine(new FlowDocument(new Paragraph(condition)));
  e.Select(0, 3);
  e.AddBookmark("Self");
  const result = new DocumentFeatures(e).UpdateFields(current);
  assert.equal(e.Document.Text, "old");
  assert(result.Unresolved.some((x) => /Circular/.test(x.Reason)));
  e.Dispose();
});

test("IF retains affected cache on missing data, but permits locked bookmark dependencies", () => {
  const { engine, features, budget, condition } = fixture();
  features.UpdateFields({ ...current, Variables: { Budget: 500, Cost: 420 } });
  const failed = features.UpdateFields({
    ...current,
    Variables: { Cost: 570 },
  });
  assert(failed.Unresolved.some((x) => x.Id === condition.Id));
  assert.equal(engine.Document.Text, "Within budget\n500.00\n570.00");
  features.SetFieldLocked(budget.Id, true);
  assert.deepEqual(
    features.UpdateFields({ ...current, Variables: { Cost: 570 } }).Unresolved,
    [],
  );
  assert.equal(engine.Document.Text, "Review estimate\n500.00\n570.00");
  engine.Dispose();
});

test("native IF bookmark comparisons recalculate after DOCX without private metadata", async () => {
  const { engine, features } = fixture();
  features.SetDocumentVariable("Budget", 500);
  features.SetDocumentVariable("Cost", 420);
  features.UpdateFields(current);
  const zip = await JSZip.loadAsync(await toDOCX(engine.Document));
  assert.match(
    await zip.file("word/document.xml")!.async("string"),
    /IF BudgetAmount &gt;= EstimateTotal/,
  );
  zip.remove("customXml/richtextweb-review.xml");
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const other = new RichTextEngine(imported),
    f = new DocumentFeatures(other);
  f.SetDocumentVariable("Cost", 570);
  assert.deepEqual(f.UpdateFields(current).Unresolved, []);
  assert.equal(imported.Text, "Review estimate\n500.00\n570.00");
  other.Undo();
  assert.equal(imported.Text, "Within budget\n500.00\n420.00");
  engine.Dispose();
  other.Dispose();
});
