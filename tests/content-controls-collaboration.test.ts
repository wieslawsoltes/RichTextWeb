import test from "node:test";
import assert from "node:assert/strict";
import {
  CollaborativeDocumentSession,
  RichTextEngine,
  FlowDocument,
  Paragraph,
} from "../src/core.js";
test("typed values, metadata, nested identities and undo synchronize over the existing rich protocol", () => {
  const original = new RichTextEngine(new FlowDocument(new Paragraph()));
  const date = original.InsertContentControl(
    { Kind: "Date", Tag: "date", LockContentControl: true },
    "2026-09-20",
  );
  const a = new CollaborativeDocumentSession({
    DocumentId: "forms",
    ActorId: "alice",
    Document: original.Document.ToJSON(),
  });
  const b = new CollaborativeDocumentSession({
    DocumentId: "forms",
    ActorId: "bob",
    Document: original.Document.ToJSON(),
  });
  const ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document),
    ba = a.BindEngine(ea),
    bb = b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.SetContentControlValue(date, "2026-10-01");
  assert.equal(eb.GetFormData().date, "2026-10-01");
  assert.equal(eb.GetContentControls()[0].Id, date);
  ea.Undo();
  assert.equal(eb.GetFormData().date, "2026-09-20");
  eb.SetContentControlProperties(date, { Title: "Due date" });
  assert.equal(ea.GetContentControls()[0].Properties.Title, "Due date");
  assert.equal(ba.IsConnected, true);
  assert.equal(bb.IsConnected, true);
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  ba.Dispose();
  bb.Dispose();
});
