import * as RT from "../src/index.js";
import { createFormsSample } from "../sample/forms.js";
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
  Run,
  DocumentFeatures,
  createContentControl,
} from "../src/core.js";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";
import { fromHTML, fromText } from "../src/formats.js";
const choices = [
  { DisplayText: "Research & development", Value: "rd" },
  { DisplayText: "Operations", Value: "ops" },
];
async function native(doc: FlowDocument) {
  const zip = await JSZip.loadAsync(await toDOCX(doc));
  zip.remove("customXml/richtextweb-review.xml");
  return {
    zip,
    document: await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
  };
}
for (const level of ["Inline", "Block"] as const)
  for (const [kind, value, opts] of [
    ["RichText", "rich text", {}],
    ["PlainText", "Zażółć 😀", {}],
    ["PlainText", "one\ntwo", { Multiline: true }],
    ["Date", "2024-02-29", { DateFormat: "dd/MM/yyyy", DateLocale: "en-GB" }],
    ["CheckBox", true, {}],
    [
      "CheckBox",
      false,
      {
        CheckedSymbol: "✓",
        UncheckedSymbol: "○",
        CheckedFont: "Arial",
        UncheckedFont: "Arial",
      },
    ],
    ["DropDownList", "rd", { Items: choices }],
    ["ComboBox", "Other", { Items: choices }],
  ] as const)
    test(`native ${level} ${kind} SDT round-trip without extension`, async () => {
      const e = new RichTextEngine(fromText(""));
      const id = e.InsertContentControl(
        {
          Kind: kind,
          Level: level,
          Tag: "answer",
          Title: "Question",
          LockContentControl: true,
          ...opts,
        },
        value,
      );
      const { zip, document } = await native(e.Document),
        imported = new RichTextEngine(document),
        c = imported.GetContentControls()[0];
      assert.equal(
        c?.Properties.Kind,
        kind,
        JSON.stringify(document.GetValue("ContentControlImportWarnings")),
      );
      assert.equal(c.Properties.Level, level);
      assert.equal(c.Properties.Tag, "answer");
      assert.equal(c.Value, value);
      assert.equal(c.Properties.LockContentControl, true);
      assert.equal(document.Text, e.Document.Text);
      assert.equal(
        document.GetValue("ContentControlImportWarnings"),
        undefined,
      );
      const xml = await zip.file("word/document.xml")!.async("string");
      assert.match(xml, /<w:sdt>/);
      assert.match(xml, /<w:sdtContent>/);
      assert.match(xml, /w:lock w:val="sdtLocked"/);
      imported.SetContentControlProperties(c.Id, { Title: "New title" });
      assert.equal(
        imported.GetContentControls()[0].Properties.Title,
        "New title",
      );
    });
