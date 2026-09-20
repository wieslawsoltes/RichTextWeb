import test from "node:test";
import assert from "node:assert/strict";
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
  Run,
  Bold,
  createContentControl,
  validateContentControlProperties,
  getContentControls,
  DocumentFeatures,
} from "../src/core.js";
import { fromText, fromHTML } from "../src/formats.js";

function make(
  kind: any = "PlainText",
  value: any = "hello",
  options: any = {},
) {
  const e = new RichTextEngine(fromText("Before AFTER"));
  e.Select(7);
  const id = e.InsertContentControl(
    { Kind: kind, Tag: "answer", ...options },
    value,
  );
  e.ClearUndo();
  return { e, id };
}
for (const [kind, value, options, text] of [
  ["PlainText", "Zażółć 😀", {}, "Zażółć 😀"],
  ["RichText", "rich", {}, "rich"],
  ["CheckBox", true, {}, "☒"],
  ["CheckBox", false, {}, "☐"],
  ["Date", "2024-02-29", { DateFormat: "dd/MM/yyyy" }, "29/02/2024"],
  [
    "DropDownList",
    "a",
    { Items: [{ DisplayText: "Alpha", Value: "a" }] },
    "Alpha",
  ],
  [
    "ComboBox",
    "Other",
    { Items: [{ DisplayText: "Alpha", Value: "a" }] },
    "Other",
  ],
] as const)
  test(`${kind} has validated typed value and visible content`, () => {
    const { e, id } = make(kind, value, options);
    const c = e.GetContentControls()[0];
    assert.equal(c.Id, id);
    assert.equal(c.Value, value);
    assert.equal(c.Text, text);
    assert.equal(c.Start, 7);
    assert.equal(c.End, 7 + text.length);
    assert.equal(e.Document.Text, `Before ${text}AFTER`);
    const json = FlowDocument.FromJSON(e.Document.ToJSON());
    assert.deepEqual(getContentControls(json.ToJSON()), e.GetContentControls());
  });
test("empty values are placeholders, required validation is separate from typing", () => {
  const { e, id } = make("PlainText", "", {
    Required: true,
    Title: "Name",
    Placeholder: "Enter your name",
  });
  assert.equal(e.GetFormData().answer, "");
  assert.equal(e.ValidateForm()[0].Message, "Name is required.");
  e.SetContentControlValue(id, "Ada");
  assert.deepEqual(e.ValidateForm(), []);
  assert.equal(e.Document.Text, "Before AdaAFTER");
  e.Undo();
  assert.equal(e.GetFormData().answer, "");
  e.Redo();
  assert.equal(e.GetFormData().answer, "Ada");
});
for (const [kind, value, options] of [
  ["Date", "2023-02-29", {}],
  ["Date", "2024-13-01", {}],
  ["Date", "tomorrow", {}],
  ["CheckBox", "true", {}],
  ["PlainText", 42, {}],
  ["PlainText", "too long", { MaxLength: 2 }],
  [
    "DropDownList",
    "missing",
    { Items: [{ DisplayText: "Alpha", Value: "a" }] },
  ],
  ["PlainText", "a\nb", {}],
  ["PlainText", "x\u0000", {}],
] as const)
  test(`invalid ${kind} value ${JSON.stringify(value)} is rejected atomically`, () => {
    const e = new RichTextEngine(fromText("unchanged"));
    const before = e.Document.ToJSON();
    assert.throws(() =>
      e.InsertContentControl({ Kind: kind, ...options }, value as any),
    );
    assert.deepEqual(e.Document.ToJSON(), before);
    assert.equal(e.CanUndo, false);
  });
