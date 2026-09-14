import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  FlowDocument,
  Paragraph,
  Run,
  Equation,
  Section,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import { DocumentFeatures, createField } from "../src/document-features.js";
import { DocumentStorySession } from "../src/story-session.js";
import {
  validatePageSetup,
  pageMargins,
  pageStoryKey,
  documentPageNumber,
  type PageSetupOptions,
} from "../src/page-setup.js";
import { pageSettings } from "../src/pagination.js";
import { pagePreviewWindow } from "../src/page-window.js";
import { RichTextBox } from "../src/control.js";
import { BridgeProtocol, RichTextWebBridge } from "../src/bridge.js";
import { toDOCX, fromDOCX } from "../src/formats.js";

const body = () =>
  new RichTextEngine(new FlowDocument(new Paragraph("Body text")));
const snapshot = (e: RichTextEngine) => ({
  document: e.Document.ToJSON(),
  revision: e.Document.Revision,
  undo: e.CanUndo,
  redo: e.CanRedo,
  selection: e.Selection.Start.Offset,
});
const blocks = (text: string) => [new Paragraph(text).ToJSON()];

test("page setup preserves individual margins, body identity, selection, metadata and one undo unit", () => {
  const e = body(),
    d = e.Document,
    paragraph = d.Blocks.Get(0);
  d.PagePadding = { Left: 36, Top: 60, Right: 40, Bottom: 55 };
  d.SetValue("Title", "Keep me");
  e.Select(3);
  const before = snapshot(e);
  e.Execute("SetPageSetup", {
    PageWidth: 900,
    PageHeight: 1200,
    ColumnCount: 2,
    ColumnGap: 24,
  });
  assert.equal(e.Document, d);
  assert.equal(d.Blocks.Get(0), paragraph);
  assert.equal(e.Selection.Start.Offset, 3);
  assert.equal(d.GetValue("Title"), "Keep me");
  assert.deepEqual(d.PagePadding, before.document.props.PagePadding);
  assert.equal(d.PageWidth, 900);
  assert.equal(e.Undo(), true);
  assert.deepEqual(d.ToJSON(), before.document);
  assert.equal(e.Undo(), false);
  assert.equal(e.Redo(), true);
  assert.equal(d.ColumnCount, 2);
  e.Dispose();
});
const invalid: Record<string, unknown>[] = [
  { PageWidth: 0 },
  { PageHeight: Infinity },
  { PagePadding: -1 },
  { PagePadding: { Left: 40, Top: 40, Right: 40 } },
  { PagePadding: { Left: 400, Top: 30, Right: 400, Bottom: 30 } },
  { ColumnCount: 1.5 },
  { ColumnCount: 13 },
  { ColumnGap: 600, ColumnCount: 3 },
  { HeaderDistance: 100 },
  { FooterDistance: -2 },
  { PageNumberStart: 0 },
  { DifferentFirstPage: "yes" },
  { UnknownProperty: true },
  { PageWidth: undefined },
];
for (const options of invalid)
  test(`page setup rejects ${JSON.stringify(options)} without mutation`, () => {
    const e = body(),
      before = snapshot(e);
    assert.throws(() => e.SetPageSetup(options as PageSetupOptions));
    assert.deepEqual(snapshot(e), before);
    e.Dispose();
  });
