import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { FlowDocument, Paragraph, RichTextEngine } from "../src/core.js";
import { toDOCX, fromDOCX } from "../src/formats.js";

for (const [property, value] of [
  ["LineHeight", 24],
  ["TextIndent", -12],
] as const) {
  test(`native ${property}-only paragraph properties do not erase named margins`, async () => {
    const engine = new RichTextEngine(
      new FlowDocument(new Paragraph("Styled text")),
    );
    engine.SetDocumentStyles([
      {
        Id: "Body",
        Name: "Body",
        Kind: "Paragraph",
        IsDefault: true,
        Properties: { Margin: { Top: 4, Bottom: 8, Left: 10, Right: 12 } },
      },
    ]);
    engine.SetParagraphProperty(property, value);
    const zip = await JSZip.loadAsync(await toDOCX(engine.Document));
    zip.remove("customXml/richtextweb-review.xml");
    const document = await fromDOCX(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const paragraph = document.Blocks.Get(0) as Paragraph;
    assert.equal(paragraph.GetValue(property), value);
    assert.equal(Object.hasOwn(paragraph.ToJSON().props, "Margin"), false);
    assert.deepEqual(paragraph.Margin, {
      Top: 4,
      Bottom: 8,
      Left: 10,
      Right: 12,
    });
    const imported = new RichTextEngine(document);
    const style = imported
      .GetDocumentStyles()
      .find((style) => style.Id === "Body")!;
    imported.SetDocumentStyle({
      ...style,
      Properties: { Margin: { Top: 20, Bottom: 30 } },
    });
    assert.deepEqual((imported.Document.Blocks.Get(0) as Paragraph).Margin, {
      Top: 20,
      Bottom: 30,
    });
    imported.Undo();
    assert.deepEqual((imported.Document.Blocks.Get(0) as Paragraph).Margin, {
      Top: 4,
      Bottom: 8,
      Left: 10,
      Right: 12,
    });
  });
}
