/** This sample uses only public RichTextWeb engine APIs, without the Studio UI. */
export function createStylesSample(RT) {
  const doc = RT.fromText(
    "Styles that stay connected\nChange one definition, update every paragraph using it.\nShared formatting\nThis paragraph follows the Body style. Direct emphasis is kept separate.\nThis second paragraph also follows Body.\nAn inherited quotation style changes only a few properties.\nReview the highlighted text, then open Home → Manage styles.",
  );
  doc.PagePadding = new RT.Thickness(56);
  doc.SetValue("Title", "Named document styles");
  const engine = new RT.RichTextEngine(doc);
  engine.SetDocumentStyles([
    {
      Id: "Body",
      Name: "Body text",
      Kind: "Paragraph",
      IsDefault: true,
      Properties: {
        FontFamily: "Calibri",
        FontSize: 17,
        Foreground: "#283548",
        Margin: { Top: 0, Bottom: 12 },
        LineHeight: 25,
      },
    },
    {
      Id: "ReportTitle",
      Name: "Report title",
      Kind: "Paragraph",
      BasedOn: "Body",
      Next: "Body",
      Properties: {
        FontSize: 36,
        FontWeight: "Bold",
        Foreground: "#174b75",
        HeadingLevel: 1,
        KeepWithNext: true,
        LineHeight: 44,
      },
    },
    {
      Id: "SectionTitle",
      Name: "Section heading",
      Kind: "Paragraph",
      BasedOn: "Body",
      Next: "Body",
      Properties: {
        FontSize: 24,
        FontWeight: "Bold",
        Foreground: "#174b75",
        HeadingLevel: 2,
        KeepWithNext: true,
        LineHeight: 30,
      },
    },
    {
      Id: "Quotation",
      Name: "Quotation",
      Kind: "Paragraph",
      BasedOn: "Body",
      Next: "Body",
      Properties: {
        FontStyle: "Italic",
        Foreground: "#506075",
        Margin: { Left: 24, Top: 12, Bottom: 20, Right: 24 },
      },
    },
    {
      Id: "Accent",
      Name: "Accent",
      Kind: "Character",
      Properties: { Foreground: "#9b3c27", FontStyle: "Italic" },
    },
    {
      Id: "StrongAccent",
      Name: "Strong accent",
      Kind: "Character",
      BasedOn: "Accent",
      Properties: { FontWeight: "Bold" },
    },
  ]);
  const paragraphStyle = (text, style) => {
    engine.Select(doc.Text.indexOf(text));
    engine.ApplyParagraphStyle(style);
  };
  paragraphStyle("Styles that stay connected", "ReportTitle");
  paragraphStyle("Shared formatting", "SectionTitle");
  paragraphStyle("An inherited quotation", "Quotation");
  const selected = doc.Text.indexOf("highlighted text");
  engine.Select(selected, selected + "highlighted text".length);
  engine.ApplyCharacterStyle("StrongAccent");
  const direct = doc.Text.indexOf("Direct emphasis");
  engine.Select(direct, direct + "Direct emphasis".length);
  engine.ApplyProperty("FontWeight", "Bold");
  engine.ClearUndo();
  engine.Dispose();
  return doc;
}