test("page setup helpers copy margins and reject nonnumeric values", () => {
  const input = { PagePadding: { Left: 20, Top: 40, Right: 20, Bottom: 40 } };
  const result = validatePageSetup({}, input);
  input.PagePadding.Left = 77;
  assert.equal((result.PagePadding as any).Left, 20);
  assert.deepEqual(pageMargins(5), { Left: 5, Top: 5, Right: 5, Bottom: 5 });
  assert.throws(() => pageMargins("12"));
});
test("page setup uses the same native command and control read-only guards", () => {
  const e = body();
  let locked = false;
  const bridge = new RichTextWebBridge(e, () => {}, {
    isReadOnly: () => locked,
  });
  const call = () =>
    bridge.HandleMessage({
      ...BridgeProtocol,
      kind: "request",
      id: "page",
      method: "execute",
      params: { command: "SetPageSetup", parameter: { PageWidth: 850 } },
    });
  assert.equal(call().error, undefined);
  assert.equal(e.Document.PageWidth, 850);
  locked = true;
  assert.equal(call().error?.code, "read_only");
  const control = new RichTextBox();
  control.IsReadOnly = true;
  assert.equal(control.Execute("SetPageSetup", { PageWidth: 900 }), false);
  assert.equal(control.Document.PageWidth, 794);
  control.Dispose();
  bridge.Dispose();
  e.Dispose();
});
test("rich story editing preserves formatting, fields and equations with parent undo/redo", () => {
  const e = body(),
    features = new DocumentFeatures(e);
  const bold = new Run("Heading");
  bold.FontWeight = "Bold";
  features.SetStory("Headers", [
    new Paragraph([bold, createField("PAGE"), new Equation("x^2")]).ToJSON(),
  ]);
  e.ClearUndo();
  const before = e.Document.ToJSON();
  const session = new DocumentStorySession(e, "Headers");
  session.Engine.Select(0);
  session.Engine.InsertText("Prefix ");
  assert.deepEqual(e.Document.ToJSON(), before, "Draft must not mutate parent");
  assert.equal(session.Apply(), true);
  assert.equal(session.IsClosed, true);
  const header = e.Document.GetValue("Headers");
  assert.ok(JSON.stringify(header).includes("EquationSource"));
  assert.ok(JSON.stringify(header).includes("FontWeight"));
  assert.ok(JSON.stringify(header).includes("PAGE"));
  assert.equal(e.Undo(), true);
  assert.deepEqual(e.Document.ToJSON(), before);
  assert.equal(e.Undo(), false);
  assert.equal(e.Redo(), true);
  assert.throws(() => session.Apply(), /closed/);
  e.Dispose();
});
test("story cancellation, unchanged apply and repeated disposal do not add parent history", () => {
  const e = body(),
    before = snapshot(e);
  const unchanged = new DocumentStorySession(e, "Footers");
  assert.equal(unchanged.Apply(), false);
  assert.deepEqual(snapshot(e), before);
  const session = new DocumentStorySession(e, "Headers");
  session.Engine.InsertText("Discard");
  session.Cancel();
  session.Dispose();
  assert.deepEqual(snapshot(e), before);
  e.Dispose();
});
test("a story session allows unrelated body edits and rejects conflicting story replacements", () => {
  const e = body(),
    features = new DocumentFeatures(e);
  features.SetStory("Footers", blocks("Original"));
  e.ClearUndo();
  const first = new DocumentStorySession(e, "Footers");
  first.Engine.InsertText("Edited ");
  e.Select(0);
  e.InsertText("Other ");
  assert.equal(first.HasConflict, false);
  first.Apply();
  assert.equal(e.Document.Text, "Other Body text");
  const second = new DocumentStorySession(e, "Footers");
  second.Engine.InsertText("Must not win ");
  features.SetStory("Footers", blocks("Remote"));
  const before = snapshot(e);
  assert.equal(second.HasConflict, true);
  assert.throws(() => second.Apply(), /changed/);
  assert.deepEqual(snapshot(e), before);
  second.Cancel();
  e.Dispose();
});
test("section-scoped story sessions reject deletion or parent replacement", () => {
  const section = new Section(new Paragraph("Section body")),
    e = new RichTextEngine(new FlowDocument(section));
  const session = new DocumentStorySession(e, "FirstPageHeader", section.Id);
  session.Engine.InsertText("First");
  session.Apply();
  assert.equal(
    section.GetValue("FirstPageHeader")[0].children[0].text,
    "First",
  );
  const deleted = new DocumentStorySession(e, "FirstPageHeader", section.Id);
  e.Document.Blocks.Remove(section);
  assert.equal(deleted.HasConflict, true);
  deleted.Dispose();
  const replaced = new DocumentStorySession(e, "Footers");
  e.SetDocument(new FlowDocument());
  assert.equal(replaced.HasConflict, true);
  replaced.Dispose();
  assert.throws(() => new DocumentStorySession(e, "not-a-story" as any));
  e.Dispose();
});
test("first/even story flags select blank enabled stories and retain disabled stories", () => {
  assert.equal(
    pageStoryKey({ FirstPageHeader: [] }, "Header", 1),
    "FirstPageHeader",
  );
  assert.equal(pageStoryKey({ FirstPageFooter: [] }, "Header", 1), "Headers");
  assert.equal(
    pageStoryKey(
      { FirstPageHeader: [], DifferentFirstPage: false },
      "Header",
      1,
    ),
    "Headers",
  );
  assert.equal(
    pageStoryKey({ DifferentOddAndEvenPages: true }, "Footer", 2),
    "EvenPageFooter",
  );
  assert.equal(
    pageStoryKey(
      { EvenPageFooter: [], DifferentOddAndEvenPages: false },
      "Footer",
      2,
    ),
    "Footers",
  );
  assert.equal(
    pageStoryKey({ DifferentOddAndEvenPages: true }, "Header", 3),
    "Headers",
  );
  assert.equal(documentPageNumber({ PageNumberStart: 7 }, 3), 9);
  assert.throws(() => pageStoryKey({}, "Header", 0));
});
test("DOCX honors explicit first/even flags, empty stories, page numbering and distances", async () => {
  const e = body(),
    f = new DocumentFeatures(e);
  f.SetStory("FirstPageHeader", blocks("Retained but disabled"));
  f.SetStory("EvenPageFooter", blocks("Retained but disabled"));
  f.SetPageSetup({
    DifferentFirstPage: false,
    DifferentOddAndEvenPages: false,
    HeaderDistance: 12,
    FooterDistance: 14,
    PageNumberStart: 7,
  });
  const data = await toDOCX(e.Document),
    zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.ok(!xml.includes("<w:titlePg"));
  assert.match(xml, /w:header="180"/);
  assert.match(xml, /w:footer="210"/);
  assert.match(xml, /w:start="7"/);
  const imported = await fromDOCX(data);
  assert.equal(imported.GetValue("DifferentFirstPage"), false);
  assert.equal(imported.GetValue("DifferentOddAndEvenPages"), false);
  assert.equal(
    imported.GetValue("FirstPageHeader")[0].children[0].text,
    "Retained but disabled",
  );
  f.SetPageSetup({ DifferentFirstPage: true, DifferentOddAndEvenPages: true });
  const enabled = await fromDOCX(await toDOCX(e.Document));
  assert.equal(enabled.GetValue("DifferentFirstPage"), true);
  assert.equal(enabled.GetValue("DifferentOddAndEvenPages"), true);
  e.Dispose();
});
test("WPF preferred column width determines count and fixed width consumes right padding", () => {
  const props = {
    PageWidth: 800,
    PagePadding: 50,
    ColumnWidth: 200,
    ColumnGap: 20,
  };
  const flex = pageSettings(props);
  assert.equal(flex.ColumnCount, 3);
  assert.equal(flex.TextColumnWidth, 220);
  const fixed = pageSettings({ ...props, IsColumnWidthFlexible: false });
  assert.equal(fixed.TextColumnWidth, 200);
  assert.equal(fixed.Padding.Right, 110);
  assert.equal(fixed.ContentWidth, 640);
  assert.equal(pageSettings({ ...props, ColumnCount: 2 }).ColumnCount, 2);
  assert.equal(pageSettings({ ...props, ColumnWidth: 1000 }).ColumnCount, 1);
});
test("very large page windows remain bounded and include distant visible pages", () => {
  const pages = pagePreviewWindow({
    PageCount: 1000000,
    Columns: 2,
    PageHeight: 400,
    ViewportHeight: 900,
    ScrollTop: 424 * 200000,
  });
  assert.ok(pages.includes(400001));
  assert.ok(pages.length < 20);
  assert.equal(new Set(pages).size, pages.length);
});
