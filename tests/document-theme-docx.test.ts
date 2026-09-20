import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import * as RT from "../src/index.js";
import { leaves } from "../src/engine-tree.js";
import { createThemesSample } from "../sample/themes.js";
import { documentThemeXML } from "../src/document-theme-docx.js";
const {
  RichTextEngine,
  Paragraph,
  Run,
  FlowDocument,
  createDocumentTheme: theme,
  themeColor: color,
  themeFont: font,
  toDOCX,
  fromDOCX,
} = RT;
const xml = (zip: JSZip, path: string) => zip.file(path)!.async("string");
const read = async (zip: JSZip, native = true) => {
  if (native) zip.remove("customXml/richtextweb-review.xml");
  return new RichTextEngine(
    await fromDOCX(await zip.generateAsync({ type: "uint8array" })),
  );
};
async function fixture() {
  const d = RT.fromText("Themed title\nBody text\nFixed color");
  const e = new RichTextEngine(d);
  const t = theme();
  t.ColorMap = { text1: "dark2", accent1: "accent3" };
  e.SetDocumentTheme(t);
  e.SetDocumentStyles([
    {
      Id: "Body",
      Name: "Body",
      Kind: "Paragraph",
      IsDefault: true,
      Properties: {
        FontFamily: font("Minor", "Arial"),
        Foreground: color("text1"),
      },
    },
    {
      Id: "Title",
      Name: "Title",
      Kind: "Paragraph",
      BasedOn: "Body",
      Properties: {
        FontFamily: font("Major", "Verdana"),
        Foreground: color("accent1", { Tint: 153 }),
        Background: color("accent2", { Shade: 191 }),
        HeadingLevel: 1,
        FontSize: 28,
      },
    },
  ]);
  e.Select(1);
  e.ApplyParagraphStyle("Title");
  e.Select(d.Text.indexOf("Fixed color"), d.Text.length);
  e.ApplyProperty("Foreground", "#ABCDEF");
  return { e, zip: await JSZip.loadAsync(await toDOCX(d)) };
}
test("DOCX writes a native theme, package relationship, type and mapping", async () => {
  const { zip } = await fixture(),
    t = await xml(zip, "word/theme/theme1.xml"),
    s = await xml(zip, "word/settings.xml");
  assert.match(t, /<a:theme .*name="Studio"/);
  assert.match(t, /<a:clrScheme /);
  assert.match(t, /<a:majorFont><a:latin typeface="Arial"/);
  for (const tag of [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ])
    assert.match(t, new RegExp(`<a:${tag}><a:srgbClr val="[A-F0-9]{6}"`));
  assert.match(
    s,
    /<w:clrSchemeMapping[^>]*w:t1="dark2"[^>]*w:accent1="accent3"/,
  );
  assert.match(
    await xml(zip, "word/_rels/document.xml.rels"),
    /Type="[^"]*\/theme" Target="theme\/theme1.xml"/,
  );
  assert.match(
    await xml(zip, "[Content_Types].xml"),
    /PartName="\/word\/theme\/theme1.xml" ContentType="application\/vnd.openxmlformats-officedocument.theme\+xml"/,
  );
});
test("DOCX retains symbolic style fonts/colors with resolved fallback and both modifiers", async () => {
  const { zip } = await fixture(),
    styles = await xml(zip, "word/styles.xml");
  assert.match(styles, /w:asciiTheme="majorAscii" w:hAnsiTheme="majorHAnsi"/);
  assert.match(styles, /w:themeColor="accent1" w:themeTint="99"/);
  assert.match(styles, /w:themeFill="accent2" w:themeFillShade="BF"/);
  assert(!styles.includes("theme:color:"));
  assert(!styles.includes("theme:font:"));
  const fallback = RT.resolveDocumentThemeValue(
    { ...theme(), ColorMap: { accent1: "accent3" } },
    "Foreground",
    color("accent1", { Tint: 153 }),
  );
  assert(styles.includes(`w:val="${fallback.slice(1)}"`));
});
test("native theme and named references stay live after private-extension removal", async () => {
  const { zip } = await fixture(),
    e = await read(zip);
  const before = e.Document.Text;
  assert.equal(e.GetDocumentTheme()!.Name, "Studio");
  assert.equal(e.GetDocumentTheme()!.ColorMap!.text1, "dark2");
  assert(RT.parseThemeColor(e.ResolveDocumentStyle("Title").Foreground));
  e.SetDocumentTheme(theme("Editorial"));
  e.Select(1);
  assert.equal(e.GetProperty("FontFamily"), "Georgia");
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(theme("Editorial").Colors.accent1, 153),
  );
  e.Select(e.Document.Text.indexOf("Fixed color") + 2);
  assert.equal(e.GetProperty("Foreground"), "#ABCDEF");
  assert.equal(e.Document.Text, before);
  e.Undo();
  assert.equal(e.GetDocumentTheme()!.Name, "Studio");
});
test("native direct run references retain theme tokens independently of named styles", async () => {
  const r = new Run("Direct");
  r.Foreground = color("accent4", { Tint: 130, Shade: 30 });
  r.Background = color("accent5");
  r.FontFamily = font("Major");
  const e = new RichTextEngine(new FlowDocument(new Paragraph(r)));
  e.SetDocumentTheme(theme());
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  assert.match(
    await xml(zip, "word/document.xml"),
    /themeTint="82" w:themeShade="1E"/,
  );
  const n = await read(zip);
  n.SetDocumentTheme(theme("Editorial"));
  n.Select(2);
  assert.equal(n.GetProperty("FontFamily"), "Georgia");
  assert.equal(
    n.GetProperty("Foreground"),
    RT.transformThemeColor(theme("Editorial").Colors.accent4, 130),
  );
  assert.equal(n.GetProperty("Background"), theme("Editorial").Colors.accent5);
});
test("theme snapshot fingerprints preserve the exact untouched canonical tree", async () => {
  const { zip, e } = await fixture(),
    extension = await xml(zip, "customXml/richtextweb-review.xml");
  for (const key of [
    "themeSha256",
    "settingsSha256",
    "stylesSha256",
    "relationshipsSha256",
  ])
    assert.match(extension, new RegExp(`${key}="[a-f0-9]{64}"`));
  assert.deepEqual(
    (await read(zip, false)).Document.ToJSON(),
    e.Document.ToJSON(),
  );
});
test("an external theme-only edit invalidates the private snapshot", async () => {
  const { zip } = await fixture(),
    t = theme("Editorial");
  zip.file("word/theme/theme1.xml", documentThemeXML(t));
  const e = await read(zip, false);
  assert.equal(e.GetDocumentTheme()!.Name, "Editorial");
  e.Select(2);
  assert.equal(e.GetProperty("FontFamily"), "Georgia");
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(t.Colors.accent3, 153),
  );
});
test("an external settings-only color-map edit invalidates the private snapshot", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/settings.xml",
    (await xml(zip, "word/settings.xml")).replace(
      'w:accent1="accent3"',
      'w:accent1="accent6"',
    ),
  );
  const e = await read(zip, false);
  e.Select(2);
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(theme().Colors.accent6, 153),
  );
});
test("an external relationship-only edit resolves the new part and invalidates the snapshot", async () => {
  const { zip } = await fixture();
  zip.file("word/theme/alternate.xml", documentThemeXML(theme("Forest")));
  zip.file(
    "word/_rels/document.xml.rels",
    (await xml(zip, "word/_rels/document.xml.rels")).replace(
      'Target="theme/theme1.xml"',
      'Target="theme/alternate.xml"',
    ),
  );
  assert.equal((await read(zip, false)).GetDocumentTheme()!.Name, "Forest");
});
test("theme removal falls back to native cached colors without reapplying a tint", async () => {
  const { zip } = await fixture();
  zip.remove("word/theme/theme1.xml");
  const e = await read(zip, false);
  e.Select(2);
  assert.equal(e.GetDocumentTheme(), null);
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(theme().Colors.accent3, 153),
  );
  assert(
    e.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("Theme part is missing"),
    ),
  );
  e.SetDocumentTheme(theme("Forest"));
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(theme("Forest").Colors.accent1, 153),
  );
});
test("partial malformed theme does not synthesize preset colors", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/theme/theme1.xml",
    (await xml(zip, "word/theme/theme1.xml")).replace(
      /<a:accent2>.*?<\/a:accent2>/,
      "",
    ),
  );
  const e = await read(zip);
  assert.equal(e.GetDocumentTheme(), null);
  e.Select(2);
  assert.equal(
    e.GetProperty("Foreground"),
    RT.transformThemeColor(theme().Colors.accent3, 153),
  );
  assert(
    e.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("missing theme color accent2"),
    ),
  );
});
test("unsupported native color transforms preserve the run fallback and warn", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/theme/theme1.xml",
    (await xml(zip, "word/theme/theme1.xml")).replace(
      '<a:srgbClr val="174B75"/>',
      '<a:srgbClr val="174B75"><a:alpha val="50000"/></a:srgbClr>',
    ),
  );
  assert.equal((await read(zip)).GetDocumentTheme(), null);
});
test("system colors use lastClr fallback and disclose unsupported live-system semantics", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/theme/theme1.xml",
    (await xml(zip, "word/theme/theme1.xml")).replace(
      '<a:srgbClr val="202B38"/>',
      '<a:sysClr val="windowText" lastClr="123456"/>',
    ),
  );
  const e = await read(zip);
  assert.equal(e.GetDocumentTheme()!.Colors.dark1, "#123456");
  assert(
    e.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("lastClr"),
    ),
  );
});
test("mixed native font schemes and malformed theme modifiers retain literal fallback", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/styles.xml",
    (await xml(zip, "word/styles.xml"))
      .replace('w:hAnsiTheme="majorHAnsi"', 'w:hAnsiTheme="minorHAnsi"')
      .replace('w:themeTint="99"', 'w:themeTint="ZZ"'),
  );
  const e = await read(zip),
    style = e.ResolveDocumentStyle("Title");
  assert.equal(RT.parseThemeFont(style.FontFamily), null);
  assert.equal(RT.parseThemeColor(style.Foreground), null);
  const warnings = e.Document.GetValue("DocxThemeImportWarnings");
  assert(warnings.some((w: string) => w.includes("Mixed")));
  assert(warnings.some((w: string) => w.includes("modifiers")));
});
test("script-specific theme fonts are diagnosed instead of claiming full script selection", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/theme/theme1.xml",
    (await xml(zip, "word/theme/theme1.xml")).replace(
      '<a:ea typeface=""/>',
      '<a:ea typeface="CJK Font"/>',
    ),
  );
  const e = await read(zip);
  assert(
    e.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("script-specific"),
    ),
  );
  assert.equal(e.GetDocumentTheme()!.Fonts.Major, "Arial");
});
test("theme import normalizes alternate namespace prefixes", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/theme/theme1.xml",
    (await xml(zip, "word/theme/theme1.xml"))
      .replace(/a:/g, "d:")
      .replace("xmlns:a=", "xmlns:d="),
  );
  const e = await read(zip);
  assert.equal(e.GetDocumentTheme()!.Colors.accent1, theme().Colors.accent1);
});
test("external theme links are inert and do not read an unrelated fallback theme", async () => {
  const { zip } = await fixture();
  zip.file(
    "word/_rels/document.xml.rels",
    (await xml(zip, "word/_rels/document.xml.rels")).replace(
      'Target="theme/theme1.xml"',
      'Target="https://example.invalid/theme.xml" TargetMode="External"',
    ),
  );
  const e = await read(zip, false);
  assert.equal(e.GetDocumentTheme(), null);
  assert(
    e.Document.GetValue("DocxThemeImportWarnings").some((w: string) =>
      w.includes("External document theme"),
    ),
  );
});
test("table-cell theme shading survives native import and responds to later palette edits", async () => {
  const e = new RichTextEngine(
    RT.fromHTML("<table><tr><td>Cell</td></tr></table>"),
  );
  e.SetDocumentTheme(theme());
  const root = e.Document.ToJSON();
  const find = (n: any): any =>
    n.type === "TableCell" ? n : (n.children ?? []).map(find).find(Boolean);
  find(root).props.Background = color("accent2", { Tint: 100 });
  e.ReplaceDocument(FlowDocument.FromJSON(root));
  const zip = await JSZip.loadAsync(await toDOCX(e.Document));
  assert.match(
    await xml(zip, "word/document.xml"),
    /<w:tcPr>[^]*?w:themeFill="accent2"/,
  );
  const n = await read(zip);
  n.SetDocumentTheme(theme("Forest"));
  const cell = find(n.Document.ToJSON());
  assert.equal(
    n.Document.FindById(cell.id)!.GetValue("Background"),
    RT.transformThemeColor(theme("Forest").Colors.accent2, 100),
  );
});
test("header/footer references use the document theme after native round trip", async () => {
  const { zip, e } = await fixture();
  const p = new Paragraph(new Run("Header"));
  p.Foreground = color("accent4");
  p.FontFamily = font("Major");
  new RT.DocumentFeatures(e).SetStory("Headers", [p.ToJSON()]);
  const n = await read(await JSZip.loadAsync(await toDOCX(e.Document)));
  n.SetDocumentTheme(theme("Editorial"));
  const draft = new RT.DocumentStorySession(n, "Headers");
  draft.Engine.Select(2);
  assert.equal(draft.Engine.GetProperty("FontFamily"), "Georgia");
  assert.equal(
    draft.Engine.GetProperty("Foreground"),
    theme("Editorial").Colors.accent4,
  );
  draft.Dispose();
});
test("non-Word format conversion materializes tokens without modifying source", async () => {
  const { e } = await fixture();
  const before = e.Document.ToJSON(),
    html = RT.toHTML(e.Document);
  assert(!/style="[^"]*theme:/.test(html));
  assert.deepEqual(e.Document.ToJSON(), before);
  const without = e.GetDocumentTheme();
  e.SetDocumentTheme(null);
  assert(!/style="[^"]*theme:/.test(RT.toHTML(e.Document)));
  e.SetDocumentTheme(without);
});
test("the actual connected-theme sample stays editable through native DOCX and undo", async () => {
  const doc = createThemesSample(RT),
    zip = await JSZip.loadAsync(await toDOCX(doc)),
    e = await read(zip);
  const before = e.Document.Text;
  e.SetDocumentTheme(theme("Editorial"));
  e.Select(1);
  assert.equal(e.GetProperty("FontFamily"), "Georgia");
  assert.equal(e.GetProperty("Foreground"), theme("Editorial").Colors.accent1);
  e.Select(e.Document.Text.indexOf("Fixed brand color") + 2);
  assert.equal(e.GetProperty("Foreground"), "#702A9D");
  assert.equal(e.Document.Text, before);
  e.Undo();
  assert.equal(e.GetDocumentTheme()!.Name, "Studio");
});
