import assert from "node:assert/strict";

export async function runDocumentStyleBrowserChecks(page) {
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
    host.id = "styles-check-host";
    host.style.cssText =
      "position:fixed;inset:16px;z-index:10000;background:white;overflow:auto;padding:12px;display:flex;flex-direction:column";
    const e = document.createElement("rich-text-box"),
      t = document.createElement("rich-text-toolbar");
    e.id = "styles-check-editor";
    e.ViewMode = "continuous";
    e.style.cssText = "display:block;height:420px;flex:1;min-height:200px";
    e.setAttribute("theme", "light");
    e.Document = RT.fromText("A title\nBody text");
    e.Engine.SetDocumentStyles([
      {
        Id: "Body",
        Name: "Body",
        Kind: "Paragraph",
        IsDefault: true,
        Properties: { FontSize: 16, Foreground: "#224466" },
      },
      {
        Id: "Title",
        Name: "Title",
        Kind: "Paragraph",
        BasedOn: "Body",
        Next: "Body",
        Properties: { FontSize: 28, HeadingLevel: 1, FontWeight: "Bold" },
      },
    ]);
    e.Engine.ClearUndo();
    e.Select(0);
    t.id = "styles-check-toolbar";
    t.Mode = "home";
    t.Editor = e;
    host.append(t, e);
    document.body.append(host);
    return saved;
  });
  const toolbar = page.locator("#styles-check-toolbar"),
    editor = page.locator("#styles-check-editor");
  const command = (name) =>
    page.evaluate(
      (name) => document.getElementById("styles-check-toolbar").Execute(name),
      name,
    );
  const choose = (id) =>
    toolbar
      .locator('dialog[open] select[aria-label="Document styles"]')
      .selectOption(id);
  const button = (name) =>
    toolbar
      .locator("dialog[open]")
      .getByRole("button", { name, exact: true })
      .click();
  const apply = () => button("Apply");
  const modify = async (id) => {
    await command("DocumentStyles");
    await choose(id);
    await button("Modify style");
  };
  try {
    await command("DocumentStyles");
    await choose("Title");
    await button("Apply style");
    assert.equal(await editor.locator("h1").textContent(), "A title");
    assert.equal(
      await editor.locator("h1").evaluate((n) => getComputedStyle(n).fontSize),
      "28px",
    );
    await page.evaluate(() =>
      document.getElementById("styles-check-editor").Undo(),
    );
    assert.equal(await editor.locator("h1").count(), 0);
    await page.evaluate(() =>
      document.getElementById("styles-check-editor").Redo(),
    );
    results.push(
      "Named paragraph style manager renders a semantic heading and applies one undo/redo step",
    );

    await modify("Body");
    await toolbar.locator('input[name="FontSize"]').fill("20");
    await apply();
    assert.equal(
      await editor
        .locator('[data-rt-type="Paragraph"]')
        .nth(1)
        .evaluate((n) => getComputedStyle(n).fontSize),
      "20px",
    );
    assert.equal(
      await editor.locator("h1").evaluate((n) => getComputedStyle(n).fontSize),
      "28px",
    );
    results.push(
      "Editing the base style updates its users without replacing derived overrides",
    );

    await page.evaluate(() =>
      document.getElementById("styles-check-editor").Select(8, 12),
    );
    await command("DocumentStyles");
    await button("New character style");
    await toolbar.locator('input[name="id"]').fill("Emphasis");
    await toolbar.locator('input[name="name"]').fill("Emphasis");
    await toolbar.locator('select[name="FontStyle"]').selectOption("Italic");
    await toolbar.locator('input[name="Foreground"]').fill("#aa2255");
    await apply();
    await command("DocumentStyles");
    await choose("Emphasis");
    await button("Apply style");
    const emphasis = editor
      .locator('[data-rt-type="Run"]')
      .filter({ hasText: "Body" });
    assert.equal(
      await emphasis.evaluate((n) => getComputedStyle(n).fontStyle),
      "italic",
    );
    await page.evaluate(() =>
      document
        .getElementById("styles-check-editor")
        .Engine.ApplyProperty("FontSize", 42),
    );
    await command("ClearDirectFormatting");
    assert.equal(
      await emphasis.evaluate((n) => getComputedStyle(n).fontSize),
      "20px",
    );
    assert.equal(
      await emphasis.evaluate((n) => getComputedStyle(n).fontStyle),
      "italic",
    );
    results.push(
      "Character style creation and direct-format clearing keep named style identity and selection",
    );

    await page.evaluate(() => {
      const e = document.getElementById("styles-check-editor");
      e.Select(7);
      e.Engine.InsertParagraph();
    });
    assert.equal(
      await page.evaluate(() =>
        document
          .getElementById("styles-check-editor")
          .Document.Blocks.Get(1)
          .GetValue("ParagraphStyleId"),
      ),
      "Body",
    );
    await page.evaluate(() =>
      document.getElementById("styles-check-editor").Undo(),
    );
    results.push(
      "Enter at a named heading end uses its configured following paragraph style",
    );

    await modify("Body");
    await toolbar.locator('select[name="basedOn"]').selectOption("Title");
    await apply();
    assert.match(
      await toolbar.locator('dialog[open] [role="alert"]').textContent(),
      /cyclic/,
    );
    await button("Cancel");
    await command("DocumentStyles");
    await button("New paragraph style");
    await toolbar.locator('input[name="id"]').fill("Body");
    await apply();
    assert.match(
      await toolbar.locator('dialog[open] [role="alert"]').textContent(),
      /already exists/,
    );
    await button("Cancel");
    results.push(
      "Invalid inheritance and duplicate style identifiers fail before catalog mutation",
    );

    await page.evaluate(
      () => (document.getElementById("styles-check-editor").IsReadOnly = true),
    );
    await command("DocumentStyles");
    assert(
      await toolbar
        .locator("dialog[open]")
        .getByRole("button", { name: "Apply style", exact: true })
        .isDisabled(),
    );
    assert(
      await toolbar
        .locator("dialog[open]")
        .getByRole("button", { name: "Modify style", exact: true })
        .isDisabled(),
    );
    await button("Close");
    await page.evaluate(
      () => (document.getElementById("styles-check-editor").IsReadOnly = false),
    );
    await modify("Body");
    await toolbar.locator('input[name="FontSize"]').fill("50");
    await page.evaluate(() => {
      const e = document.getElementById("styles-check-editor");
      e.Document = richTextStudio.RT.fromText("Replacement");
    });
    await apply();
    assert.equal(
      await page.evaluate(
        () => document.getElementById("styles-check-editor").Document.Text,
      ),
      "Replacement",
    );
    if (await toolbar.locator("dialog[open]").count()) await button("Cancel");
    results.push(
      "Styles remain inspectable read-only while stale modification dialogs cannot overwrite a replacement document",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await command("DocumentStyles");
    await button("New paragraph style");
    const bounds = await toolbar.locator("dialog[open]").evaluate((d) => {
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
      path: "test-results/document-style-mobile.png",
      fullPage: true,
    });
    await button("Cancel");
    results.push(
      "Style properties dialog remains bounded and scrollable at mobile viewport size",
    );

    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      document.getElementById("styles-check-host").style.display = "none";
      richTextStudio.loadTemplate("styles");
      richTextStudio.editor.DocumentView = "WebLayout";
      richTextStudio.workspace.SetZoom(100);
      richTextStudio.workspace.Ribbon.selectTab("home");
    });
    assert.equal(
      await page
        .locator('rich-text-page-editor [part="editor"] h1')
        .textContent(),
      "Styles that stay connected",
    );
    await page
      .locator('#word-ribbon [data-control-id="DocumentStyles"]')
      .click();
    const service = page.locator("#document-command-service");
    await service
      .locator('dialog[open] select[aria-label="Document styles"]')
      .selectOption("Body");
    await service
      .locator("dialog[open]")
      .getByRole("button", { name: "Modify style", exact: true })
      .click();
    await service.locator('input[name="FontSize"]').fill("20");
    await service
      .locator("dialog[open]")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          richTextStudio.editor.Engine.ResolveDocumentStyle("Body").FontSize,
      ),
      20,
    );
    assert.equal(await page.locator("#outline button").count(), 2);
    await page.screenshot({
      path: "test-results/document-styles-sample.png",
      fullPage: true,
    });
    await page.evaluate(() => richTextStudio.editor.Undo());
    assert.equal(
      await page.evaluate(
        () =>
          richTextStudio.editor.Engine.ResolveDocumentStyle("Body").FontSize,
      ),
      17,
    );
    results.push(
      "Named styles sample, heading outline and Home ribbon share live definitions and undo",
    );
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(async (saved) => {
      document.getElementById("styles-check-toolbar")?.Dispose();
      document.getElementById("styles-check-editor")?.Dispose();
      document.getElementById("styles-check-host")?.remove();
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
