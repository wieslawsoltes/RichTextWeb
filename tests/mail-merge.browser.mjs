import assert from "node:assert/strict";

export async function runMailMergeBrowserChecks(page) {
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
    host.id = "merge-check-host";
    host.style.cssText =
      "position:fixed;inset:16px;z-index:10000;background:white;overflow:auto;padding:12px";
    const e = document.createElement("rich-text-box"),
      t = document.createElement("rich-text-toolbar");
    e.id = "merge-check-editor";
    e.style.cssText = "display:block;height:360px";
    const f = (s, v) => RT.createFieldFromInstruction(s, v);
    e.Document = new RT.FlowDocument(
      new RT.Paragraph([
        f("MERGEFIELD Name", "name"),
        new RT.Run("|"),
        f("MERGEREC", "rec"),
        new RT.Run("|"),
        f("MERGESEQ", "seq"),
      ]),
    );
    e.Engine.ClearUndo();
    t.id = "merge-check-toolbar";
    t.Editor = e;
    t.Mode = "home";
    window.mergeCheckResults = [];
    t.addEventListener("documentsgenerated", (event) => {
      window.mergeCheckResults.push(
        event.detail.documents.map((doc) => doc.Text),
      );
    });
    host.append(t, e);
    document.body.append(host);
    return saved;
  });
  const t = page.locator("#merge-check-toolbar"),
    d = t.locator("dialog[open]");
  const cmd = (data) =>
    page.evaluate(
      (data) =>
        document
          .getElementById("merge-check-toolbar")
          .Execute("MailMergeRecipients", data),
      data,
    );
  const b = (name) => d.getByRole("button", { name, exact: true }).click();
  const set = (name, value) => d.getByLabel(name, { exact: true }).fill(value);
  const choose = (name, value) =>
    d.getByLabel(name, { exact: true }).selectOption(value);
  const preview = () =>
    d.locator("flow-document-scroll-viewer").evaluate((e) => e.Document.Text);
  const source = () =>
    page.evaluate(
      () => document.getElementById("merge-check-editor").Document.Text,
    );
  const rows = [
    { Name: "Ada", Team: "A", Amount: 10 },
    { Name: "Grace", Team: "B", Amount: 30 },
    { Name: "Katherine", Team: "A", Amount: 50 },
    { Name: "Alan", Team: "A", Amount: 5 },
  ];
  try {
    await cmd(rows);
    await b("Load recipients");
    assert.equal(await preview(), "Ada|1|1");
    assert.equal(await source(), "name|rec|seq");
    await choose("Filter 1 field", "Team");
    await set("Filter 1 value", "A");
    await d.locator("summary").click();
    await choose("Sort 1 field", "Amount");
    await choose("Sort 1 type", "Number");
    await choose("Sort 1 direction", "Descending");
    assert.equal(
      await d
        .getByRole("button", { name: "Generate documents", exact: true })
        .isDisabled(),
      true,
    );
    await b("Apply query");
    assert.equal(await preview(), "Katherine|1|1");
    await d.getByLabel("Include source row 1", { exact: true }).uncheck();
    await b("Next preview");
    assert.equal(await preview(), "Alan|3|2");
    await b("Generate documents");
    assert.deepEqual(await page.evaluate(() => window.mergeCheckResults), [
      ["Katherine|1|1", "Alan|3|2"],
    ]);
    assert.equal(await source(), "name|rec|seq");
    assert.equal(
      await page.evaluate(
        () => document.getElementById("merge-check-editor").Engine.CanUndo,
      ),
      false,
    );
    results.push(
      "Recipient query, source-row selection and rich preview distinguish MERGEREC from MERGESEQ without editing the template",
    );

    await cmd();
    await choose("Source format", "CSV");
    await set(
      "Recipient records",
      'Name,Amount\r\n"Doe, Ada",10\r\n"<img src=x onerror=alert(1)>",20',
    );
    await b("Load recipients");
    assert.equal(await preview(), "Doe, Ada|1|1");
    await b("Next preview");
    assert.match(await preview(), /^<img src=x/);
    assert.equal(await d.locator("img").count(), 0);
    await set("Recipient records", 'Name\n"unfinished');
    assert.equal(
      await d
        .getByRole("button", { name: "Generate documents", exact: true })
        .isDisabled(),
      true,
    );
    await b("Load recipients");
    assert.match(await d.getByRole("alert").textContent(), /Unterminated/);
    await d
      .getByLabel("Open local recipient file", { exact: true })
      .setInputFiles({
        name: "people.tsv",
        mimeType: "text/tab-separated-values",
        buffer: Buffer.from("Name\tAmount\nGrace\t15"),
      });
    await page.waitForFunction(
      () =>
        document
          .getElementById("merge-check-toolbar")
          .shadowRoot.querySelector('textarea[name="records"]').value ===
        "Name\tAmount\nGrace\t15",
    );
    await b("Load recipients");
    assert.equal(await preview(), "Grace|1|1");
    await b("Close");
    results.push(
      "Local CSV/TSV input handles quoted text, rejects malformed records and never interprets recipient markup",
    );

    await cmd(
      Array.from({ length: 65 }, (_, i) => ({ Name: `Person ${i + 1}` })),
    );
    await b("Load recipients");
    assert.equal(await d.locator("tbody tr").count(), 50);
    await b("Next recipients");
    assert.equal(await d.locator("tbody tr").count(), 15);
    await b("Clear matched");
    assert.equal(
      await d
        .getByRole("button", { name: "Generate documents", exact: true })
        .isDisabled(),
      true,
    );
    await b("Select all matched");
    await set("First query record", "52");
    await set("Last query record", "54");
    await b("Apply query");
    assert.equal(await preview(), "Person 52|52|1");
    await set("Preview output record", "3");
    await b("Preview record");
    assert.equal(await preview(), "Person 54|54|3");
    await b("Close");
    results.push(
      "Recipient rows are page-bounded and record ranges retain correct query/output ordinals",
    );

    await cmd([{ Other: "Missing name" }]);
    await b("Load recipients");
    assert.match(await d.textContent(), /unresolved fields/);
    await b("Generate documents");
    assert.match(await d.getByRole("alert").textContent(), /Recipient/);
    assert.equal(await page.evaluate(() => window.mergeCheckResults.length), 1);
    await d.getByLabel("Reject unresolved fields", { exact: true }).uncheck();
    await b("Apply query");
    await b("Generate documents");
    assert.deepEqual(await page.evaluate(() => window.mergeCheckResults[1]), [
      "name|1|1",
    ]);
    results.push(
      "Strict generation rejects unresolved fields without publishing partial results; permissive generation preserves caches",
    );

    await cmd(rows);
    await b("Load recipients");
    await page.evaluate(() =>
      document
        .getElementById("merge-check-editor")
        .Engine.InsertText("changed"),
    );
    await b("Generate documents");
    assert.match(await d.getByRole("alert").textContent(), /template changed/);
    await b("Close");
    await cmd(rows);
    await b("Load recipients");
    await page.evaluate(() => {
      document.getElementById("merge-check-editor").IsReadOnly = true;
    });
    await b("Generate documents");
    assert.match(await d.getByRole("alert").textContent(), /read-only/);
    await b("Close");
    await page.evaluate(() => {
      document.getElementById("merge-check-editor").IsReadOnly = false;
    });
    assert.equal(await page.evaluate(() => window.mergeCheckResults.length), 2);
    results.push(
      "Recipient sessions reject changed templates and read-only generation instead of publishing stale previews",
    );

    await cmd(rows);
    await b("Load recipients");
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await d.evaluate((e) => {
      const r = e.getBoundingClientRect();
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
      path: "test-results/mail-merge-mobile.png",
      fullPage: true,
    });
    await b("Close");
    await page.setViewportSize(viewport);
    results.push(
      "The recipient query and preview dialog remains bounded and scrollable on a mobile viewport",
    );

    await page.evaluate(async () => {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      document.getElementById("merge-check-host").style.display = "none";
      richTextStudio.loadTemplate("mailings");
      richTextStudio.editor.DocumentView = "WebLayout";
      richTextStudio.workspace.SetZoom(100);
      richTextStudio.workspace.Ribbon.selectTab("mailings");
    });
    const original = await page.evaluate(
      () => richTextStudio.editor.Document.Text,
    );
    await page
      .locator('#word-ribbon [data-control-id="MailMergeRecipients"]')
      .click();
    const service = page.locator("#document-command-service dialog[open]");
    await service
      .getByRole("button", { name: "Load recipients", exact: true })
      .click();
    const samplePreview = await service
      .locator("flow-document-scroll-viewer")
      .evaluate((e) => e.Document.Text);
    assert.match(samplePreview, /Dear Ada,/);
    assert.match(samplePreview, /\$150\.00/);
    assert.match(samplePreview, /Query record 1 · Output 1/);
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Document.Text),
      original,
    );
    await page.screenshot({
      path: "test-results/mail-merge-sample.png",
      fullPage: true,
    });
    await service
      .getByRole("button", { name: "Generate documents", exact: true })
      .click();
    const output = page.locator("#mail-merge-results");
    assert.match(
      await output.locator("h2").textContent(),
      /4 merged documents/,
    );
    await output
      .getByLabel("Generated document", { exact: true })
      .selectOption("2");
    assert.match(
      await output
        .locator("flow-document-scroll-viewer")
        .evaluate((e) => e.Document.Text),
      /Dear Katherine,/,
    );
    const downloading = page.waitForEvent("download");
    await output
      .getByRole("button", { name: "Download selected DOCX", exact: true })
      .click();
    assert.equal((await downloading).suggestedFilename(), "merged-3.docx");
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Document.Text),
      original,
    );
    await output
      .getByRole("button", { name: "Open selected document", exact: true })
      .click();
    assert.match(
      await page.evaluate(() => richTextStudio.editor.Document.Text),
      /Dear Katherine,/,
    );
    results.push(
      "The Mailings ribbon previews the real styled invitation and reviews generated DOCX results before explicit document replacement",
    );

    await page
      .locator('#word-ribbon [data-control-id="MailMergeRecipients"]')
      .click();
    await service
      .getByRole("button", { name: "Load recipients", exact: true })
      .click();
    await service
      .getByRole("button", { name: "Generate documents", exact: true })
      .click();
    await page.evaluate(() => {
      richTextStudio.editor.Document = richTextStudio.RT.fromText(
        "Unrelated replacement",
      );
    });
    await output
      .getByRole("button", { name: "Open selected document", exact: true })
      .click();
    assert.match(
      await output.getByRole("status").textContent(),
      /template changed/,
    );
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Document.Text),
      "Unrelated replacement",
    );
    await output.getByRole("button", { name: "Close", exact: true }).click();
    results.push(
      "The generated-results picker refuses to overwrite a document replaced while results were open",
    );
  } catch (error) {
    await page.screenshot({
      path: "test-results/mail-merge-failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(async (saved) => {
      document.getElementById("mail-merge-results")?.close();
      document.getElementById("merge-check-toolbar")?.Dispose();
      document.getElementById("merge-check-editor")?.Dispose();
      document.getElementById("merge-check-host")?.remove();
      delete window.mergeCheckResults;
      document
        .getElementById("document-command-service")
        ?.shadowRoot?.querySelector("dialog[open]")
        ?.close();
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
