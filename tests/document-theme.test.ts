import test from "node:test";
import assert from "node:assert/strict";
import * as RT from "../src/index.js";
import { createThemesSample } from "../sample/themes.js";
import { materializeDocumentStyles } from "../src/document-styles.js";
import { leaves } from "../src/engine-tree.js";
const {
  RichTextEngine,
  Paragraph,
  Run,
  FlowDocument,
  createDocumentTheme: theme,
  themeColor: color,
  themeFont: font,
} = RT;
function make() {
  const run = new Run("Linked");
  run.Foreground = color("accent1", { Fallback: "#123456" });
  run.FontFamily = font("Major", "Courier New");
  const fixed = new Run(" fixed");
  fixed.Foreground = "#ABCDEF";
  fixed.FontFamily = "Verdana";
  const engine = new RichTextEngine(
    new FlowDocument(new Paragraph([run, fixed])),
  );
  engine.SetDocumentTheme(theme());
  engine.ClearUndo();
  return { engine, run, fixed };
}
function themedStyle(engine: RT.RichTextEngine) {
  engine.SetDocumentStyles([
    {
      Id: "Body",
      Name: "Body",
      Kind: "Paragraph",
      IsDefault: true,
      Properties: { FontFamily: font("Minor"), Foreground: color("text1") },
    },
    {
      Id: "Title",
      Name: "Title",
      Kind: "Paragraph",
      BasedOn: "Body",
      Properties: { FontFamily: font("Major"), Foreground: color("accent1") },
    },
    {
      Id: "Accent",
      Name: "Accent",
      Kind: "Character",
      Properties: { Foreground: color("accent2") },
    },
  ]);
}
test("themes and parsed references are validated detached data", () => {
  const source = theme(),
    v = RT.validateDocumentTheme(source);
  source.Colors.accent1 = "#FFFFFF";
  assert.notEqual(v.Colors.accent1, source.Colors.accent1);
  assert.deepEqual(
    RT.parseThemeColor(
      color("text1", { Tint: 153, Shade: 191, Fallback: "#AaBbCc" }),
    ),
    { Color: "text1", Tint: 153, Shade: 191, Fallback: "#AABBCC" },
  );
  assert.deepEqual(RT.parseThemeFont(font("Major", "Font with spaces")), {
    Font: "Major",
    Fallback: "Font with spaces",
  });
  assert.equal(RT.parseThemeFont("Arial"), null);
  assert.equal(RT.parseThemeColor("red"), null);
});
test("theme schema rejects incomplete colors, invalid maps, fonts and unknown properties", () => {
  const mutations = [
    (t: any) => delete t.Colors.accent3,
    (t: any) => (t.Colors.accent1 = "red"),
    (t: any) => (t.Colors.extra = "#FFFFFF"),
    (t: any) => (t.ColorMap = { text1: "text2" }),
    (t: any) => (t.Fonts.Major = "bad;url(x)"),
    (t: any) => (t.Fonts.Extra = "Arial"),
    (t: any) => (t.Name = ""),
    (t: any) => (t.Script = "run"),
    (t: any) => (t.ColorMap = []),
  ];
  for (const edit of mutations) {
    const t = theme();
    edit(t);
    assert.throws(() => RT.validateDocumentTheme(t));
  }
  for (const t of [null, [], 42, "Studio"])
    assert.throws(() => RT.validateDocumentTheme(t));
});
test("theme tokens reject malformed syntax and modifiers before mutation", () => {
  const { engine } = make(),
    before = engine.Document.ToJSON();
  for (const value of [-1, 256, NaN, Infinity, 1.5, "10"])
    assert.throws(() => color("accent1", { Tint: value as number }));
  for (const token of [
    "theme:bad",
    "theme:color:accent9:-:-:000000",
    "theme:color:accent1:100:-:000000",
    "theme:font:Major:%GG",
  ])
    assert.throws(() => engine.ApplyProperty("Foreground", token));
  assert.throws(() => engine.ApplyProperty("FontSize", color("accent1")));
  assert.throws(() => engine.ApplyProperty("Foreground", font("Minor")));
  assert.throws(() => engine.ApplyProperty("FontFamily", color("accent1")));
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.CanUndo, false);
});
test("HSL tint matches the published blue example and takes precedence over shade", () => {
  assert.equal(RT.transformThemeColor("#4F81BD", 153), "#95B3D7");
  assert.equal(RT.transformThemeColor("#4F81BD", 153, 0), "#95B3D7");
  assert.equal(RT.transformThemeColor("#ABCDEF", 0), "#FFFFFF");
  assert.equal(RT.transformThemeColor("#ABCDEF", undefined, 0), "#000000");
  for (const c of [
    "#000000",
    "#FFFFFF",
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#123456",
  ]) {
    assert.equal(RT.transformThemeColor(c, 255), c);
    assert.equal(RT.transformThemeColor(c, undefined, 255), c);
  }
  assert.equal(RT.transformThemeColor("#808080", undefined, 128), "#404040");
});
test("semantic roles map once to physical slots; literal physical names bypass mapping", () => {
  const t = theme();
  t.ColorMap = { text1: "accent3", accent1: "accent2", accent2: "accent1" };
  assert.equal(
    RT.resolveDocumentThemeValue(t, "Foreground", color("text1")),
    t.Colors.accent3,
  );
  assert.equal(
    RT.resolveDocumentThemeValue(t, "Foreground", color("dark1")),
    t.Colors.dark1,
  );
  assert.equal(
    RT.resolveDocumentThemeValue(t, "Foreground", color("accent1")),
    t.Colors.accent2,
  );
  assert.equal(
    RT.resolveDocumentThemeValue(t, "Foreground", color("accent2")),
    t.Colors.accent1,
  );
});
test("missing theme uses the final cached fallback without tinting it twice", () => {
  assert.equal(
    RT.resolveDocumentThemeValue(
      null,
      "Foreground",
      color("accent1", { Tint: 153, Fallback: "#95B3D7" }),
    ),
    "#95B3D7",
  );
  assert.equal(
    RT.resolveDocumentThemeValue(null, "FontFamily", font("Major", "Georgia")),
    "Georgia",
  );
  assert.equal(RT.resolveDocumentThemeValue(null, "Foreground", "red"), "red");
});
test("local theme references remain symbolic while public model values resolve live", () => {
  const { engine, run, fixed } = make();
  const original = run.ReadLocalValue("Foreground");
  assert.equal(run.Foreground, theme().Colors.accent1);
  assert.equal(run.FontFamily, "Arial");
  assert.equal(run.GetValueSource("Foreground").BaseValueSource, "Local");
  assert.equal(run.GetValueSource("Foreground").IsCoerced, false);
  engine.SetDocumentTheme(theme("Editorial"));
  assert.equal(run.Foreground, theme("Editorial").Colors.accent1);
  assert.equal(run.FontFamily, "Georgia");
  assert.equal(run.ReadLocalValue("Foreground"), original);
  assert.equal(fixed.Foreground, "#ABCDEF");
  assert.equal(fixed.FontFamily, "Verdana");
});
test("theme changes invalidate inheritance and cached root values without named styles", () => {
  const p = new Paragraph(new Run("Body")),
    e = new RichTextEngine(new FlowDocument(p));
  e.Document.Foreground = color("text1");
  e.Document.FontFamily = font("Minor");
  e.SetDocumentTheme(theme());
  const run = p.Inlines.Get(0) as RT.Run;
  assert.equal(run.Foreground, theme().Colors.dark1);
  const t = theme();
  t.Colors.dark1 = "#123123";
  t.Fonts.Minor = "Verdana";
  e.SetDocumentTheme(t);
  assert.equal(run.Foreground, "#123123");
  assert.equal(run.FontFamily, "Verdana");
  assert.equal(p.GetValueSource("Foreground").BaseValueSource, "Inherited");
});
test("selection and collapsed typing properties return resolved values", () => {
  const { engine } = make();
  engine.Select(1);
  assert.equal(engine.GetProperty("Foreground"), theme().Colors.accent1);
  engine.ApplyProperty("FontFamily", font("Minor"));
  const t = theme();
  t.Fonts.Minor = "Georgia";
  engine.SetDocumentTheme(t);
  assert.equal(engine.GetProperty("FontFamily"), "Georgia");
  engine.InsertText("X");
  assert.equal(engine.Selection.GetPropertyValue("FontFamily"), "Georgia");
  assert(
    leaves(engine.Document.ToJSON()).some(
      (l) =>
        l.node.text?.includes("X") &&
        RT.parseThemeFont(l.node.props.FontFamily),
    ),
  );
});
test("mixed theme and literal ranges compare effective values rather than tokens", () => {
  const a = new Run("A"),
    b = new Run("B");
  a.Foreground = color("accent1");
  b.Foreground = theme().Colors.accent1;
  const e = new RichTextEngine(new FlowDocument(new Paragraph([a, b])));
  e.SetDocumentTheme(theme());
  e.Select(0, 2);
  assert.equal(e.GetProperty("Foreground"), theme().Colors.accent1);
  e.SetDocumentTheme(theme("Forest"));
  assert.equal(e.GetProperty("Foreground"), undefined);
});
test("theme changes cascade through named styles without overriding local text", () => {
  const e = new RichTextEngine(RT.fromText("Title\nBody text"));
  themedStyle(e);
  e.SetDocumentTheme(theme());
  e.Select(0);
  e.ApplyParagraphStyle("Title");
  e.Select(6, 10);
  e.ApplyCharacterStyle("Accent");
  e.Select(11, 15);
  e.ApplyProperty("Foreground", "#0000FF");
  e.SetDocumentTheme(theme("Editorial"));
  e.Select(1);
  assert.equal(e.GetProperty("FontFamily"), "Georgia");
  assert.equal(e.GetProperty("Foreground"), theme("Editorial").Colors.accent1);
  e.Select(7);
  assert.equal(e.GetProperty("Foreground"), theme("Editorial").Colors.accent2);
  e.Select(12);
  assert.equal(e.GetProperty("Foreground"), "#0000FF");
  assert.equal(e.ResolveDocumentStyle("Body").Foreground, color("text1"));
});
test("theme editing is one undo/redo action and preserves IDs, annotations and selection", () => {
  const { engine, run } = make();
  engine.Select(1, 5);
  engine.AddBookmark("mark");
  engine.ClearUndo();
  const before = engine.Document.ToJSON();
  engine.SetDocumentTheme(theme("Forest"));
  assert.equal(engine.Selection.Start.Offset, 1);
  assert.equal(engine.Selection.End.Offset, 5);
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.Document.FindById(run.Id), run);
  assert.equal(engine.CanUndo, false);
  engine.Redo();
  assert.equal(run.Foreground, theme("Forest").Colors.accent1);
});
test("theme inspection returns detached values; schema failures leave history untouched", () => {
  const { engine } = make();
  const t = engine.GetDocumentTheme()!;
  t.Colors.accent1 = "#000000";
  assert.equal(
    engine.GetDocumentTheme()!.Colors.accent1,
    theme().Colors.accent1,
  );
  const before = engine.Document.ToJSON();
  assert.throws(() =>
    engine.SetDocumentTheme({
      ...theme(),
      Fonts: { Major: "", Minor: "Arial" },
    }),
  );
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.CanUndo, false);
});
test("clearing a theme restores fallbacks but leaves references available for reassignment", () => {
  const { engine, run } = make();
  engine.SetDocumentTheme(null);
  assert.equal(run.Foreground, "#123456");
  assert.equal(run.FontFamily, "Courier New");
  engine.SetDocumentTheme(theme("Editorial"));
  assert.equal(run.FontFamily, "Georgia");
});
test("detaching freezes theme references in styles, stories, local values and typing atomically", () => {
  const { engine, run } = make();
  themedStyle(engine);
  const header = new Paragraph(new Run("Header"));
  header.Foreground = color("accent2");
  new RT.DocumentFeatures(engine).SetStory("Headers", [header.ToJSON()]);
  engine.Select(2);
  engine.ApplyProperty("Foreground", color("accent3"));
  engine.ClearUndo();
  const before = engine.Document.ToJSON();
  engine.DetachDocumentTheme();
  assert.equal(engine.GetDocumentTheme(), null);
  assert.equal(run.ReadLocalValue("Foreground"), theme().Colors.accent1);
  assert.equal(
    engine.GetDocumentStyles()[0].Properties.Foreground,
    theme().Colors.dark1,
  );
  assert.equal(
    engine.Document.GetValue("Headers")[0].props.Foreground,
    theme().Colors.accent2,
  );
  assert.equal(engine.GetProperty("Foreground"), theme().Colors.accent3);
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.GetProperty("Foreground"), theme().Colors.accent3);
  engine.Redo();
  engine.SetDocumentTheme(theme("Forest"));
  assert.equal(run.Foreground, theme().Colors.accent1);
});
test("document theme is available inside independent story drafts and conflicts are detected", () => {
  const { engine } = make();
  const header = new Paragraph(new Run("Header"));
  header.Foreground = color("accent1");
  new RT.DocumentFeatures(engine).SetStory("Headers", [header.ToJSON()]);
  const session = new RT.DocumentStorySession(engine, "Headers");
  assert.equal(
    session.Document.Blocks.Get(0).GetValue("Foreground"),
    theme().Colors.accent1,
  );
  engine.SetDocumentTheme(theme("Forest"));
  assert.equal(session.HasConflict, true);
  assert.throws(() => session.Apply());
  session.Dispose();
});
test("theme tokens materialize for markup without changing their owned source", () => {
  const { engine } = make();
  const before = engine.Document.ToJSON(),
    html = RT.toHTML(engine.Document);
  assert(html.includes(theme().Colors.accent1));
  assert(!/style="[^"]*theme:/.test(html));
  assert.deepEqual(engine.Document.ToJSON(), before);
  const detached = materializeDocumentStyles(before);
  assert.equal(
    detached.children![0].children![0].props.Foreground,
    theme().Colors.accent1,
  );
});
test("generic property setters reject malformed theme data before changing the model", () => {
  const { engine, run } = make();
  const before = engine.Document.ToJSON();
  assert.throws(() => (run.Foreground = "theme:color:bad"));
  assert.throws(() =>
    engine.Document.SetValue("DocumentTheme", { Name: "Bad" }),
  );
  assert.throws(() =>
    engine.SetDocumentStyle({
      Id: "Bad",
      Name: "Bad",
      Kind: "Character",
      Properties: { Foreground: "theme:font:Minor:Arial" },
    }),
  );
  assert.deepEqual(engine.Document.ToJSON(), before);
});
test("whole-theme property changes synchronize through existing collaboration with undo", () => {
  const { engine } = make();
  const a = new RT.CollaborativeDocumentSession({
      DocumentId: "theme",
      ActorId: "a",
      Document: engine.Document.ToJSON(),
    }),
    b = new RT.CollaborativeDocumentSession({
      DocumentId: "theme",
      ActorId: "b",
      Document: engine.Document.ToJSON(),
    });
  const ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document),
    ba = a.BindEngine(ea),
    bb = b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.SetDocumentTheme(theme("Forest"));
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  eb.Select(2);
  assert.equal(eb.GetProperty("Foreground"), theme("Forest").Colors.accent1);
  ea.Undo();
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  ba.Dispose();
  bb.Dispose();
});
test("public-API sample changes the linked title and keeps its direct brand color", () => {
  const e = new RichTextEngine(createThemesSample(RT));
  const before = e.Document.ToJSON();
  e.SetDocumentTheme(theme("Editorial"));
  e.Select(1);
  assert.equal(e.GetProperty("Foreground"), theme("Editorial").Colors.accent1);
  assert.equal(e.GetProperty("FontFamily"), "Georgia");
  e.Select(e.Document.Text.indexOf("Fixed brand color") + 2);
  assert.equal(e.GetProperty("Foreground"), "#702A9D");
  e.Undo();
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("host style/trigger/current-value layers resolve theme tokens with correct value sources", () => {
  const { engine, run } = make();
  run.ClearValue("Foreground");
  run.SetStyleValue("Foreground", color("accent2"));
  assert.equal(run.Foreground, theme().Colors.accent2);
  assert.equal(run.GetValueSource("Foreground").BaseValueSource, "Style");
  run.SetStyleValue("Foreground", color("accent3"), true);
  assert.equal(run.Foreground, theme().Colors.accent3);
  run.SetCurrentValue("Foreground", color("accent4"));
  assert.equal(run.Foreground, theme().Colors.accent4);
  // Direct model changes keep transient host layers; engine reconciliation intentionally restores canonical state.
  engine.Document.SetValue("DocumentTheme", theme("Forest"));
  assert.equal(run.Foreground, theme("Forest").Colors.accent4);
  assert.equal(
    run.GetValueSource("Foreground").BaseValueSource,
    "StyleTrigger",
  );
});
test("remounting themed nodes resolves against their new owner instead of a cached old palette", () => {
  const { engine, run } = make(),
    other = new FlowDocument();
  other.SetValue("DocumentTheme", theme("Forest"));
  const block = engine.Document.Blocks.Get(0);
  engine.Document.Blocks.Remove(block);
  other.Blocks.Add(block);
  assert.equal(run.Foreground, theme("Forest").Colors.accent1);
});
test("theming a content-locked control is distinct from changing its stored formatting", () => {
  const e = new RichTextEngine(new FlowDocument(new Paragraph()));
  e.SetDocumentTheme(theme());
  const id = e.InsertContentControl(
    { Kind: "RichText", Tag: "locked" },
    "Text",
  );
  e.SelectContentControl(id);
  e.ApplyProperty("Foreground", color("accent1"));
  e.SetContentControlProperties(id, { LockContents: true });
  e.ClearUndo();
  const before = e.Document.ToJSON();
  assert.throws(() => e.DetachDocumentTheme());
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.equal(e.CanUndo, false);
  e.SetDocumentTheme(theme("Forest"));
  e.Select(e.GetContentControls()[0].Start! + 1);
  assert.equal(e.GetProperty("Foreground"), theme("Forest").Colors.accent1);
});
test("changed theme definitions in a header draft cannot silently overwrite the owner", () => {
  const { engine } = make();
  const session = new RT.DocumentStorySession(engine, "Headers"),
    before = engine.Document.ToJSON();
  session.Engine.SetDocumentTheme(theme("Forest"));
  session.Engine.InsertText("Header");
  assert.throws(() => session.Apply(), /style\/theme/);
  assert.deepEqual(engine.Document.ToJSON(), before);
  session.Cancel();
});
test("empty theme document and restored fallback tokens retain no-op history behavior", () => {
  const e = new RichTextEngine();
  e.DetachDocumentTheme();
  assert.equal(e.CanUndo, false);
  e.SetDocumentTheme(theme());
  e.ClearUndo();
  e.SetDocumentTheme(theme());
  assert.equal(e.CanUndo, false);
  e.Select(0);
  e.ApplyProperty("Foreground", color("accent1"));
  e.InsertText("X");
  e.ClearUndo();
  e.DetachDocumentTheme();
  assert.equal(e.GetDocumentTheme(), null);
  e.Undo();
  assert.equal(e.GetDocumentTheme()!.Name, "Studio");
});
test("creating and updating styles from homogeneous themed text preserves symbolic links", () => {
  const { engine } = make();
  engine.Select(0, 6);
  engine.CreateDocumentStyleFromSelection("Linked", "Linked", "Character");
  assert.equal(
    RT.parseThemeColor(engine.ResolveDocumentStyle("Linked").Foreground)!.Color,
    "accent1",
  );
  assert.equal(
    RT.parseThemeFont(engine.ResolveDocumentStyle("Linked").FontFamily)!.Font,
    "Major",
  );
  engine.ApplyProperty("Foreground", color("accent2"));
  engine.UpdateDocumentStyleFromSelection("Linked");
  assert.equal(
    RT.parseThemeColor(engine.ResolveDocumentStyle("Linked").Foreground)!.Color,
    "accent2",
  );
});
test("capturing differently sourced but equally colored text avoids inventing a theme binding", () => {
  const a = new Run("A"),
    b = new Run("B");
  a.Foreground = color("accent1");
  b.Foreground = theme().Colors.accent1;
  const e = new RichTextEngine(new FlowDocument(new Paragraph([a, b])));
  e.SetDocumentTheme(theme());
  e.Select(0, 2);
  e.CreateDocumentStyleFromSelection("Mixed", "Mixed", "Character");
  assert.equal(
    e.ResolveDocumentStyle("Mixed").Foreground,
    theme().Colors.accent1,
  );
});
