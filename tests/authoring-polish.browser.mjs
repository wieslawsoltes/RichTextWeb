import assert from "node:assert/strict";

export async function runAuthoringPolishBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const R = richTextStudio.RT;
    const host = document.createElement("section");
    host.id = "polish-tests";
    host.style.cssText =
      "position:fixed;left:10px;top:10px;width:1100px;height:860px;z-index:30000;background:white";
    const e = document.createElement("rich-text-page-editor");
    e.id = "polish-editor";
    e.style.cssText = "height:820px;width:100%";
    const doc = new R.FlowDocument();
    doc.PageWidth = 420;
    doc.PageHeight = 400;
    doc.PagePadding = new R.Thickness(25);
    for (let i = 0; i < 20; i++) {
      const p = new R.Paragraph(`Sheet ${i + 1} content`);
      p.BreakPageBefore = i > 0;
      doc.Blocks.Add(p);
    }
    e.Document = doc;
    const toolbar = document.createElement("rich-text-toolbar");
    toolbar.id = "polish-toolbar";
    toolbar.Editor = e;
    host.append(e, toolbar);
    document.body.append(host);
    window.polishEditor = e;
  });
  try {
    const realized = await page.evaluate(async () => {
      const e = polishEditor;
      e.PageArrangement = "MultiplePages";
      e.Zoom = 0.5;
      await e.Repaginate();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const viewport = e.shadowRoot
        .querySelector(".viewport")
        .getBoundingClientRect();
      const slots = [...e.shadowRoot.querySelectorAll(".rt-page-slot")].filter(
        (s) => {
          const box = s.getBoundingClientRect();
          return box.top < viewport.bottom && box.bottom > viewport.top;
        },
      );
      return {
        visible: slots.length,
        blank: slots.filter((s) => !s.querySelector(".rt-page-sheet")).length,
        realized: e.PaginationStatistics.RealizedPagePreviews,
        pageCount: e.PageCount,
      };
    });
    assert.equal(realized.pageCount, 20);
    assert.ok(realized.visible > 8);
    assert.equal(
      realized.blank,
      0,
      "Visible small-zoom sheets must not be blank placeholders",
    );
    results.push(
      "Multiple-page view fills every visible sheet beyond the previous eight-preview limit",
    );
    const jump = page
      .locator("#polish-editor")
      .getByRole("spinbutton", { name: "Go to page" });
    await jump.fill("12");
    await jump.press("Enter");
    assert.equal(await page.evaluate(() => polishEditor.PageNumber), 12);
    results.push("Reusable page navigation jumps directly to a numbered sheet");
    const continuous = await page.evaluate(() => {
      const e = polishEditor;
      e.DocumentView = "WebLayout";
      e.Select(0);
      const event = new KeyboardEvent("keydown", {
        key: "PageDown",
        bubbles: true,
        cancelable: true,
      });
      e.shadowRoot.querySelector("[part=editor]").dispatchEvent(event);
      return {
        blocked: event.defaultPrevented,
        offset: e.Selection.Start.Offset,
      };
    });
    assert.equal(continuous.blocked, false);
    assert.equal(continuous.offset, 0);
    results.push(
      "Continuous views retain native PageDown scrolling instead of stale finite-page navigation",
    );
    await page.evaluate(() => {
      const math = document.createElement("rich-equation-editor");
      math.id = "polish-math";
      math.style.cssText =
        "position:fixed;left:30px;top:30px;width:850px;max-height:900px;overflow:auto;z-index:31000;background:white";
      document.body.append(math);
      math.Value = { Source: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}` };
      math.SelectToken(1);
    });
    const math = page.locator("#polish-math");
    await math.getByRole("button", { name: "Row after", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#polish-math").SelectedMatrix.Rows,
      ),
      3,
    );
    await math
      .getByRole("button", { name: "Column after", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#polish-math").SelectedMatrix.Columns,
      ),
      3,
    );
    await math.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#polish-math").SelectedMatrix.Columns,
      ),
      2,
    );
    await math.getByRole("button", { name: "Redo", exact: true }).click();
    await math
      .getByRole("combobox", { name: "Equation input format", exact: true })
      .selectOption("latex");
    const converted = await page.evaluate(() => {
      const m = document.querySelector("#polish-math");
      return { valid: m.Validate(), value: m.Value };
    });
    assert.equal(converted.valid, true);
    assert.equal(converted.value.Format, "latex");
    assert.ok(!converted.value.Source.includes("<math"));
    results.push(
      "Matrix row/column controls, undo/redo, and safe MathML-to-LaTeX switching edit the reusable equation model",
    );
    const draft = await page.evaluate(() => {
      const m = document.querySelector("#polish-math"),
        input = m.shadowRoot.querySelector("textarea");
      input.value = "x^{17}";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const immediate = m.Value.Source,
        validated = m.Validate();
      m.Value = { Source: "z" };
      return { immediate, validated };
    });
    assert.equal(draft.immediate, "x^{17}");
    assert.equal(draft.validated, true);
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#polish-math").Value.Source,
      ),
      "z",
    );
    results.push(
      "Pending source drafts are never lost by validation or replayed over externally assigned equations",
    );
    await page.screenshot({ path: "test-results/equation-matrix-tools.png" });
    await page.evaluate(() => {
      const m = document.querySelector("#polish-math");
      m.Dispose();
      m.remove();
      polishEditor.Text = "a^2+b^2";
      polishEditor.Select(0, 7);
      polishEditor.Focus();
    });
    await page.keyboard.press("Alt+Equal");
    const toolbar = page.locator("#polish-toolbar");
    await toolbar.getByRole("heading", { name: "Insert equation" }).waitFor();
    assert.equal(
      await toolbar
        .locator("rich-equation-editor")
        .evaluate((m) => m.Value.Source),
      "a^2+b^2",
    );
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(() => polishEditor.Document.Text),
      "\ufffc",
    );
    results.push(
      "Alt+= converts selected text through the standard toolbar's equation dialog and shared history",
    );
  } finally {
    await page.evaluate(() => {
      document.querySelector("#polish-math")?.Dispose();
      document.querySelector("#polish-math")?.remove();
      document.querySelector("#polish-toolbar")?.Dispose();
      polishEditor.Dispose();
      document.querySelector("#polish-tests")?.remove();
    });
  }
  return results;
}
