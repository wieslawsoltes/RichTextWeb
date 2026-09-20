import assert from "node:assert/strict";

export async function runDocumentThemeBrowserChecks(page) {
  const results = [],
    viewport = page.viewportSize();
  const initial = await page.evaluate(() => {
    const { editor, workspace, RT } = richTextStudio;
    const saved = {
      document: editor.Document.ToJSON(),
      view: editor.DocumentView,
      zoom: editor.Zoom,
      zoomMode: editor.ZoomMode,
      layout: workspace.Docking.SaveLayout(),
      title: document.getElementById("document-title").value,
    };
    const host = document.createElement("section");
    host.id = "themes-check-host";
    host.style.cssText =
      "position:fixed;inset:16px;z-index:10000;background:white;overflow:auto;padding:12px;display:flex;flex-direction:column";
    const e = document.createElement("rich-text-box"),
      t = document.createElement("rich-text-toolbar");
    e.id = "themes-check-editor";
    e.ViewMode = "continuous";
    e.style.cssText = "display:block;height:420px;flex:1;min-height:200px";
    e.setAttribute("theme", "light");
    e.Document = RT.fromText("Linked title\nFixed violet\nBody text");
    e.Engine.SetDocumentTheme(RT.createDocumentTheme());
    e.Engine.SetDocumentStyles([
      {
        Id: "Body",
        Name: "Body",
        Kind: "Paragraph",
        IsDefault: true,
        Properties: {
          FontFamily: RT.themeFont("Minor"),
          FontSize: 17,
          Foreground: RT.themeColor("text1"),
        },
      },
      {
        Id: "Title",
        Name: "Title",
        Kind: "Paragraph",
        BasedOn: "Body",
        Properties: {
          FontFamily: RT.themeFont("Major"),
          FontSize: 30,
          Foreground: RT.themeColor("accent1"),
          HeadingLevel: 1,
        },
      },
    ]);
    e.Select(0);
    e.Engine.ApplyParagraphStyle("Title");
    e.Select(13, 25);
    e.Engine.ApplyProperty("Foreground", "#702A9D");
    e.Select(1);
    e.Engine.ClearUndo();
    t.id = "themes-check-toolbar";
    t.Mode = "home";
    t.Editor = e;
    host.append(t, e);
    document.body.append(host);
    return saved;
  });
  const t = page.locator("#themes-check-toolbar"),
    e = page.locator("#themes-check-editor");
  const command = (command) =>
    page.evaluate(
      (c) => document.getElementById("themes-check-toolbar").Execute(c),
      command,
    );
  const button = (name) =>
    t
      .locator("dialog[open]")
      .getByRole("button", { name, exact: true })
      .click();
  const choose = (name) =>
    t
      .locator('dialog[open] select[aria-label="Document theme preset"]')
      .selectOption({ label: name });
  const titleStyle = () =>
    e.locator("h1").evaluate((n) => ({
      color: getComputedStyle(n).color,
      font: getComputedStyle(n).fontFamily,
    }));
  const current = () =>
    page.evaluate(() =>
      document.getElementById("themes-check-editor").GetDocumentTheme(),
    );
  try {
    await command("DocumentTheme");
    await choose("Editorial");
    assert.equal((await current()).Name, "Studio");
    assert.equal((await titleStyle()).color, "rgb(23, 75, 117)");
    await button("Apply theme");
    assert.equal((await current()).Name, "Editorial");
    assert.equal((await titleStyle()).color, "rgb(123, 49, 73)");
    assert.match((await titleStyle()).font, /Georgia/);
    const fixed = e
      .locator('[data-rt-type="Run"]')
      .filter({ hasText: "Fixed violet" });
    assert.equal(
      await fixed.evaluate((n) => getComputedStyle(n).color),
      "rgb(112, 42, 157)",
    );
    await page.evaluate(() =>
      document.getElementById("themes-check-editor").Undo(),
    );
    assert.equal((await current()).Name, "Studio");
    await page.evaluate(() =>
      document.getElementById("themes-check-editor").Redo(),
    );
    assert.equal((await current()).Name, "Editorial");
    results.push(
      "Theme manager previews without mutation and applies a live palette/font change as one undo step",
    );

    await command("DocumentTheme");
    await button("Customize theme");
    await t.locator('input[name="name"]').fill("Custom report");
    await t.locator('input[name="accent1"]').fill("#225588");
    await t.locator('input[name="major"]').fill("Verdana");
    await t.locator('select[name="map-text1"]').selectOption("accent3");
    await button("Apply");
    assert.equal((await current()).Name, "Custom report");
    assert.equal((await titleStyle()).color, "rgb(34, 85, 136)");
    assert.match((await titleStyle()).font, /Verdana/);
    assert.equal(
      await e
        .locator('[data-rt-type="Paragraph"]')
        .nth(2)
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(51, 110, 115)",
    );
    results.push(
      "Custom theme editing applies validated palette, Latin font and semantic color mapping through the shared engine",
    );

    await page.evaluate(() =>
      document.getElementById("themes-check-editor").Select(26, 30),
    );
    await command("ThemeColor");
    await t.locator('select[name="color"]').selectOption("accent6");
    await t.locator('input[name="tint"]').fill("999");
    await button("Apply");
    assert.match(
      await t.locator('dialog[open] [role="alert"]').textContent(),
      /Invalid theme/,
    );
    await t.locator('input[name="tint"]').fill("153");
    await button("Apply");
    await command("ThemeFont");
    await t.locator('select[name="font"]').selectOption("Major");
    await button("Apply");
    const selection = await page.evaluate(() => {
      const e = document.getElementById("themes-check-editor"),
        RT = richTextStudio.RT;
      return {
        color: e.Engine.GetProperty("Foreground"),
        font: e.Engine.GetProperty("FontFamily"),
        expected: RT.resolveDocumentThemeValue(
          e.GetDocumentTheme(),
          "Foreground",
          RT.themeColor("accent6", { Tint: 153 }),
        ),
        start: e.Selection.Start.Offset,
        end: e.Selection.End.Offset,
      };
    });
    assert.equal(selection.color, selection.expected);
    assert.equal(selection.font, "Verdana");
    assert.equal(selection.start, 26);
    assert.equal(selection.end, 30);
    results.push(
      "Theme color/font selection tools preserve the rich selection and reject invalid tint bytes without mutation",
    );

    await command("DocumentStyles");
    await t
      .locator('select[aria-label="Document styles"]')
      .selectOption("Body");
    await button("Modify style");
    await t.locator('select[name="ForegroundTheme"]').selectOption("accent5");
    await t.locator('input[name="ForegroundTint"]').fill("153");
    await button("Apply");
    assert.equal(
      await page.evaluate(
        () =>
          richTextStudio.RT.parseThemeColor(
            document
              .getElementById("themes-check-editor")
              .Engine.ResolveDocumentStyle("Body").Foreground,
          ).Color,
      ),
      "accent5",
    );
    results.push(
      "Named-style properties expose theme link selectors and retain symbolic references rather than flattening colors",
    );

    await command("DocumentTheme");
    const before = await titleStyle();
    await button("Detach theme");
    assert.equal(await current(), null);
    assert.deepEqual(await titleStyle(), before);
    await page.evaluate(() =>
      document.getElementById("themes-check-editor").Undo(),
    );
    assert.equal((await current()).Name, "Custom report");
    await page.evaluate(
      () => (document.getElementById("themes-check-editor").IsReadOnly = true),
    );
    await command("DocumentTheme");
    assert(
      await t
        .getByRole("button", { name: "Apply theme", exact: true })
        .isDisabled(),
    );
    assert(
      await t
        .getByRole("button", { name: "Detach theme", exact: true })
        .isDisabled(),
    );
    await button("Close");
    assert.equal(
      await page.evaluate(() => {
        const e = document.getElementById("themes-check-editor");
        return e.SetDocumentTheme(richTextStudio.RT.createDocumentTheme());
      }),
      false,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById("themes-check-editor")
            .Execute("GetDocumentTheme").Name,
      ),
      "Custom report",
    );
    await page.evaluate(
      () => (document.getElementById("themes-check-editor").IsReadOnly = false),
    );
    await command("DocumentTheme");
    await button("Customize theme");
    await t.locator('input[name="accent1"]').fill("red");
    await button("Apply");
    assert.match(
      await t.locator('dialog[open] [role="alert"]').textContent(),
      /RGB/,
    );
    await t.locator('input[name="accent1"]').fill("#112233");
    await page.evaluate(() =>
      document
        .getElementById("themes-check-editor")
        .SetDocumentTheme(richTextStudio.RT.createDocumentTheme("Forest")),
    );
    await button("Apply");
    assert.equal((await current()).Name, "Forest");
    if (await t.locator("dialog[open]").count()) await button("Cancel");
    results.push(
      "Detach freezes presentation with undo, read-only inspection is allowed, and invalid or stale theme edits cannot overwrite changes",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await command("DocumentTheme");
    await button("Customize theme");
    const bounds = await t.locator("dialog[open]").evaluate((d) => {
      const r = d.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        height: r.height,
        width: innerWidth,
      };
    });
    assert(
      bounds.left >= 0 &&
        bounds.right <= bounds.width + 1 &&
        bounds.height <= 844 * 0.91,
    );
    await page.screenshot({
      path: "test-results/document-theme-mobile.png",
      fullPage: true,
    });
    await button("Cancel");
    results.push(
      "Theme palette and mapping properties remain bounded and scrollable on a mobile viewport",
    );

    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      document.getElementById("themes-check-host").style.display = "none";
      richTextStudio.loadTemplate("themes");
      richTextStudio.editor.DocumentView = "WebLayout";
      richTextStudio.workspace.SetZoom(100);
      richTextStudio.workspace.Ribbon.selectTab("design");
    });
    await page
      .locator('#word-ribbon [data-control-id="DocumentTheme"]')
      .click();
    const service = page.locator("#document-command-service");
    await service
      .locator('select[aria-label="Document theme preset"]')
      .selectOption({ label: "Editorial" });
    await service
      .getByRole("button", { name: "Apply theme", exact: true })
      .click();
    assert.equal(
      await page
        .locator('rich-text-page-editor [part="editor"] h1')
        .textContent(),
      "One theme, a connected document",
    );
    assert.equal(
      await page
        .locator('rich-text-page-editor [part="editor"] h1')
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(123, 49, 73)",
    );
    assert.equal(await page.locator("#outline button").count(), 2);
    await page.screenshot({
      path: "test-results/document-theme-sample.png",
      fullPage: true,
    });
    await page.evaluate(() => richTextStudio.editor.Undo());
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.GetDocumentTheme().Name),
      "Studio",
    );
    results.push(
      "The connected-theme sample and Design ribbon use shared theme APIs, live headings, direct overrides and undo",
    );
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(async (saved) => {
      document.getElementById("themes-check-toolbar")?.Dispose();
      document.getElementById("themes-check-editor")?.Dispose();
      document.getElementById("themes-check-host")?.remove();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const { editor, workspace, RT } = richTextStudio;
      editor.IsReadOnly = false;
      editor.Document = RT.FlowDocument.FromJSON(saved.document);
      editor.DocumentView = saved.view;
      workspace.Docking.LoadLayout(saved.layout);
      workspace.SetZoom(saved.zoom * 100);
      editor.ZoomMode = saved.zoomMode;
      document.getElementById("document-title").value = saved.title;
      workspace.Ribbon.selectTab("home");
      workspace.Refresh();
    }, initial);
  }
  return results;
}
