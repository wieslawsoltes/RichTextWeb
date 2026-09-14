import assert from "node:assert/strict";
export async function runToolbarBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const RT = richTextStudio.RT,
      editor = richTextStudio.editor;
    editor.IsReadOnly = false;
    editor.Document = RT.fromText("A document for review.");
    const toolbar = document.createElement("rich-text-toolbar");
    toolbar.id = "test-toolbar";
    toolbar.Editor = editor;
    toolbar.Mode = "all";
    document.body.append(toolbar);
  });
  const toolbar = page.locator("#test-toolbar");
  try {
    await page.evaluate(() => richTextStudio.editor.Select(2, 10));
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        richTextStudio.editor.Selection.GetPropertyValue("FontWeight"),
      ),
      "Bold",
    );
    results.push(
      "Reusable toolbar formats selected text without sample command handlers",
    );
    await toolbar.getByRole("button", { name: "Footer", exact: true }).click();
    await toolbar
      .locator('dialog rich-text-box [part="editor"]')
      .fill("Reusable footer");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          richTextStudio.editor.Document.GetValue("Footers")[0].children[0]
            .text,
      ),
      "Reusable footer",
    );
    await page.evaluate(() => richTextStudio.editor.Undo());
    assert.equal(
      await page.evaluate(() =>
        richTextStudio.editor.Document.GetValue("Footers"),
      ),
      undefined,
    );
    results.push("Reusable header/footer dialog uses engine undo history");
    await toolbar
      .getByRole("button", { name: "Footnote", exact: true })
      .click();
    await toolbar
      .locator('textarea[name="text"]')
      .fill("Blocked after dialog opened");
    await page.evaluate(() => (richTextStudio.editor.IsReadOnly = true));
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        richTextStudio.editor.Document.GetValue("Footnotes"),
      ),
      undefined,
    );
    results.push("Reusable dialogs recheck read-only state at submission");
    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = false;
      richTextStudio.editor.Select(0);
    });
    await toolbar
      .getByRole("button", { name: "Track changes", exact: true })
      .click();
    await page.evaluate(() =>
      richTextStudio.editor.Engine.InsertText("Tracked "),
    );
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Engine.Revisions.length),
      1,
    );
    await toolbar
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await toolbar.getByRole("button", { name: "Reject", exact: true }).click();
    await toolbar.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Document.Text),
      "A document for review.",
    );
    results.push("Reusable tracked-change review rejects an insertion");
    const merge = await page.evaluate(() => {
      const editor = richTextStudio.editor,
        RT = richTextStudio.RT;
      editor.Engine.TrackChanges = false;
      editor.Document = new RT.FlowDocument(
        new RT.Paragraph(RT.createField("MERGEFIELD", "Name")),
      );
      const toolbar = document.getElementById("test-toolbar");
      toolbar.addEventListener(
        "documentsgenerated",
        (event) =>
          (window.testMerged = event.detail.documents.map((d) => d.Text)),
        { once: true },
      );
      toolbar.Execute("MailMerge");
      return true;
    });
    assert.equal(merge, true);
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.testMerged), [
      "Ada",
      "Grace",
    ]);
    results.push("Reusable mail merge emits independent generated documents");
    await page.evaluate(() => {
      const RT = richTextStudio.RT,
        editor = richTextStudio.editor;
      editor.Document = new RT.FlowDocument(
        new RT.Paragraph([
          RT.createField("PAGE"),
          new RT.Run("|"),
          RT.createField("NUMPAGES"),
        ]),
      );
      new RT.DocumentFeatures(editor.Engine).UpdateFields({
        PageNumber: 4,
        PageCount: 8,
      });
      document.getElementById("test-toolbar").Execute("Field");
    });
    await toolbar.locator('select[name="type"]').selectOption("DATE");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        richTextStudio.editor.Document.Text.includes("4|8"),
      ),
      true,
    );
    results.push(
      "Inserting a field preserves cached page values without inventing pagination",
    );

    const originalPage = await page.evaluate(() => {
      document.getElementById("test-toolbar").Execute("PageSetup");
      return {
        width: richTextStudio.editor.Document.PageWidth,
        height: richTextStudio.editor.Document.PageHeight,
      };
    });
    await toolbar.locator('input[name="PageWidth"]').fill("900");
    await toolbar.locator('input[name="PageHeight"]').fill("0");
    await toolbar.getByRole("button", { name: "Apply", exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => ({
        width: richTextStudio.editor.Document.PageWidth,
        height: richTextStudio.editor.Document.PageHeight,
      })),
      originalPage,
    );
    await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
    results.push(
      "Invalid page setup is rejected before any page property changes",
    );

    const retargeted = await page.evaluate(() => {
      const toolbar = document.getElementById("test-toolbar"),
        editor = richTextStudio.editor;
      toolbar.setAttribute("for", "missing-toolbar-target");
      const disconnected = toolbar.Editor === null;
      toolbar.removeAttribute("for");
      toolbar.Editor = editor;
      toolbar.Execute("Footer");
      const second = document.createElement("rich-text-box");
      document.body.append(second);
      toolbar.Editor = second;
      const closed = !toolbar.shadowRoot.querySelector("dialog").open;
      toolbar.Editor = editor;
      second.remove();
      return { disconnected, closed };
    });
    assert.deepEqual(retargeted, { disconnected: true, closed: true });
    results.push(
      "Retargeting disconnects missing editors and closes stale dialogs",
    );

    const stableTOC = await page.evaluate(() => {
      const RT = richTextStudio.RT,
        editor = richTextStudio.editor;
      const heading = new RT.Paragraph("Stable heading");
      heading.HeadingLevel = 1;
      editor.Document = new RT.FlowDocument(heading);
      const features = new RT.DocumentFeatures(editor.Engine);
      features.InsertTableOfContents();
      const before = JSON.stringify(editor.Document.ToJSON());
      features.UpdateTableOfContents();
      return JSON.stringify(editor.Document.ToJSON()) === before;
    });
    assert.equal(stableTOC, true);
    results.push(
      "A freshly inserted table of contents retains valid targets and stable IDs on refresh",
    );
  } finally {
    await page.evaluate(() => {
      const toolbar = document.getElementById("test-toolbar");
      toolbar?.Dispose();
      toolbar?.remove();
      richTextStudio.editor.IsReadOnly = false;
      richTextStudio.editor.Engine.TrackChanges = false;
    });
  }
  return results;
}