test("validation rejects wrong types, choice ambiguity, unknown metadata and runaway input", () => {
  for (const options of [
    { Kind: "Unknown" },
    { Kind: "PlainText", MaxLength: 0 },
    { Kind: "PlainText", LockContents: "true" },
    { Kind: "DropDownList", Items: [] },
    {
      Kind: "ComboBox",
      Items: [
        { Value: "a", DisplayText: "A" },
        { Value: "a", DisplayText: "B" },
      ],
    },
    { Kind: "PlainText", Script: "eval" },
    { Kind: "PlainText", Title: "x".repeat(256) },
  ])
    assert.throws(() => createContentControl(options as any));
  assert.throws(() => validateContentControlProperties({ Kind: "PlainText" }));
});
test("locks independently prevent value edits or wrapper removal", () => {
  const { e, id } = make("PlainText", "fixed", { LockContents: true });
  const before = e.Document.ToJSON();
  assert.throws(() => e.SetContentControlValue(id, "changed"), /locked/);
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.equal(e.CanUndo, false);
  e.RemoveContentControl(id);
  assert.equal(e.Document.Text, "Before fixedAFTER");
  assert.equal(e.GetContentControls().length, 0);
  e.Undo();
  e.SetContentControlProperties(id, {
    LockContents: false,
    LockContentControl: true,
  });
  e.ClearUndo();
  e.SetContentControlValue(id, "editable");
  assert.equal(e.GetFormData().answer, "editable");
  assert.throws(() => e.RemoveContentControl(id), /cannot be removed/);
});
test("ordinary typing and formatting respect locked contents without a UI dependency", () => {
  const { e, id } = make("RichText", "hello", {
    LockContentControl: true,
    LockContents: true,
  });
  e.Select(9);
  const before = e.Document.ToJSON();
  assert.throws(() => e.InsertText("X"), /locked/);
  e.Select(8, 10);
  assert.throws(() => e.ApplyProperty("FontWeight", "Bold"), /locked/);
  e.SelectContentControl(id);
  assert.throws(() => e.InsertText("gone"), /cannot be removed/);
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.equal(e.CanUndo, false);
});
test("unlocked text controls preserve wrapper identity through partial replacement and formatting", () => {
  const { e, id } = make("RichText", "hello");
  e.Select(8, 10);
  e.InsertText("XX");
  assert.equal(e.GetFormData().answer, "hXXlo");
  e.Select(8, 10);
  e.ApplyProperty("FontWeight", "Bold");
  e.Select(9);
  e.ApplyProperty("FontStyle", "Italic");
  e.InsertText("Y");
  assert.equal(e.GetFormData().answer, "hXYXlo");
  assert.equal(e.GetContentControls()[0].Id, id);
});
test("typing at content-control boundaries stays outside their values", () => {
  const { e, id } = make();
  e.Select(7);
  e.InsertText("left ");
  const c = e.GetContentControls()[0];
  assert.equal(c.Value, "hello");
  assert.equal(c.Id, id);
  e.Select(c.End!);
  e.InsertText(" right");
  assert.equal(e.GetFormData().answer, "hello");
});
test("typed controls reject ordinary invalid display edits", () => {
  const { e, id } = make("Date", "2024-02-29");
  const before = e.Document.ToJSON();
  e.Select(10);
  assert.throws(() => e.InsertText("9"));
  assert.deepEqual(e.Document.ToJSON(), before);
  e.SetContentControlValue(id, "2026-09-20");
  assert.equal(e.GetFormData().answer, "2026-09-20");
});
test("whole unlocked inline control deletion removes its wrapper", () => {
  const { e, id } = make();
  e.SelectContentControl(id);
  e.InsertText("");
  assert.equal(e.GetContentControls().length, 0);
  assert.equal(e.Document.Text, "Before AFTER");
  e.Undo();
  assert.equal(e.GetContentControls()[0].Id, id);
});
test("complete copied controls get distinct identities", () => {
  const { e, id } = make();
  e.SelectContentControl(id);
  const fragment = e.GetSelectedFragment();
  e.Select(e.Document.Text.length);
  e.InsertFragment(fragment.ToJSON().children!);
  const controls = e.GetContentControls();
  assert.equal(controls.length, 2);
  assert.notEqual(controls[0].Id, controls[1].Id);
});
test("rich block controls hold multiple formatted paragraphs and tables", () => {
  const { e, id } = make("RichText", "Text", { Level: "Block" });
  const content = fromHTML(
    "<p><b>Bold</b> content</p><table><tr><td>Cell</td></tr></table><p>End</p>",
  ).ToJSON().children!;
  e.SetContentControlContent(id, content);
  const info = e.GetContentControls()[0];
  assert.equal(info.Value, "Bold content\nCell\nEnd");
  assert.equal(info.Content.length, 3);
  assert.equal(e.Document.FindById(info.NodeId)?.Type, "Section");
  e.Undo();
  assert.equal(e.GetFormData().answer, "Text");
});
test("wrapping a rich selected paragraph preserves its formatting", () => {
  const e = new RichTextEngine(fromHTML("<p><b>Hello</b> there</p>"));
  e.Select(0, 5);
  const id = e.InsertContentControl({ Kind: "RichText" });
  e.SelectContentControl(id);
  assert.equal(e.Selection.GetPropertyValue("FontWeight"), "Bold");
  assert.equal(e.GetContentControls()[0].Value, "Hello");
});
test("FillForm preflights all tags, types and locks and groups changes into one undo", () => {
  const e = new RichTextEngine(fromText(""));
  const a = e.InsertContentControl({ Kind: "PlainText", Tag: "name" }, "Ada");
  e.Select(e.Document.Text.length);
  e.InsertText(" | ");
  const b = e.InsertContentControl(
    { Kind: "CheckBox", Tag: "agree", Required: true },
    false,
  );
  e.ClearUndo();
  const before = e.Document.ToJSON();
  assert.throws(() => e.FillForm({ name: "Grace", agree: "not bool" }));
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.throws(() => e.FillForm({ unknown: "x" }));
  assert.equal(e.CanUndo, false);
  e.SetContentControlProperties(b, { LockContents: true });
  e.ClearUndo();
  const locked = e.Document.ToJSON();
  assert.throws(() => e.FillForm({ name: "Grace", agree: true }), /locked/);
  assert.deepEqual(e.Document.ToJSON(), locked);
  assert.equal(e.CanUndo, false);
  e.SetContentControlProperties(b, { LockContents: false });
  e.ClearUndo();
  e.FillForm({ name: "Grace", agree: true });
  assert.deepEqual({ ...e.GetFormData() }, { name: "Grace", agree: true });
  assert.deepEqual(e.ValidateForm(), []);
  e.Undo();
  assert.deepEqual({ ...e.GetFormData() }, { name: "Ada", agree: false });
  assert.equal(e.CanUndo, false);
  e.Redo();
  assert.deepEqual({ ...e.GetFormData() }, { name: "Grace", agree: true });
  e.ClearUndo();
  e.SetContentControlValue(a, "Grace");
  e.FillForm({ agree: true });
  assert.equal(e.CanUndo, false);
});
test("form extraction and input use own properties without prototype pollution", () => {
  const { e, id } = make("PlainText", "safe", { Tag: "__proto__" });
  const data = JSON.parse('{"__proto__":"value"}');
  e.FillForm(data);
  assert.equal(e.GetFormData().__proto__, "value");
  assert.equal(Object.getPrototypeOf(e.GetFormData()), null);
  assert.equal(({} as any).value, undefined);
  assert.equal(e.GetContentControls()[0].Id, id);
});
test("duplicate tags require consistent extraction but can be filled together", () => {
  const { e } = make("PlainText", "first");
  e.Select(e.Document.Text.length);
  e.InsertContentControl({ Kind: "PlainText", Tag: "answer" }, "second");
  assert.throws(() => e.GetFormData(), /different/);
  e.FillForm({ answer: "shared" });
  assert.equal(e.GetFormData().answer, "shared");
});
test("main-story annotations and carets map across typed value substitutions", () => {
  const { e, id } = make();
  e.Select(12, 17);
  const bm = e.AddBookmark("tail");
  e.Select(13);
  e.ClearUndo();
  e.SetContentControlValue(id, "X");
  assert.equal(e.Selection.Start.Offset, 9);
  const a = e.Annotations.find((x) => x.Id === bm.Id)!;
  assert.equal(e.Document.Text.slice(a.Start, a.End), "AFTER");
  e.Undo();
  assert.equal(e.Selection.Start.Offset, 13);
  assert.equal(e.Document.Text, "Before helloAFTER");
});
test("new control command aliases are shared engine APIs", () => {
  const e = new RichTextEngine(fromText(""));
  const id = e.Execute("InsertContentControl", {
    Options: { Kind: "CheckBox", Tag: "check" },
    Value: true,
  });
  e.Execute("SetContentControlValue", { Id: id, Value: false });
  assert.equal(e.GetFormData().check, false);
  e.Execute("RemoveContentControl", { Id: id, KeepContent: false });
  assert.equal(e.GetContentControls().length, 0);
});
test("property-only changes retain interior annotations and do not map text", () => {
  const { e, id } = make();
  e.Select(8, 10);
  const bookmark = e.AddBookmark("inside");
  e.Select(9);
  e.SetContentControlProperties(id, {
    Title: "Renamed",
    LockContentControl: true,
  });
  const b = e.Annotations.find((a) => a.Id === bookmark.Id)!;
  assert.equal(b.Start, 8);
  assert.equal(b.End, 10);
  assert.equal(e.Selection.Start.Offset, 9);
});
for (const [start, end, value] of [
  [7, 9, "Xllo"],
  [10, 12, "helX"],
] as const)
  test(`partial edge replacement ${start}:${end} retains its control`, () => {
    const { e, id } = make();
    e.Select(start, end);
    e.InsertText("X");
    assert.equal(e.GetFormData().answer, value);
    assert.equal(e.GetContentControls()[0].Id, id);
  });
