import assert from "node:assert/strict";

export async function runWordAuthoringBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const editor = richTextStudio.editor;
    editor.IsReadOnly = false;
    editor.Engine.TrackChanges = false;
    editor.DocumentView = "WebLayout";
    const toolbar = document.createElement("rich-text-toolbar");
    toolbar.id = "word-authoring-toolbar";
    toolbar.Editor = editor;
    toolbar.Mode = "all";
    document.body.append(toolbar);
  });
  const toolbar = page.locator("#word-authoring-toolbar");
  const command = async (name) =>
    page.evaluate(
      (command) =>
        document.getElementById("word-authoring-toolbar").Execute(command),
      name,
    );
  const apply = () =>
    toolbar.getByRole("button", { name: "Apply", exact: true }).click();
  const text = () => page.evaluate(() => richTextStudio.editor.Document.Text);
  try {
    await page.evaluate(() => richTextStudio.loadTemplate("automation"));
    assert.match(await text(), /420\.00/);
    assert.match(await text(), /Within budget/);
    assert.match(await text(), /See Table 1 for the estimate/);
    assert.match(
      await text(),
      /List of tables\nTable 1: Estimated project effort/,
    );
    assert.equal(
      await page.locator('rich-text-page-editor [part="editor"] thead').count(),
      1,
    );
    await page.screenshot({
      path: "test-results/word-automation.png",
      fullPage: true,
    });
    results.push(
      "Automation sample calculates tables, captions, references and document-property fields",
    );

    await page.evaluate(() => {
      const { RT, editor } = richTextStudio;
      editor.Document = RT.fromHTML(
        "<table><tr><td>100</td></tr><tr><td>2</td></tr><tr><td>RESULT</td></tr></table>",
      );
      editor.Select(0);
    });
    await command("RepeatHeaderRows");
    await toolbar.locator('input[name="count"]').fill("1");
    await apply();
    assert.equal(
      await page
        .locator('rich-text-page-editor [part="editor"] thead tr')
        .count(),
      1,
    );
    results.push(
      "Repeat-header dialog creates a rendered thead without changing row text",
    );
    await page.evaluate(() => {
      const editor = richTextStudio.editor,
        offset = editor.Document.Text.indexOf("RESULT");
      editor.Select(offset, offset + 6);
    });
    await command("Formula");
    await toolbar.locator('input[name="picture"]').fill("0.00");
    await apply();
    assert.equal(await text(), "100\n2\n2.00");
    await page.evaluate(() => richTextStudio.editor.Undo());
    assert.equal(await text(), "100\n2\nRESULT");
    await page.evaluate(() => richTextStudio.editor.Redo());
    assert.equal(await text(), "100\n2\n2.00");
    results.push(
      "Formula dialog excludes headers, formats results and is one undo/redo transaction",
    );

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.Document = RT.fromHTML(
        "<table><tr><td>Heading</td><td>Score</td></tr><tr><td><b>Beta</b></td><td>2</td></tr><tr><td>Alpha</td><td>3</td></tr><tr><td>Alpha</td><td>1</td></tr></table>",
      );
      editor.Select(0);
      editor.Engine.SetTableHeaderRows(1);
      editor.Select(editor.Document.Text.indexOf("Beta"));
    });
    await command("SortTable");
    await toolbar.locator('input[name="column2"]').fill("2");
    await toolbar.locator('select[name="type2"]').selectOption("Number");
    await apply();
    assert.equal(await text(), "Heading\nScore\nAlpha\n1\nAlpha\n3\nBeta\n2");
    assert.equal(
      await page.evaluate(() =>
        richTextStudio.editor.Selection.GetPropertyValue("FontWeight"),
      ),
      "Bold",
    );
    results.push(
      "Multi-key sort dialog preserves headers, rich formatting and caret identity",
    );

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.Document = RT.fromText("Intro");
      editor.Select(5);
    });
    await command("Caption");
    await toolbar.locator('textarea[name="text"]').fill("Browser result");
    await apply();
    assert.match(await text(), /Figure 1: Browser result/);
    await page.evaluate(() => {
      const editor = richTextStudio.editor;
      editor.Select(editor.Document.Text.length);
      editor.Engine.InsertParagraph();
      editor.Engine.InsertText("See ");
    });
    await command("CrossReference");
    const target = await toolbar
      .locator('select[name="bookmark"] option')
      .evaluateAll(
        (options) =>
          options.find((option) => option.value.endsWith("Label"))?.value,
      );
    assert(target);
    await toolbar.locator('select[name="bookmark"]').selectOption(target);
    await apply();
    assert.match(await text(), /See Figure 1$/);
    await page.evaluate(() => richTextStudio.editor.Select(0));
    await command("TableOfFigures");
    await toolbar.locator('select[name="pages"]').selectOption("No");
    await apply();
    assert.match(await text(), /Table of Figures\nFigure 1: Browser result/);
    results.push(
      "Caption, target picker and figure-index dialogs use the shared document engine",
    );

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.Document = new RT.FlowDocument(
        new RT.Paragraph(RT.createFieldFromInstruction("= 0", "0")),
      );
      editor.Select(0);
    });
    await command("FieldCode");
    await toolbar
      .locator('textarea[name="instruction"]')
      .fill("= globalThis.process.exit()");
    await apply();
    assert(await toolbar.locator('dialog [role="alert"]').textContent());
    assert.equal(await text(), "0");
    await toolbar.locator('textarea[name="instruction"]').fill("= 2+3");
    await apply();
    assert.equal(await text(), "5");
    await command("LockField");
    await page.evaluate(() => {
      const { RT, editor } = richTextStudio;
      const features = new RT.DocumentFeatures(editor.Engine);
      features.SetFieldCode(features.GetSelectedField().id, "= 7+5");
      editor.Focus();
    });
    await page.keyboard.press("F9");
    assert.equal(await text(), "5");
    await command("UnlockField");
    await page.keyboard.press("F9");
    assert.equal(await text(), "12");
    await page.keyboard.press("Control+Shift+F9");
    assert.equal(
      await page.evaluate(() =>
        new richTextStudio.RT.DocumentFeatures(
          richTextStudio.editor.Engine,
        ).GetSelectedField(),
      ),
      null,
    );
    assert.equal(await text(), "12");
    results.push(
      "Field-code validation, locks, F9 update and Ctrl+Shift+F9 unlink work through the control",
    );

    await page.evaluate(() => {
      const { RT, editor } = richTextStudio;
      editor.Document = RT.fromText("Hello world");
      editor.Select(0, 5);
      editor.IsReadOnly = true;
    });
    await command("WordCount");
    assert.match(
      await toolbar.locator("dialog").textContent(),
      /Document.*Words2.*Selection.*Words1/s,
    );
    await toolbar.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await text(), "Hello world");
    assert.equal(
      await toolbar
        .getByRole("button", { name: "Formula", exact: true })
        .isDisabled(),
      true,
    );
    results.push(
      "Word count supports read-only documents and separate selection statistics",
    );

    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = false;
    });
    await command("Caption");
    await toolbar.locator('textarea[name="text"]').fill("stale caption");
    await page.evaluate(() => {
      richTextStudio.editor.Document =
        richTextStudio.RT.fromText("Replacement");
    });
    await apply();
    assert.equal(await text(), "Replacement");
    await command("Caption");
    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = true;
    });
    await apply();
    assert.equal(await text(), "Replacement");
    results.push(
      "New authoring dialogs reject stale-document and read-only submissions",
    );

    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = false;
    });
    await page
      .locator("#word-ribbon")
      .getByRole("tab", { name: "References", exact: true })
      .click();
    for (const id of [
      "Caption",
      "CrossReference",
      "TableOfFigures",
      "FieldCode",
      "LockField",
      "UnlockField",
      "UnlinkField",
    ])
      assert.equal(
        await page.locator(`#word-ribbon [data-control-id="${id}"]`).count(),
        1,
      );
    await page.locator('#word-ribbon [data-control-id="Caption"]').click();
    await page
      .locator('#document-command-service textarea[name="text"]')
      .fill("Ribbon caption");
    await page
      .locator("#document-command-service")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    assert.match(await text(), /Figure 1: Ribbon caption/);
    await page
      .locator("#word-ribbon")
      .getByRole("tab", { name: "Table layout", exact: true })
      .click();
    for (const id of ["Formula", "SortTable", "RepeatHeaderRows"])
      assert.equal(
        await page.locator(`#word-ribbon [data-control-id="${id}"]`).count(),
        1,
      );
    results.push(
      "Sample ribbon routes caption, field and table-data actions to the reusable toolbar",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await command("SortTable");
    const bounds = await toolbar.locator("dialog").evaluate((dialog) => {
      const r = dialog.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        left: r.left,
        right: r.right,
        viewport: innerWidth,
      };
    });
    assert(
      bounds.left >= 0 &&
        bounds.right <= bounds.viewport + 1 &&
        bounds.height <= 844 * 0.91,
    );
    await page.screenshot({
      path: "test-results/word-sort-mobile.png",
      fullPage: true,
    });
    await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
    results.push(
      "Three-key sort dialog remains bounded and scrollable on a touch-size viewport",
    );
  } finally {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.evaluate(() => {
      const toolbar = document.getElementById("word-authoring-toolbar");
      toolbar?.Dispose();
      toolbar?.remove();
      richTextStudio.editor.IsReadOnly = false;
      richTextStudio.editor.Engine.TrackChanges = false;
      richTextStudio.editor.DocumentView = "PrintLayout";
      richTextStudio.loadTemplate("welcome");
    });
  }
  return results;
}
