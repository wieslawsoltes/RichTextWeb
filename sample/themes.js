/** A theme-connected report built only from the public engine API. */
export function createThemesSample(RT) {
  const document = RT.fromText(
    "One theme, a connected document\nChange the palette and heading font without losing local choices.\nBuilt to adapt\nBody paragraphs share a theme-linked font and text color. Named styles remain independent of direct overrides.\nThis callout follows accent 2 with a light theme tint.\nFixed brand color stays violet when the theme changes.\nOpen Design → Document theme. Preview Editorial or Forest, then apply. Undo restores the entire previous theme.",
  );
  document.PagePadding = new RT.Thickness(56);
  document.SetValue("Title", "Connected document themes");
  const engine = new RT.RichTextEngine(document);
  engine.SetDocumentTheme(RT.createDocumentTheme("Studio"));
  engine.SetDocumentStyles([
    {
      Id: "ThemeBody",
      Name: "Themed body",
      Kind: "Paragraph",
      IsDefault: true,
      Properties: {
        FontFamily: RT.themeFont("Minor"),
        FontSize: 17,
        Foreground: RT.themeColor("text1"),
        LineHeight: 25,
        Margin: { Top: 0, Bottom: 14 },
      },
    },
    {
      Id: "ThemeTitle",
      Name: "Themed title",
      Kind: "Paragraph",
      BasedOn: "ThemeBody",
      Next: "ThemeBody",
      Properties: {
        FontFamily: RT.themeFont("Major"),
        FontSize: 36,
        FontWeight: "Bold",
        Foreground: RT.themeColor("accent1"),
        HeadingLevel: 1,
        KeepWithNext: true,
        LineHeight: 44,
      },
    },
    {
      Id: "ThemeHeading",
      Name: "Themed heading",
      Kind: "Paragraph",
      BasedOn: "ThemeBody",
      Next: "ThemeBody",
      Properties: {
        FontFamily: RT.themeFont("Major"),
        FontSize: 24,
        FontWeight: "Bold",
        Foreground: RT.themeColor("accent1"),
        HeadingLevel: 2,
        KeepWithNext: true,
        LineHeight: 32,
      },
    },
    {
      Id: "ThemeCallout",
      Name: "Themed callout",
      Kind: "Character",
      Properties: {
        Foreground: RT.themeColor("accent2"),
        Background: RT.themeColor("accent2", { Tint: 40 }),
        FontWeight: "Bold",
      },
    },
  ]);
  engine.Select(0);
  engine.ApplyParagraphStyle("ThemeTitle");
  engine.Select(document.Text.indexOf("Built to adapt"));
  engine.ApplyParagraphStyle("ThemeHeading");
  let at = document.Text.indexOf("This callout");
  engine.Select(
    at,
    at + "This callout follows accent 2 with a light theme tint.".length,
  );
  engine.ApplyCharacterStyle("ThemeCallout");
  at = document.Text.indexOf("Fixed brand color");
  engine.Select(at, at + "Fixed brand color stays violet".length);
  engine.ApplyProperty("Foreground", "#702A9D");
  engine.ClearUndo();
  engine.Dispose();
  return document;
}
