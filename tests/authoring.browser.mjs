import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

/** Browser measurements, real editing gestures, independent print-parser checks. */
export async function runAuthoringBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const R = richTextStudio.RT;
    const e = document.createElement("rich-text-page-editor");
    e.id = "authoring-test-editor";
    e.style.cssText =
      "position:fixed;left:24px;top:24px;width:1000px;height:690px;z-index:12000;background:white";
    document.body.append(e);
    window.authoringEditor = e;
    window.authoringDoc = (columns = 2) => {
      const d = new R.FlowDocument();
      d.PageWidth = 620;
      d.PageHeight = 450;
      d.PagePadding = new R.Thickness(30);
      d.ColumnGap = 25;
      d.SetValue("ColumnCount", columns);
      for (let i = 0; i < 5; i++) {
        const p = new R.Paragraph("Chapter " + i);
        if (i === 1 || i === 3) p.BreakPageBefore = true;
        d.Blocks.Add(p);
      }
      return d;
    };
  });
  const editor = page.locator("#authoring-test-editor");
  try {
    for (const columns of [1, 2, 3]) {
      const layout = await page.evaluate(async (columns) => {
        const e = authoringEditor;
        e.Document = authoringDoc(columns);
        const layout = await e.Repaginate();
        return {
          pages: layout.Pages.map((p) =>
            e.Text.slice(p.StartOffset, p.EndOffset),
          ),
          count: e.PageCount,
          columns: layout.ColumnCount,
        };
      }, columns);
      assert.equal(
        layout.count,
        3,
        `Forced physical pages with ${columns} columns`,
      );
      assert.ok(layout.pages[0].startsWith("Chapter 0"));
      assert.ok(layout.pages[1].startsWith("Chapter 1"));
      assert.ok(layout.pages[2].startsWith("Chapter 3"));
    }
    results.push(
      "Physical page breaks remain page breaks with one, two and three text columns",
    );
    const columnBreak = await page.evaluate(async () => {
      const e = authoringEditor,
        d = authoringDoc(2);
      d.Blocks.Get(1).BreakPageBefore = false;
      d.Blocks.Get(1).SetValue("BreakColumnBefore", true);
      e.Document = d;
      const layout = await e.Repaginate();
      return {
        count: layout.PageCount,
        text: e.Text.slice(
          layout.Pages[0].StartOffset,
          layout.Pages[0].EndOffset,
        ),
      };
    });
    assert.equal(columnBreak.count, 2);
    assert.ok(columnBreak.text.includes("Chapter 1"));
    results.push(
      "Column break advances within the sheet, distinct from physical page break",
    );
    const cached = await page.evaluate(async () => {
      const e = authoringEditor;
      await e.Repaginate();
      const before = e.PaginationStatistics.LayoutPasses;
      for (let i = 0; i < 25; i++) {
        e.Select(i);
        await e.Repaginate();
      }
      const after = e.PaginationStatistics.LayoutPasses;
      e.Select(1);
      e.Engine.InsertText("X");
      await e.Repaginate();
      return { before, after, edited: e.PaginationStatistics.LayoutPasses };
    });
    assert.equal(cached.before, cached.after);
    assert.ok(cached.edited > cached.after);
    results.push(
      "Twenty-five caret moves reuse geometry; document editing invalidates cached layout",
    );
    await page.evaluate(() => {
      authoringEditor.Select(2);
      window.authoringOriginal = authoringEditor.Text;
    });
    for (const mode of [
      "WebLayout",
      "Draft",
      "Outline",
      "ReadMode",
      "PrintLayout",
    ]) {
      const state = await page.evaluate(async (mode) => {
        const e = authoringEditor;
        const original = e.Engine;
        e.DocumentView = mode;
        await new Promise((r) => requestAnimationFrame(r));
        if (e.ViewMode === "page") await e.Repaginate();
        return {
          sameEngine: original === e.Engine,
          sameText: e.Text === authoringOriginal,
          selection: e.Selection.Start.Offset,
          readOnly: e.IsReadOnly,
          columns:
            e.shadowRoot.querySelector("[part=editor]").style.columnCount,
        };
      }, mode);
      assert.ok(state.sameEngine && state.sameText);
      assert.equal(state.selection, 2);
      assert.equal(state.readOnly, mode === "ReadMode");
      if (["WebLayout", "Draft", "Outline"].includes(mode))
        assert.equal(state.columns, "");
    }
    const locked = await page.evaluate(() => {
      const e = authoringEditor;
      e.IsReadOnly = true;
      e.DocumentView = "ReadMode";
      e.DocumentView = "PrintLayout";
      const locked = e.IsReadOnly;
      e.IsReadOnly = false;
      return locked;
    });
    assert.ok(locked);
    results.push(
      "Five view modes preserve document, engine, selection and the host read-only policy",
    );
    for (const arrangement of [
      "SinglePage",
      "TwoPages",
      "Vertical",
      "MultiplePages",
    ]) {
      const state = await page.evaluate(async (arrangement) => {
        const e = authoringEditor;
        e.PageArrangement = arrangement;
        await e.Repaginate();
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        return {
          stats: e.PaginationStatistics,
          live: e.shadowRoot.querySelectorAll("[part=editor]").length,
          slots: e.shadowRoot.querySelectorAll(".rt-page-slot").length,
        };
      }, arrangement);
      assert.equal(state.live, 1);
      assert.ok(state.stats.RealizedPagePreviews <= 8);
      assert.equal(
        state.slots,
        arrangement === "SinglePage" ? 0 : state.stats.TotalPages,
      );
    }
    results.push(
      "Four page arrangements retain one live editor and bound preview realization",
    );
    const fit = await page.evaluate(() => {
      const e = authoringEditor;
      e.PageArrangement = "SinglePage";
      e.ZoomMode = "WholePage";
      const whole = e.Zoom;
      e.ZoomMode = "PageWidth";
      const wide = e.Zoom;
      e.ZoomMode = "TwoPages";
      const two = e.Zoom;
      e.ZoomMode = "Custom";
      e.Zoom = 1;
      return { whole, wide, two };
    });
    assert.ok(fit.whole > 0 && fit.wide > 0 && fit.two > 0);
    assert.ok(fit.wide > fit.two);
    results.push(
      "Whole-page, page-width and two-page fitting use actual control viewport dimensions",
    );
    const prints = await page.evaluate(async () => {
      const e = authoringEditor;
      e.Document = authoringDoc(2);
      await e.Repaginate();
      return {
        count: e.PageCount,
        html: await e.GetPrintHTML(),
        range: await e.GetPrintHTML({
          StartPage: 2,
          EndPage: 3,
          Title: "Range <safe>",
        }),
      };
    });
    const printContext = await page.context().browser().newContext();
    const print = await printContext.newPage();
    try {
      await print.setContent(prints.html);
      const pdf = await PDFDocument.load(
        await print.pdf({ preferCSSPageSize: true, printBackground: true }),
      );
      assert.equal(pdf.getPageCount(), prints.count);
      await print.setContent(prints.range);
      const rangePDF = await PDFDocument.load(
        await print.pdf({ preferCSSPageSize: true }),
      );
      assert.equal(rangePDF.getPageCount(), 2);
      assert.equal(await print.title(), "Range <safe>");
    } finally {
      await printContext.close();
    }
    results.push(
      "Independently parsed browser PDF page counts equal measured sheets and selected page ranges",
    );
    await page.evaluate(() => {
      const e = authoringEditor;
      e.PageArrangement = "SinglePage";
      e.Document = richTextStudio.RT.fromText("Before after");
      e.Select(7);
      e.Focus();
    });
    await editor.locator("[part=editor]").press("Control+Enter");
    assert.equal(
      await page.evaluate(() => authoringEditor.Text),
      "Before \nafter",
    );
    assert.ok(
      await page.evaluate(
        () => authoringEditor.Document.Blocks.Get(1).BreakPageBefore,
      ),
    );
    await page.evaluate(() => authoringEditor.Undo());
    assert.equal(
      await page.evaluate(() => authoringEditor.Text),
      "Before after",
    );
    results.push(
      "Keyboard page break inserts at the caret and one undo restores the original paragraph",
    );

    await page.evaluate(() => {
      const e = authoringEditor;
      e.Document = richTextStudio.RT.fromText("Equation: ");
      e.Select(e.Text.length);
      const t = document.createElement("rich-text-toolbar");
      t.id = "authoring-test-toolbar";
      t.Editor = e;
      t.Mode = "all";
      t.style.cssText =
        "position:fixed;left:0;bottom:0;width:100%;z-index:12001";
      document.body.append(t);
      t.Execute("Equation");
    });
    const toolbar = page.locator("#authoring-test-toolbar"),
      workbench = toolbar.locator("rich-equation-editor");
    await workbench
      .getByLabel("Equation templates", { exact: true })
      .selectOption("Matrix");
    await workbench
      .getByLabel("Equation token", { exact: true })
      .selectOption("0");
    await workbench.getByLabel("Symbol text", { exact: true }).fill("z");
    await workbench
      .getByRole("button", { name: "Replace symbol", exact: true })
      .click();
    assert.equal(await workbench.evaluate((e) => e.Format), "mathml");
    assert.ok(await workbench.evaluate((e) => e.IsValid));
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(() => authoringEditor.Text),
      "Equation: \uFFFC",
    );
    assert.ok(await editor.locator("[data-rt-type=Equation] svg").count());
    const atom = await editor
      .locator("[data-rt-type=Equation]")
      .getAttribute("data-rt-id");
    await page.evaluate((id) => authoringEditor.SelectObject(id), atom);
    await page.evaluate(() =>
      document.querySelector("#authoring-test-toolbar").Execute("Equation"),
    );
    await workbench.getByLabel("Equation source", { exact: true }).fill("x^3");
    await workbench
      .getByLabel("Equation input format", { exact: true })
      .selectOption("latex");
    await workbench.getByLabel("Equation source", { exact: true }).fill("x^3");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(
        (id) => authoringEditor.Document.FindById(id).Source,
        atom,
      ),
      "x^3",
    );
    await page.evaluate(() => authoringEditor.Undo());
    assert.match(
      await page.evaluate(
        (id) => authoringEditor.Document.FindById(id).Source,
        atom,
      ),
      />z</,
    );
    results.push(
      "Reusable visual math workbench edits matrix tokens, applies one document atom and supports undo",
    );
    await page.evaluate(() =>
      document.querySelector("#authoring-test-toolbar").Execute("Equation"),
    );
    await workbench
      .getByLabel("Equation source", { exact: true })
      .fill("\\unknownunsafecommand");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.ok(await toolbar.locator("dialog").evaluate((e) => e.open));
    await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.evaluate(() => authoringEditor.Text),
      "Equation: \uFFFC",
    );
    results.push(
      "Invalid equation submission and cancellation leave the original document unchanged",
    );
    await page.evaluate(() => {
      const w = document.createElement("rich-equation-editor");
      w.id = "standalone-math-test";
      w.style.cssText = "position:fixed;inset:0;z-index:14000;background:white";
      document.body.append(w);
    });
    const standalone = page.locator("#standalone-math-test");
    await standalone.getByLabel("Equation source", { exact: true }).fill("x+1");
    await standalone
      .getByLabel("Equation source", { exact: true })
      .dispatchEvent("change");
    assert.ok(
      await standalone
        .getByRole("button", { name: "Undo", exact: true })
        .isEnabled(),
    );
    await standalone.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await standalone.evaluate((e) => e.Source), "x");
    assert.ok(
      await standalone
        .getByRole("button", { name: "Redo", exact: true })
        .isEnabled(),
    );
    results.push(
      "Standalone equation control exposes live validation and independent local undo/redo",
    );
    return results;
  } finally {
    await page.evaluate(() => {
      for (const id of [
        "standalone-math-test",
        "authoring-test-toolbar",
        "authoring-test-editor",
      ]) {
        const e = document.getElementById(id);
        e?.Dispose?.();
        e?.remove();
      }
    });
  }
}