test("typing selected or interior placeholder replaces presentation instead of appending to it", () => {
  const { e, id } = make("PlainText", "", { Placeholder: "Your name" });
  e.SelectContentControl(id);
  e.InsertText("Ada");
  assert.equal(e.GetFormData().answer, "Ada");
  e.Undo();
  e.Select(9);
  e.InsertText("Z");
  assert.equal(e.GetFormData().answer, "Z");
  assert.equal(e.GetContentControls()[0].Id, id);
});
test("partially copied scalar control is plain content rather than malformed typed state", () => {
  const { e } = make("Date", "2026-09-20");
  e.Select(7, 11);
  const fragment = e.GetSelectedFragment();
  assert.equal(fragment.Text, "2026");
  assert.equal(getContentControls(fragment.ToJSON()).length, 0);
  e.Select(e.Document.Text.length);
  e.InsertFragment(fragment.ToJSON().children!);
  assert.equal(e.GetContentControls().length, 1);
});
test("replace all preflights locked controls without committing earlier eligible matches", () => {
  const { e } = make("PlainText", "hello", {
    LockContents: true,
    LockContentControl: true,
  });
  e.Select(e.Document.Text.length);
  e.InsertText(" hello");
  e.ClearUndo();
  const before = e.Document.ToJSON();
  assert.throws(() => e.ReplaceAll("hello", "goodbye"));
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.equal(e.CanUndo, false);
});
test("typed form values are rejectable structural revisions and retain undo", () => {
  const { e, id } = make("Date", "2026-09-20");
  e.TrackChanges = true;
  e.ClearUndo();
  e.SetContentControlValue(id, "2026-10-01");
  assert.equal(e.Revisions.length, 1);
  e.RejectRevision(e.Revisions[0].Id);
  assert.equal(e.GetFormData().answer, "2026-09-20");
  e.Undo();
  assert.equal(e.GetFormData().answer, "2026-10-01");
});
for (const kind of ["PlainText", "RichText"] as const)
  test(`${kind} placeholder property edits retain empty data and validation`, () => {
    const { e, id } = make(kind, "", { Required: true, Placeholder: "Before" });
    e.SetContentControlProperties(id, { Placeholder: "New placeholder" });
    assert.equal(e.GetContentControls()[0].Text, "New placeholder");
    assert.equal(e.GetFormData().answer, "");
    assert.equal(e.ValidateForm().length, 1);
    e.Undo();
    assert.equal(e.GetContentControls()[0].Text, "Before");
  });
test("checkbox font properties update their actual run without moving bookmarks", () => {
  const { e, id } = make("CheckBox", true);
  e.SetContentControlProperties(id, { CheckedFont: "Arial" });
  assert.equal(e.GetContentControls()[0].Content[0].props.FontFamily, "Arial");
  assert.equal(e.GetFormData().answer, true);
});
