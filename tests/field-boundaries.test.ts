import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  DocumentFeatures,
  createField,
  createFieldFromInstruction,
} from "../src/document-features.js";

for (const [start, end, expectedStart, expectedEnd] of [
  [0, 0, 0, 0],
  [1, 1, 1, 1], // Leading field boundary remains before the replacement.
  [2, 2, 9, 9],
  [4, 4, 9, 9],
  [5, 5, 10, 10],
  [1, 4, 1, 9],
  [0, 1, 0, 1], // A range ending before a field must not include its new result.
  [2, 3, 1, 9],
]) {
  test(`field update maps selection ${start}..${end} with boundary affinity and undo`, () => {
    const engine = new RichTextEngine(
      new FlowDocument(
        new Paragraph([
          new Run("A"),
          createFieldFromInstruction("DOCVARIABLE Value", "old"),
          new Run("Z"),
        ]),
      ),
    );
    engine.Select(start, end);
    const features = new DocumentFeatures(engine);
    features.UpdateFields({ Variables: { Value: "expanded" } });
    assert.equal(engine.Document.Text, "AexpandedZ");
    assert.deepEqual(
      [engine.Selection.Start.Offset, engine.Selection.End.Offset],
      [expectedStart, expectedEnd],
    );
    engine.Undo();
    assert.equal(engine.Document.Text, "AoldZ");
    assert.deepEqual(
      [engine.Selection.Start.Offset, engine.Selection.End.Offset],
      [start, end],
    );
    engine.Redo();
    assert.deepEqual(
      [engine.Selection.Start.Offset, engine.Selection.End.Offset],
      [expectedStart, expectedEnd],
    );
    engine.Dispose();
  });
}

test("inserting a date after a page-cache update does not move into existing fields", () => {
  const engine = new RichTextEngine(
    new FlowDocument(
      new Paragraph([
        createField("PAGE"),
        new Run("|"),
        createField("NUMPAGES"),
      ]),
    ),
  );
  const features = new DocumentFeatures(engine);
  features.UpdateFields({ PageNumber: 4, PageCount: 8 });
  assert.equal(engine.Selection.Start.Offset, 0);
  engine.Change(() => {
    features.InsertField("DATE", "", "ISO");
    features.UpdateFields({ Now: new Date("2026-09-20T12:00:00Z") });
  });
  assert.equal(engine.Document.Text, "2026-09-204|8");
  engine.Undo();
  assert.equal(engine.Document.Text, "4|8");
  assert.equal(engine.Selection.Start.Offset, 0);
  engine.Dispose();
});
