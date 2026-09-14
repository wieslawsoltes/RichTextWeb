import assert from "node:assert/strict";

export async function runPageAuthoringBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const R = richTextStudio.RT;
    const host = document.createElement("section");
    host.id = "page-authoring-fixture";
    host.style.cssText =
      "position:fixed;left:5px;top:5px;width:1100px;height:900px;z-index:32000;background:white";
    const e = document.createElement("rich-text-page-editor");
    e.id = "page-authoring-editor";
    e.style.cssText = "width:100%;height:700px";
    const d = new R.FlowDocument(new R.Paragraph("Body for stories"));
    d.PagePadding = new R.Thickness(36, 60, 40, 55);
    e.Document = d;
    const t = document.createElement("rich-text-toolbar");
    t.id = "page-authoring-toolbar";
    t.Editor = e;
    t.Mode = "all";
    host.append(e, t);
    document.body.append(host);
    window.storyEditor = e;
    window.storyToolbar = t;
  });
  const toolbar = page.locator("#page-authoring-toolbar");
  try {
    await page.evaluate(() => storyToolbar.Execute("PageSetup"));
    assert.equal(await toolbar.locator("input[name=Left]").inputValue(), "36");
    assert.equal(
      await toolbar.locator("input[name=Bottom]").inputValue(),
      "55",
    );
    await toolbar.locator("input[name=ColumnCount]").fill("12");
    await toolbar.locator("input[name=ColumnGap]").fill("100");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.match(await toolbar.getByRole("alert").innerText(), /column/i);
    assert.equal(
      await page.evaluate(() => storyEditor.Document.ColumnCount),
      1,
    );
    await toolbar.locator("input[name=ColumnCount]").fill("2");
    await toolbar.locator("input[name=ColumnGap]").fill("20");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    const setup = await page.evaluate(async () => {
      await storyEditor.Repaginate();
      const padding = storyEditor.Document.ToJSON().props.PagePadding;
      const columns = storyEditor.LayoutResult.ColumnCount;
      storyEditor.Undo();
      return { padding, columns, restored: storyEditor.Document.ColumnCount };
    });
    assert.deepEqual(setup, {
      padding: { Left: 36, Top: 60, Right: 40, Bottom: 55 },
      columns: 2,
      restored: 1,
    });
    results.push(
      "Page Setup retains individual margins, reports invalid column geometry inline, and applies one undo unit",
    );

    await page.evaluate(() => {
      const R = richTextStudio.RT;
      const bold = new R.Run("Rich header");
      bold.FontWeight = "Bold";
      new R.DocumentFeatures(storyEditor.Engine).SetStory("Headers", [
        new R.Paragraph([
          bold,
          new R.Run(" "),
          R.createField("PAGE"),
          new R.Equation("x^2"),
        ]).ToJSON(),
      ]);
      storyEditor.Engine.ClearUndo();
      window.originalStory = JSON.stringify(
        storyEditor.Document.GetValue("Headers"),
      );
      storyToolbar.Execute("Header");
    });
    const nested = toolbar.locator("dialog > rich-text-box");
    assert.ok(await nested.locator("[data-rt-type=Equation] svg path").count());
    await nested.evaluate((e) => {
      e.Select(0);
      e.Focus();
    });
    await page.keyboard.type("New ");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.stringify(storyEditor.Document.GetValue("Headers")) ===
          originalStory,
      ),
      true,
    );
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    const saved = await page.evaluate(() => {
      const value = JSON.stringify(storyEditor.Document.GetValue("Headers"));
      storyEditor.Undo();
      return {
        rich:
          value.includes("FontWeight") &&
          value.includes("EquationSource") &&
          value.includes("PAGE"),
        text: value.includes("New "),
        undone:
          JSON.stringify(storyEditor.Document.GetValue("Headers")) ===
          originalStory,
      };
    });
    assert.deepEqual(saved, { rich: true, text: true, undone: true });
    results.push(
      "Real typing edits rich header content without flattening formatting, fields or equations; one undo restores the full story",
    );

    await page.evaluate(async () => {
      await storyEditor.Repaginate();
    });
    await page
      .locator("#page-authoring-editor")
      .locator("[part=page-header]")
      .dblclick();
    await toolbar
      .getByRole("heading", { name: "Edit header", exact: true })
      .waitFor();
    await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.stringify(storyEditor.Document.GetValue("Headers")) ===
          originalStory,
      ),
      true,
    );
    results.push(
      "Double-clicking the rendered page header opens the shared rich story editor; cancel leaves it intact",
    );

    await page.evaluate(() => storyToolbar.Execute("Footer"));
    await toolbar
      .locator("dialog > rich-text-box")
      .evaluate((e) => e.Engine.InsertText("Local draft"));
    await page.evaluate(() =>
      new richTextStudio.RT.DocumentFeatures(storyEditor.Engine).SetStory(
        "Footers",
        [new richTextStudio.RT.Paragraph("Concurrent footer").ToJSON()],
      ),
    );
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.match(await toolbar.getByRole("alert").innerText(), /changed/);
    assert.equal(
      await page.evaluate(
        () => storyEditor.Document.GetValue("Footers")[0].children[0].text,
      ),
      "Concurrent footer",
    );
    await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
    results.push(
      "Conflicting story edits are rejected without overwriting the newer header/footer or losing the draft",
    );

    const storyFlags = await page.evaluate(async () => {
      const R = richTextStudio.RT,
        e = storyEditor,
        d = new R.FlowDocument();
      d.PageWidth = 500;
      d.PageHeight = 400;
      d.PagePadding = 50;
      for (let i = 0; i < 3; i++) {
        const p = new R.Paragraph("Page " + i);
        p.BreakPageBefore = i > 0;
        d.Blocks.Add(p);
      }
      e.Document = d;
      const f = new R.DocumentFeatures(e.Engine);
      f.SetStory("Headers", [
        new R.Paragraph([new R.Run("Number "), R.createField("PAGE")]).ToJSON(),
      ]);
      f.SetStory("FirstPageHeader", [
        new R.Paragraph("Disabled first").ToJSON(),
      ]);
      f.SetPageSetup({
        DifferentFirstPage: false,
        DifferentOddAndEvenPages: false,
        PageNumberStart: 7,
        HeaderDistance: 12,
      });
      await e.Repaginate();
      e.GoToPage(1);
      const first = e.shadowRoot.querySelector("[part=page-header]");
      const state = { first: first.textContent, top: first.style.top };
      f.SetPageSetup({
        DifferentFirstPage: true,
        DifferentOddAndEvenPages: true,
      });
      await e.Repaginate();
      e.GoToPage(1);
      state.enabled = first.textContent;
      e.GoToPage(2);
      state.emptyEven = first.textContent;
      e.GoToPage(3);
      state.third = first.textContent;
      return state;
    });
    assert.deepEqual(storyFlags, {
      first: "Number 7",
      top: "12px",
      enabled: "Disabled first",
      emptyEven: "",
      third: "Number 9",
    });
    results.push(
      "Paper stories respect explicit first/even switches, intentionally blank variants, offsets and page-number starts",
    );

    const sparse = await page.evaluate(async () => {
      const R = richTextStudio.RT,
        d = new R.FlowDocument();
      d.PageWidth = 420;
      d.PageHeight = 350;
      d.PagePadding = 25;
      for (let i = 0; i < 500; i++) {
        const p = new R.Paragraph(`Sheet ${i + 1}`);
        p.BreakPageBefore = i > 0;
        d.Blocks.Add(p);
      }
      storyEditor.Document = d;
      storyEditor.Zoom = 0.5;
      storyEditor.PageArrangement = "MultiplePages";
      await storyEditor.Repaginate();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      return {
        count: storyEditor.PageCount,
        slots: storyEditor.PaginationStatistics.RealizedPageSlots,
      };
    });
    assert.equal(sparse.count, 500);
    assert.ok(sparse.slots < 40, `${sparse.slots} realized slots`);
    const distant = await page.evaluate(async () => {
      const e = storyEditor;
      const before = e.PaginationStatistics.LayoutPasses;
      e.GoToPage(480);
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const viewport = e.shadowRoot
        .querySelector(".viewport")
        .getBoundingClientRect();
      const live = e.shadowRoot
        .querySelector('.rt-page-slot[data-page="480"]')
        .getBoundingClientRect();
      const visible = [
        ...e.shadowRoot.querySelectorAll(".rt-page-slot"),
      ].filter((s) => {
        const b = s.getBoundingClientRect();
        return b.bottom > viewport.top && b.top < viewport.bottom;
      });
      return {
        current: e.PageNumber,
        slots: e.PaginationStatistics.RealizedPageSlots,
        visible: visible.length,
        empty: visible.filter((s) => !s.querySelector(".rt-page-sheet")).length,
        inView: live.bottom > viewport.top && live.top < viewport.bottom,
        sameLayout: before === e.PaginationStatistics.LayoutPasses,
      };
    });
    assert.equal(distant.current, 480);
    assert.ok(distant.slots < 40);
    assert.ok(distant.visible > 0);
    assert.equal(distant.empty, 0);
    assert.equal(distant.inView, true);
    assert.equal(distant.sameLayout, true);
    results.push(
      "A 500-page document keeps bounded page-slot DOM and directly navigates to visible, realized page 480 without remeasuring",
    );

    const fixed = await page.evaluate(async () => {
      const R = richTextStudio.RT,
        d = new R.FlowDocument(new R.Paragraph("Preferred column layout"));
      d.PageWidth = 800;
      d.PageHeight = 500;
      d.PagePadding = 50;
      d.ColumnWidth = 200;
      d.ColumnGap = 20;
      d.IsColumnWidthFlexible = false;
      storyEditor.Document = d;
      storyEditor.PageArrangement = "SinglePage";
      const layout = await storyEditor.Repaginate();
      return {
        columns: layout.ColumnCount,
        width: layout.TextColumnWidth,
        right: layout.Padding.Right,
      };
    });
    assert.deepEqual(fixed, { columns: 3, width: 200, right: 110 });
    results.push(
      "The real page control applies preferred/fixed WPF column widths to measured browser geometry",
    );
    await page.screenshot({ path: "test-results/page-story-authoring.png" });
  } finally {
    await page.evaluate(() => {
      storyToolbar.Dispose();
      storyEditor.Dispose();
      document.getElementById("page-authoring-fixture").remove();
    });
  }
  return results;
}
