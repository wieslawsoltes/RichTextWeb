import * as RT from "../src/index.js";
import { DocumentStorySession } from "../src/story-session.js";
import { resolveDocumentStyle } from "../src/document-styles.js";
import { createStylesSample } from "../sample/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
  Run,
  Span,
  Bold,
  DocumentFeatures,
  DependencyProperty,
  validateDocumentStyles,
  type DocumentStyle,
} from "../src/core.js";
import { leaves } from "../src/engine-tree.js";
import { fromText, toHTML } from "../src/formats.js";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";
import JSZip from "jszip";
const definitions = (): DocumentStyle[] => [
  {
    Id: "Body",
    Name: "Body text",
    Kind: "Paragraph",
    IsDefault: true,
    Properties: {
      FontSize: 16,
      Foreground: "#334455",
      Margin: { Top: 4, Bottom: 8 },
    },
  },
  {
    Id: "Title",
    Name: "Title",
    Kind: "Paragraph",
    BasedOn: "Body",
    Next: "Body",
    Properties: {
      FontSize: 28,
      FontWeight: "Bold",
      HeadingLevel: 1,
      KeepWithNext: true,
    },
  },
  {
    Id: "Accent",
    Name: "Accent",
    Kind: "Character",
    Properties: { Foreground: "#aabbcc", FontStyle: "Italic" },
  },
  {
    Id: "Strong",
    Name: "Strong accent",
    Kind: "Character",
    BasedOn: "Accent",
    Properties: { FontWeight: "Bold" },
  },
];
function make(text = "First paragraph\nSecond paragraph") {
  const e = new RichTextEngine(fromText(text));
  e.SetDocumentStyles(definitions());
  e.ClearUndo();
  return e;
}
function p(e: RichTextEngine, index = 0) {
  return e.Document.Blocks.Get(index) as Paragraph;
}
function check(e: RichTextEngine, at: number, key: string, value: any) {
  e.Select(at);
  assert.equal(e.GetProperty(key), value);
  assert.equal(e.Selection.Start.Parent?.GetValue(key), value);
}
async function native(e: RichTextEngine) {
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  zip.remove("customXml/richtextweb-review.xml");
  return {
    zip,
    e: new RichTextEngine(
      await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
    ),
  };
}
test("paragraph styles remain references and default formatting is live", () => {
  const e = make();
  check(e, 3, "FontSize", 16);
  e.ApplyParagraphStyle("Title");
  check(e, 3, "FontSize", 28);
  assert.equal(p(e).ToJSON().props.FontSize, undefined);
  assert.equal(p(e).ToJSON().props.ParagraphStyleId, "Title");
  assert.equal(p(e).GetValueSource("FontSize").BaseValueSource, "Style");
  e.SetDocumentStyle({
    ...definitions()[0],
    Properties: { FontSize: 18, Foreground: "#112233" },
  });
  check(e, 3, "FontSize", 28);
  check(e, 20, "FontSize", 18);
  check(e, 3, "Foreground", "#112233");
});
test("direct and host style layers override document styles and survive catalog changes", () => {
  const e = make();
  const para = p(e);
  para.FontSize = 23;
  check(e, 3, "FontSize", 23);
  e.SetDocumentStyle({ ...definitions()[0], Properties: { FontSize: 20 } });
  check(e, 3, "FontSize", 23);
  para.ClearValue("FontSize");
  check(e, 3, "FontSize", 20);
  para.SetStyleValue("FontSize", 25);
  assert.equal(para.FontSize, 25);
  para.ClearStyleValue("FontSize");
  assert.equal(para.FontSize, 20);
});
test("character style wins over paragraph style and explicit run values win over both", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.Select(0, 5);
  e.ApplyCharacterStyle("Strong");
  check(e, 2, "FontStyle", "Italic");
  check(e, 2, "Foreground", "#aabbcc");
  e.Select(0, 5);
  e.ApplyProperty("FontSize", 30);
  e.SetDocumentStyle({
    ...definitions()[3],
    Properties: { FontWeight: "Normal", FontSize: 19 },
  });
  check(e, 2, "FontSize", 30);
  check(e, 2, "FontWeight", "Normal");
  e.Select(0, 5);
  e.ClearDirectFormatting();
  check(e, 2, "FontSize", 19);
});
test("paragraph range style application excludes the next paragraph at its leading boundary", () => {
  const e = make();
  e.Select(0, 16);
  e.ApplyParagraphStyle("Title");
  assert.equal(p(e).GetValue("ParagraphStyleId"), "Title");
  assert.equal(p(e, 1).GetValue("ParagraphStyleId"), undefined);
});
test("style application and definition edits undo atomically with retained node identity", () => {
  const e = make(),
    para = p(e);
  e.ApplyParagraphStyle("Title");
  e.Undo();
  assert.equal(p(e), para);
  assert.equal(para.FontSize, 16);
  e.Redo();
  assert.equal(para.FontSize, 28);
  e.SetDocumentStyle({ ...definitions()[1], Properties: { FontSize: 32 } });
  assert.equal(para.FontSize, 32);
  e.Undo();
  assert.equal(para.FontSize, 28);
  e.Redo();
  assert.equal(para.FontSize, 32);
});
test("normal typing does not freeze named paragraph style values", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.Select(5);
  e.InsertText(" typed");
  e.SetDocumentStyle({ ...definitions()[1], Properties: { FontSize: 35 } });
  check(e, 8, "FontSize", 35);
  assert.equal(
    leaves(e.Document.ToJSON()).find((l) => l.start <= 8 && l.end >= 8)?.node
      .props.FontSize,
    undefined,
  );
});
test("typing keeps character style identity and explicit direct overrides", () => {
  const e = make();
  e.Select(0, 5);
  e.ApplyCharacterStyle("Strong");
  e.Select(2);
  e.InsertText("XYZ");
  e.SetDocumentStyle({ ...definitions()[3], Properties: { FontSize: 22 } });
  check(e, 3, "FontSize", 22);
  e.Select(1, 4);
  e.ApplyProperty("FontSize", 24);
  e.Select(2);
  e.InsertText("Z");
  check(e, 3, "FontSize", 24);
});
test("collapsed character style command applies only to subsequent typing", () => {
  const e = make();
  e.Select(3);
  e.ApplyCharacterStyle("Strong");
  e.InsertText("XY");
  check(e, 4, "FontWeight", "Bold");
  e.ResetInsertionFormatting();
  check(e, 1, "FontWeight", "Normal");
});
test("Next paragraph style is applied by Enter at paragraph end and is one undo", () => {
  const e = make("Title");
  e.ApplyParagraphStyle("Title");
  e.Select(5);
  e.ClearUndo();
  e.InsertParagraph();
  e.InsertText("Body");
  assert.equal(p(e, 1).GetValue("ParagraphStyleId"), "Body");
  check(e, 8, "FontSize", 16);
  e.Undo();
  e.Undo();
  assert.equal(e.Document.Text, "Title");
  assert.equal(p(e).FontSize, 28);
});
test("mid-paragraph splitting retains current style rather than Next", () => {
  const e = make("Title");
  e.ApplyParagraphStyle("Title");
  e.Select(2);
  e.InsertParagraph();
  assert.equal(p(e, 1).GetValue("ParagraphStyleId"), "Title");
});
test("empty paragraphs expose default and selected named styles", () => {
  const e = make("");
  assert.equal(p(e).FontSize, 16);
  e.ApplyParagraphStyle("Title");
  assert.equal(e.GetProperty("FontSize"), 28);
});
test("definition getters and resolver return detached data", () => {
  const e = make();
  const ds = e.GetDocumentStyles();
  ds[0].Properties.FontSize = 99;
  const values = e.ResolveDocumentStyle("Title");
  values.FontSize = 100;
  assert.equal(p(e).FontSize, 16);
  assert.equal(e.ResolveDocumentStyle("Title").FontSize, 28);
});
test("remove in-use style requires replacement and retargets dependent definitions with undo", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  const before = e.Document.ToJSON();
  assert.throws(() => e.RemoveDocumentStyle("Body"));
  assert.deepEqual(e.Document.ToJSON(), before);
  e.SetDocumentStyle({
    Id: "Base",
    Name: "Base",
    Kind: "Paragraph",
    Properties: { FontSize: 19 },
  });
  e.RemoveDocumentStyle("Body", "Base");
  assert.equal(
    e.GetDocumentStyles().find((s) => s.Id === "Title")?.BasedOn,
    "Base",
  );
  check(e, 20, "FontSize", 19);
  e.Undo();
  check(e, 20, "FontSize", 16);
});
test("replacing catalog cannot orphan references and cannot leave partial mutations", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  const before = e.Document.ToJSON();
  assert.throws(() => e.SetDocumentStyles([]));
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("style-aware TOC recognizes inherited outline level", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.Select(e.Document.Text.length);
  new DocumentFeatures(e).InsertTableOfContents({ IncludePageNumbers: false });
  assert.match(e.Document.Text, /Contents\nFirst paragraph/);
});
test("HTML resolves named styles without mutating canonical local properties", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  const before = e.Document.ToJSON(),
    html = toHTML(e.Document);
  assert.match(html, /font-size:28px/);
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("style catalog updates remain visible inside an open model change batch", () => {
  const e = make();
  const para = p(e);
  assert.equal(para.FontSize, 16);
  e.Document.BeginChange();
  try {
    e.Document.SetValue("DocumentStyles", [
      {
        Id: "Body",
        Name: "Body",
        Kind: "Paragraph",
        IsDefault: true,
        Properties: { FontSize: 21 },
      },
    ]);
    assert.equal(para.FontSize, 21);
  } finally {
    e.Document.EndChange();
  }
});
test("moving a styled element to another document does not reuse the old style cache", () => {
  const e = make(),
    e2 = make();
  e2.SetDocumentStyle({ ...definitions()[0], Properties: { FontSize: 40 } });
  const para = p(e);
  assert.equal(para.FontSize, 16);
  e.Document.Blocks.Remove(para);
  assert.equal(para.FontSize, 16);
  e2.Document.Blocks.Add(para);
  assert.equal(para.FontSize, 40);
});
test("partial character styling keeps outside rich nodes and annotation offsets", () => {
  const e = make("abc def ghi");
  e.Select(4, 7);
  e.AddBookmark("word");
  const before = e.Annotations;
  e.ApplyCharacterStyle("Accent");
  assert.equal(e.Document.Text, "abc def ghi");
  assert.deepEqual(e.Annotations, before);
  check(e, 5, "FontStyle", "Italic");
  check(e, 1, "FontStyle", "Normal");
});
test("changing style strips selected old styled wrappers but not unselected ranges", () => {
  const span = new Span(new Run("abcdefgh"));
  span.SetValue("CharacterStyleId", "Strong");
  const e = new RichTextEngine(new FlowDocument(new Paragraph(span)));
  e.SetDocumentStyles(definitions());
  e.Select(2, 5);
  e.ApplyCharacterStyle("Accent");
  check(e, 3, "FontWeight", "Normal");
  check(e, 1, "FontWeight", "Bold");
  check(e, 6, "FontWeight", "Bold");
});
test("clearing direct character formatting retains semantic text and active style", () => {
  const e = new RichTextEngine(
    new FlowDocument(new Paragraph(new Bold(new Run("text")))),
  );
  e.SetDocumentStyles(definitions());
  e.Select(0, 4);
  e.ApplyCharacterStyle("Accent");
  e.ClearDirectFormatting();
  assert.equal(e.Document.Text, "text");
  check(e, 2, "FontWeight", "Normal");
  check(e, 2, "FontStyle", "Italic");
});
test("style formatting respects locked content controls", () => {
  const e = make("");
  const id = e.InsertContentControl(
    { Kind: "RichText", LockContents: true },
    "locked",
  );
  e.SelectContentControl(id);
  const before = e.Document.ToJSON();
  assert.throws(() => e.ApplyCharacterStyle("Accent"));
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("style edits participate in tracked formatting rejection", () => {
  const e = make();
  e.TrackChanges = true;
  e.ApplyParagraphStyle("Title");
  assert.equal(e.Revisions.length, 1);
  e.RejectRevision(e.Revisions[0].Id);
  assert.equal(p(e).FontSize, 16);
});
for (const [name, action] of [
  ["cycle", (s: any[]) => (s[0].BasedOn = "Title")],
  ["missing parent", (s: any[]) => (s[1].BasedOn = "Missing")],
  ["wrong parent kind", (s: any[]) => (s[1].BasedOn = "Accent")],
  ["wrong next kind", (s: any[]) => (s[1].Next = "Accent")],
  ["duplicate", (s: any[]) => s.push(s[0])],
  ["multiple defaults", (s: any[]) => (s[1].IsDefault = true)],
  ["unknown property", (s: any[]) => (s[0].Properties.Script = "alert(1)")],
  ["NaN", (s: any[]) => (s[0].Properties.FontSize = NaN)],
  [
    "invalid alignment",
    (s: any[]) => (s[0].Properties.TextAlignment = "unexpected"),
  ],
  ["negative margin", (s: any[]) => (s[0].Properties.Margin = -5)],
  [
    "character paragraph value",
    (s: any[]) => (s[2].Properties.HeadingLevel = 1),
  ],
  ["identity", (s: any[]) => (s[0].Id = "bad <id>")],
] as const)
  test(`invalid catalog (${name}) fails before mutation`, () => {
    const e = make(),
      before = e.Document.ToJSON(),
      s = definitions();
    action(s);
    assert.throws(() => e.SetDocumentStyles(s));
    assert.deepEqual(e.Document.ToJSON(), before);
  });
test("style catalogs have bounded count and inheritance depth", () => {
  assert.throws(() =>
    validateDocumentStyles(
      Array.from({ length: 257 }, (_, i) => ({
        Id: `S${i}`,
        Name: "Style",
        Kind: "Paragraph",
        Properties: {},
      })),
    ),
  );
  assert.throws(() =>
    validateDocumentStyles(
      Array.from({ length: 65 }, (_, i) => ({
        Id: `S${i}`,
        Name: "Style",
        Kind: "Paragraph",
        ...(i ? { BasedOn: `S${i - 1}` } : {}),
        Properties: {},
      })),
    ),
  );
});
test("native DOCX retains paragraph/character references and inheritance without private metadata", async () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.Select(0, 5);
  e.ApplyCharacterStyle("Strong");
  const { zip, e: again } = await native(e);
  const xml = await zip.file("word/styles.xml")!.async("string");
  assert.match(xml, /w:styleId="Title"/);
  assert.match(xml, /<w:basedOn w:val="Body"/);
  assert.match(xml, /<w:next w:val="Body"/);
  const body = await zip.file("word/document.xml")!.async("string");
  assert.match(body, /<w:pStyle w:val="Title"/);
  assert.match(body, /<w:rStyle w:val="Strong"/);
  check(again, 2, "FontSize", 28);
  check(again, 2, "Foreground", "#aabbcc");
  again.SetDocumentStyle({
    ...again.GetDocumentStyles().find((s) => s.Id === "Title")!,
    Properties: { FontSize: 36 },
  });
  check(again, 2, "FontSize", 36);
  check(again, 20, "FontSize", 16);
});
test("native style toggle conversion can turn inherited bold/italic off", async () => {
  const e = make();
  e.SetDocumentStyle({
    Id: "PlainTitle",
    Name: "Plain",
    Kind: "Paragraph",
    BasedOn: "Title",
    Properties: { FontWeight: "Normal" },
  });
  e.ApplyParagraphStyle("PlainTitle");
  const { e: again } = await native(e);
  check(again, 2, "FontWeight", "Normal");
  assert.equal(again.ResolveDocumentStyle("PlainTitle").FontWeight, "Normal");
});
test("native direct false/zero values override named paragraph layout", async () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.SetParagraphProperty("KeepWithNext", false);
  e.SetParagraphProperty("HeadingLevel", 0);
  const { e: again } = await native(e);
  assert.equal(p(again).GetValue("KeepWithNext"), false);
  assert.equal(p(again).GetValue("HeadingLevel"), 0);
});
test("native style import diagnoses cycles and unsupported properties while retaining text", async () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  const { zip } = await native(e);
  let xml = await zip.file("word/styles.xml")!.async("string");
  xml = xml
    .replace(
      '<w:name w:val="Body text"/>',
      '<w:name w:val="Body text"/><w:basedOn w:val="Title"/>',
    )
    .replace(
      '<w:name w:val="Accent"/>',
      '<w:name w:val="Accent"/><w:link w:val="Title"/>',
    );
  zip.file("word/styles.xml", xml);
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(imported.Text, e.Document.Text);
  assert(imported.GetValue("DocxStyleImportWarnings").length > 0);
});