test("native placeholders use a linked glossary part and retain their empty logical values", async () => {
  const e = new RichTextEngine(fromText(""));
  e.InsertContentControl({
    Kind: "PlainText",
    Tag: "name",
    Placeholder: "Enter <name> & team",
    Required: true,
  });
  const full = await fromDOCX(await toDOCX(e.Document));
  assert.equal(new RichTextEngine(full).ValidateForm().length, 1);
  const { zip, document } = await native(e.Document),
    r = new RichTextEngine(document),
    c = r.GetContentControls()[0];
  assert.equal(c.Value, "");
  assert.equal(c.Properties.Placeholder, "Enter <name> & team");
  assert.equal(c.Properties.ShowingPlaceholder, true);
  // Required is an application rule, never falsely attributed to native Word SDT semantics.
  assert.equal(c.Properties.Required, undefined);
  assert.match(
    await zip.file("word/glossary/document.xml")!.async("string"),
    /w:gallery w:val="placeholder"/,
  );
  assert.match(
    await zip.file("word/_rels/document.xml.rels")!.async("string"),
    /glossaryDocument/,
  );
  r.SetContentControlValue(c.Id, "Ada");
  assert.equal(r.GetFormData().name, "Ada");
});
test("rich block SDTs retain nested tables and text formatting natively", async () => {
  const e = new RichTextEngine(fromText("")),
    id = e.InsertContentControl(
      { Kind: "RichText", Level: "Block", Tag: "description" },
      "Start",
    );
  e.SetContentControlContent(
    id,
    fromHTML(
      "<p><b>Bold</b> detail</p><table><tr><td>One</td><td>Two</td></tr></table>",
    ).ToJSON().children!,
  );
  const { document } = await native(e.Document),
    r = new RichTextEngine(document);
  assert.equal(r.GetContentControls().length, 1);
  assert.equal(document.Text, e.Document.Text);
  assert.equal(r.GetContentControls()[0].Content[1].type, "Table");
  r.Select(1);
  assert.equal(r.Selection.GetPropertyValue("FontWeight"), "Bold");
});
test("nested native controls retain independent typed values", async () => {
  const e = new RichTextEngine(fromText("")),
    outer = e.InsertContentControl(
      { Kind: "RichText", Level: "Block", Tag: "outer" },
      "Start",
    );
  const nested = createContentControl(
    { Kind: "CheckBox", Tag: "accept" },
    true,
  );
  e.SetContentControlContent(outer, [
    {
      type: "Paragraph",
      id: "paragraph",
      props: {},
      children: [new Run("Accept ").ToJSON(), nested],
    },
  ]);
  const { document } = await native(e.Document),
    r = new RichTextEngine(document);
  assert.equal(r.GetContentControls().length, 2);
  assert.equal(r.GetFormData().accept, true);
});
test("independent header controls have null main coordinates and survive native SDTs", async () => {
  const e = new RichTextEngine(fromText("Body"));
  const h = new RichTextEngine(fromText(""));
  h.InsertContentControl({ Kind: "PlainText", Tag: "header" }, "Header value");
  new DocumentFeatures(e).SetStory("Headers", h.Document.ToJSON().children!);
  const { document } = await native(e.Document),
    r = new RichTextEngine(document),
    c = r.GetContentControls()[0];
  assert.equal(c.Value, "Header value");
  assert.equal(c.Start, null);
  r.SetContentControlValue(c.Id, "Revised");
  assert.equal(r.Document.Text, "Body");
  assert.equal(r.GetFormData().header, "Revised");
});
test("unsupported SDT data bindings preserve body and return explicit diagnostic", async () => {
  const e = new RichTextEngine(fromText(""));
  e.InsertContentControl({ Kind: "PlainText", Tag: "bound" }, "Preserved");
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  zip.remove("customXml/richtextweb-review.xml");
  zip.file(
    "word/document.xml",
    (await zip.file("word/document.xml")!.async("string")).replace(
      "<w:sdtPr>",
      '<w:sdtPr><w:dataBinding w:storeItemID="external" w:xpath="/data/name"/>',
    ),
  );
  const doc = await fromDOCX(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(doc.Text, "Preserved");
  assert.equal(new RichTextEngine(doc).GetContentControls().length, 0);
  assert.match(
    doc.GetValue("ContentControlImportWarnings")[0],
    /Unsupported SDT properties/,
  );
});
test("native content locks are not inferred from UI appearance", async () => {
  const e = new RichTextEngine(fromText(""));
  e.InsertContentControl(
    { Kind: "Date", Tag: "date", LockContents: true, LockContentControl: true },
    "2026-09-20",
  );
  const { document } = await native(e.Document),
    r = new RichTextEngine(document),
    c = r.GetContentControls()[0];
  assert.throws(() => r.SetContentControlValue(c.Id, "2026-10-01"), /locked/);
  assert.throws(() => r.RemoveContentControl(c.Id), /removed/);
});
test("project brief sample fills atomically and remains editable through native DOCX", async () => {
  const e = new RichTextEngine(createFormsSample(RT));
  assert.equal(e.GetContentControls().length, 8);
  assert.equal(e.ValidateForm().length, 2);
  const before = e.Document.ToJSON();
  e.FillForm({
    project: "New editor",
    ready: true,
    department: "design",
    targetDate: "2026-11-01",
  });
  assert.equal(e.ValidateForm().length, 0);
  assert.equal(e.GetFormData().department, "design");
  e.Undo();
  assert.deepEqual(e.Document.ToJSON(), before);
  e.Redo();
  const { document } = await native(e.Document),
    r = new RichTextEngine(document);
  assert.equal(r.GetContentControls().length, 8);
  assert.equal(r.GetFormData().project, "New editor");
  assert.equal(r.GetFormData().ready, true);
  r.FillForm({ department: "ops", targetDate: "2026-12-01" });
  assert.match(r.Document.Text, /01 December 2026/);
  assert.throws(() => r.FillForm({ reference: "forged" }), /locked/);
});