test("public resolver observes mutated caller arrays and inherits individual margin sides", async () => {
  const s = definitions();
  s[1].Properties.Margin = { Left: 20 };
  assert.deepEqual(resolveDocumentStyle(s, "Title").Margin, {
    Top: 4,
    Bottom: 8,
    Left: 20,
  });
  s[0].Properties.FontSize = 40;
  assert.equal(resolveDocumentStyle(s, "Body").FontSize, 40);
});
test("header drafts inherit catalogs and reject shared definition changes without losing parent data", async () => {
  const e = make();
  const heading = new Paragraph("Header");
  heading.SetValue("ParagraphStyleId", "Title");
  new DocumentFeatures(e).SetStory("Headers", [heading.ToJSON()]);
  const draft = new DocumentStorySession(e, "Headers");
  assert.equal((draft.Document.Blocks.Get(0) as Paragraph).FontSize, 28);
  draft.Engine.ApplyParagraphStyle("Body");
  draft.Apply();
  assert.equal(
    e.Document.GetValue("Headers")[0].props.ParagraphStyleId,
    "Body",
  );
  const conflict = new DocumentStorySession(e, "Headers");
  conflict.Engine.SetDocumentStyle({
    ...definitions()[0],
    Properties: { FontSize: 50 },
  });
  assert.throws(() => conflict.Apply(), /parent document/);
  assert.equal(e.ResolveDocumentStyle("Body").FontSize, 16);
  conflict.Dispose();
  const changed = new DocumentStorySession(e, "Headers");
  e.SetDocumentStyle({ ...definitions()[0], Properties: { FontSize: 24 } });
  assert(changed.HasConflict);
  changed.Dispose();
});
test("floating story edit uses shared styles and applies only content changes", () => {
  const e = make();
  e.Select(3);
  const id = e.InsertNode(new RT.Figure(new Paragraph("Floating")).ToJSON());
  e.EditFloatingContent(id, (story) => {
    assert.equal(story.GetDocumentStyles().length, 4);
    story.ApplyParagraphStyle("Title");
    assert.equal(story.GetProperty("FontSize"), 28);
  });
  const before = e.Document.ToJSON();
  assert.throws(
    () =>
      e.EditFloatingContent(id, (story) =>
        story.SetDocumentStyle({
          ...definitions()[0],
          Properties: { FontSize: 99 },
        }),
      ),
    /parent document/,
  );
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("a styles-only native edit invalidates stale optional private document data", async () => {
  const e = make();
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  const extension = await zip
    .file("customXml/richtextweb-review.xml")!
    .async("string");
  assert.match(extension, /stylesSha256="[a-f0-9]{64}"/);
  const styles = await zip.file("word/styles.xml")!.async("string");
  zip.file(
    "word/styles.xml",
    styles.replace('w:sz w:val="24"', 'w:sz w:val="33"'),
  );
  const again = new RichTextEngine(
    await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
  );
  assert.equal(again.ResolveDocumentStyle("Body").FontSize, 22);
  assert.equal(p(again).FontSize, 22);
});
test("native based-on margin attributes remain inherited and direct zero indent survives", async () => {
  const e = make();
  e.SetDocumentStyle({
    ...definitions()[1],
    Properties: { Margin: { Left: 24 }, TextIndent: 12 },
  });
  e.ApplyParagraphStyle("Title");
  e.SetParagraphProperty("TextIndent", 0);
  const { e: again } = await native(e);
  assert.deepEqual(again.ResolveDocumentStyle("Title").Margin, {
    Top: 4,
    Bottom: 8,
    Left: 24,
  });
  assert.equal(p(again).GetValue("TextIndent"), 0);
});
test("a full 256-entry catalog without legacy synthetic styles has native interchange", async () => {
  const e = new RichTextEngine(fromText("Catalog"));
  const styles = Array.from({ length: 256 }, (_, i) => ({
    Id: `Style${i}`,
    Name: `Style ${i}`,
    Kind: "Paragraph" as const,
    Properties: { FontSize: 16 },
  }));
  e.SetDocumentStyles(styles);
  e.ApplyParagraphStyle("Style255");
  const { e: again } = await native(e);
  assert.equal(again.GetDocumentStyles().length, 256);
  assert.equal(p(again).GetValue("ParagraphStyleId"), "Style255");
});
test("headless sample demonstrates live definitions, explicit overrides and native editability", async () => {
  const e = new RichTextEngine(createStylesSample(RT));
  assert.equal(e.GetDocumentStyles().length, 6);
  const body = e.GetDocumentStyles().find((s) => s.Id === "Body")!;
  e.SetDocumentStyle({
    ...body,
    Properties: { ...body.Properties, FontSize: 20 },
  });
  const { e: again } = await native(e);
  assert.match(again.Document.Text, /Styles that stay connected/);
  assert.equal(again.ResolveDocumentStyle("Body").FontSize, 20);
  again.Select(again.Document.Text.indexOf("Direct emphasis") + 2);
  assert.equal(again.GetProperty("FontWeight"), "Bold");
});
test("style from selection does not freeze the automatic line-height sentinel as 1.5 pixels", () => {
  const e = new RichTextEngine(fromText("A paragraph"));
  e.CreateDocumentStyleFromSelection("Captured", "Captured", "Paragraph");
  assert.equal(e.ResolveDocumentStyle("Captured").LineHeight, undefined);
  e.ApplyParagraphStyle("Captured");
  assert.equal(p(e).GetValueSource("LineHeight").BaseValueSource, "Default");
});
test("missing native theme retains supported setters and reports theme fallback", async () => {
  const e = make();
  const { zip } = await native(e);
  zip.file(
    "word/styles.xml",
    (await zip.file("word/styles.xml")!.async("string")).replace(
      '<w:rPr><w:sz w:val="24"/>',
      '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="24"/>',
    ),
  );
  const again = new RichTextEngine(
    await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
  );
  assert.equal(again.ResolveDocumentStyle("Body").FontSize, 16);
  assert(
    again.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("Theme"),
    ),
  );
});
test("missing native style references fall back without blocking subsequent authoring", async () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  const { zip } = await native(e);
  zip.file(
    "word/document.xml",
    (await zip.file("word/document.xml")!.async("string")).replace(
      'w:pStyle w:val="Title"',
      'w:pStyle w:val="Missing"',
    ),
  );
  const again = new RichTextEngine(
    await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
  );
  assert.equal(p(again).GetValue("ParagraphStyleId"), undefined);
  assert(
    again.Document.GetValue("DocxStyleImportWarnings").some((w: string) =>
      w.includes("Missing"),
    ),
  );
  again.SetDocumentStyle({
    Id: "New",
    Name: "New",
    Kind: "Paragraph",
    Properties: { FontSize: 24 },
  });
  again.ApplyParagraphStyle("New");
  assert.equal(p(again).FontSize, 24);
});
test("style references, catalog updates and undo synchronize through existing bound replicas", () => {
  const original = make();
  const a = new RT.CollaborativeDocumentSession({
      DocumentId: "styles",
      ActorId: "a",
      Document: original.Document.ToJSON(),
    }),
    b = new RT.CollaborativeDocumentSession({
      DocumentId: "styles",
      ActorId: "b",
      Document: original.Document.ToJSON(),
    });
  const ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document),
    ba = a.BindEngine(ea),
    bb = b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.ApplyParagraphStyle("Title");
  assert.equal(p(eb).FontSize, 28);
  eb.SetDocumentStyle({ ...definitions()[1], Properties: { FontSize: 36 } });
  assert.equal(p(ea).FontSize, 36);
  eb.Undo();
  assert.equal(p(ea).FontSize, 28);
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  ba.Dispose();
  bb.Dispose();
});
test("updating a style from selection preserves identity and links with one undo", () => {
  const e = make();
  e.ApplyParagraphStyle("Title");
  e.Select(0, 5);
  e.ApplyProperty("FontSize", 40);
  e.UpdateDocumentStyleFromSelection("Title");
  assert.equal(e.ResolveDocumentStyle("Title").FontSize, 40);
  assert.equal(
    e.GetDocumentStyles().find((s) => s.Id === "Title")?.Next,
    "Body",
  );
  e.Undo();
  assert.equal(e.ResolveDocumentStyle("Title").FontSize, 28);
});
test("default styles with implicit paragraph users require replacement on deletion", () => {
  const e = new RichTextEngine(fromText("Default"));
  e.SetDocumentStyles([definitions()[0]]);
  assert.throws(() => e.RemoveDocumentStyle("Body"), /default style/);
  e.SetDocumentStyle({
    Id: "Other",
    Name: "Other",
    Kind: "Paragraph",
    Properties: { FontSize: 30 },
  });
  e.RemoveDocumentStyle("Body", "Other");
  assert.equal(p(e).FontSize, 30);
});
test("creating from selection cannot overwrite an existing definition", () => {
  const e = make();
  const before = e.Document.ToJSON();
  assert.throws(
    () => e.CreateDocumentStyleFromSelection("Title", "New", "Paragraph"),
    /already exists/,
  );
  assert.deepEqual(e.Document.ToJSON(), before);
});
