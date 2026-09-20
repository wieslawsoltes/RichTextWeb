import assert from "node:assert/strict";

export async function runContentControlBrowserChecks(page) {
  const results = [],
    viewport = page.viewportSize();
  const initial = await page.evaluate(() => {
    const { editor, workspace } = richTextStudio;
    const saved = {
      document: editor.Document.ToJSON(),
      view: editor.DocumentView,
      zoom: editor.Zoom,
      zoomMode: editor.ZoomMode,
      layout: workspace.Docking.SaveLayout(),
      title: document.getElementById("document-title").value,
    };
    const host = document.createElement("section");
    host.id = "form-check-host";
    host.style.cssText =
      "position:fixed;inset:16px;z-index:10000;background:white;overflow:auto;padding:12px;display:flex;flex-direction:column";
    const e = document.createElement("rich-text-box"),
      t = document.createElement("rich-text-toolbar");
    e.id = "form-check-editor";
    e.ViewMode = "continuous";
    e.style.cssText = "display:block;height:420px;flex:1;min-height:200px";
    e.setAttribute("theme", "light");
    t.id = "form-check-toolbar";
    t.Mode = "insert";
    t.Editor = e;
    host.append(t, e);
    document.body.append(host);
    return saved;
  });
  const toolbar = page.locator("#form-check-toolbar"),
    editor = page.locator("#form-check-editor");
  const command = (name, id) =>
    page.evaluate(
      ([name, id]) =>
        document.getElementById("form-check-toolbar").Execute(name, id),
      [name, id],
    );
  const apply = () =>
    toolbar
      .locator("dialog[open]")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
  const data = () =>
    page.evaluate(() =>
      document.getElementById("form-check-editor").GetFormData(),
    );
  try {
    await command("InsertContentControl");
    await toolbar.locator('input[name="title"]').fill("Name");
    await toolbar.locator('input[name="tag"]').fill("name");
    await toolbar.locator('select[name="required"]').selectOption("Yes");
    await apply();
    assert.equal((await data()).name, "");
    assert.equal(
      await editor.locator('[data-rt-control-placeholder="true"]').count(),
      1,
    );
    await editor.locator("[data-rt-content-control]").click();
    await toolbar.locator('input[name="value"]').fill("Ada");
    await apply();
    assert.equal((await data()).name, "Ada");
    await page.evaluate(() =>
      document.getElementById("form-check-editor").Undo(),
    );
    assert.equal((await data()).name, "");
    await page.evaluate(() =>
      document.getElementById("form-check-editor").Redo(),
    );
    results.push(
      "Content-control insertion and placeholder filling use shared dialogs and one-step undo",
    );

    await page.evaluate(() => {
      const e = document.getElementById("form-check-editor");
      e.Engine.SelectContentControl(e.GetContentControls()[0].Id);
    });
    await command("ContentControlProperties");
    await toolbar.locator('select[name="lockControl"]').selectOption("Yes");
    await toolbar.locator('select[name="lockContents"]').selectOption("Yes");
    await apply();
    const locked = await page.evaluate(() => {
      const e = document.getElementById("form-check-editor");
      let rejected = 0;
      e.addEventListener("inputrejected", () => rejected++);
      e.Select(1);
      const event = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "X",
        cancelable: true,
        bubbles: true,
        composed: true,
      });
      e.shadowRoot.querySelector('[part="editor"]').dispatchEvent(event);
      return {
        rejected,
        cancelled: event.defaultPrevented,
        text: e.Document.Text,
      };
    });
    assert.deepEqual(locked, { rejected: 1, cancelled: true, text: "Ada" });
    await command("RemoveContentControl").then(
      () => assert.fail("Deletion should reject"),
      (error) => assert.match(error.message, /cannot be removed/),
    );
    results.push(
      "Independent content/deletion locks reject model and native input changes without browser corruption",
    );

    const ids = await page.evaluate(() => {
      const e = document.getElementById("form-check-editor"),
        R = richTextStudio.RT;
      e.Document = R.fromText("");
      const ids = {};
      for (const [tag, Kind, Value, options] of [
        ["ready", "CheckBox", false, {}],
        ["date", "Date", "2026-09-20", { DateFormat: "dd/MM/yyyy" }],
        [
          "team",
          "DropDownList",
          "a",
          {
            Items: [
              { DisplayText: "Alpha", Value: "a" },
              { DisplayText: "Beta", Value: "b" },
            ],
          },
        ],
        [
          "channel",
          "ComboBox",
          "Custom",
          { Items: [{ DisplayText: "Web", Value: "web" }] },
        ],
        ["notes", "RichText", "Details", { Level: "Block" }],
      ]) {
        e.Engine.Select(e.Document.Text.length);
        if (e.Document.Text) e.Engine.InsertParagraph();
        ids[tag] = e.Engine.InsertContentControl(
          { Kind, Tag: tag, Title: tag, ...options },
          Value,
        );
      }
      return ids;
    });
    const check = editor.getByRole("checkbox", { name: "ready", exact: true });
    await check.click();
    assert.equal((await data()).ready, true);
    assert.equal(await check.getAttribute("aria-checked"), "true");
    await check.focus();
    await page.keyboard.press("Space");
    assert.equal((await data()).ready, false);
    results.push(
      "Rendered checkbox controls toggle by pointer and keyboard with accessible state",
    );
    await editor.locator(`[data-rt-content-control="${ids.team}"]`).click();
    await toolbar.locator('select[name="value"]').selectOption("b");
    await apply();
    assert.equal((await data()).team, "b");
    assert.match(
      await editor
        .locator(`[data-rt-content-control="${ids.team}"]`)
        .textContent(),
      /Beta/,
    );
    await editor.locator(`[data-rt-content-control="${ids.date}"]`).click();
    await toolbar.locator('input[type="date"]').fill("2026-10-05");
    await apply();
    assert.equal((await data()).date, "2026-10-05");
    assert.match(
      await editor
        .locator(`[data-rt-content-control="${ids.date}"]`)
        .textContent(),
      /05\/10\/2026/,
    );
    await command("EditContentControl", ids.channel);
    await toolbar.locator('input[name="value"]').fill("In person");
    await apply();
    assert.equal((await data()).channel, "In person");
    results.push(
      "Date, dropdown and free-entry combo controls preserve typed values separately from display labels",
    );

    await command("EditContentControl", ids.notes);
    await page.evaluate(() => {
      const t = document.getElementById("form-check-toolbar"),
        e = t.shadowRoot.querySelector("dialog rich-text-box");
      e.SelectAll();
      e.Engine.InsertText("Rich draft");
      e.SelectAll();
      e.Engine.ApplyProperty("FontWeight", "Bold");
    });
    await apply();
    assert.equal((await data()).notes, "Rich draft");
    await command("EditContentControl", ids.notes);
    await page.evaluate(() => {
      const e = document
        .getElementById("form-check-toolbar")
        .shadowRoot.querySelector("dialog rich-text-box");
      e.SelectAll();
      e.Engine.InsertText("Discard");
    });
    await toolbar
      .locator("dialog[open]")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    assert.equal((await data()).notes, "Rich draft");
    assert.equal(
      await page.evaluate(
        (id) =>
          document
            .getElementById("form-check-editor")
            .GetContentControls()
            .find((c) => c.Id === id).Content[0].children[0].props.FontWeight,
        ids.notes,
      ),
      "Bold",
    );
    results.push(
      "Rich content-control drafts preserve formatting, apply once and cancel without changing parent content",
    );

    const before = await data();
    await command("FillForm");
    await toolbar
      .locator('textarea[name="data"]')
      .fill(JSON.stringify({ team: "a", date: "2026-02-30" }));
    await apply();
    assert.match(
      await toolbar.locator('dialog[open] [role="alert"]').textContent(),
      /date/i,
    );
    assert.deepEqual(await data(), before);
    await toolbar
      .locator('textarea[name="data"]')
      .fill(JSON.stringify({ team: "a", ready: true, date: "2026-10-10" }));
    await apply();
    assert.equal((await data()).ready, true);
    await page.evaluate(() =>
      document.getElementById("form-check-editor").Undo(),
    );
    assert.deepEqual(await data(), before);
    results.push(
      "Fill Form validates every value before mutation and groups successful changes into one undo step",
    );

    await command("EditContentControl", ids.channel);
    await toolbar.locator('input[name="value"]').fill("Stale");
    await page.evaluate(
      (id) =>
        document
          .getElementById("form-check-editor")
          .SetContentControlValue(id, "Concurrent"),
      ids.channel,
    );
    await apply();
    assert.match(
      await toolbar.locator('dialog[open] [role="alert"]').textContent(),
      /changed/,
    );
    assert.equal((await data()).channel, "Concurrent");
    await toolbar
      .locator("dialog[open]")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await command("EditContentControl", ids.channel);
    await page.evaluate(() => {
      document.getElementById("form-check-editor").IsReadOnly = true;
    });
    await apply();
    assert.equal(await toolbar.locator("dialog[open]").count(), 0);
    assert.equal((await data()).channel, "Concurrent");
    await command("FormData");
    assert.match(
      await toolbar.locator('textarea[aria-label="Form data"]').inputValue(),
      /Concurrent/,
    );
    await toolbar
      .locator("dialog[open]")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    const readOnly = await page.evaluate((id) => {
      const e = document.getElementById("form-check-editor");
      return [
        e.SetContentControlValue(id, "No"),
        e.FillForm({ channel: "No" }),
        e.Execute("GetFormData").channel,
      ];
    }, ids.channel);
    assert.deepEqual(readOnly, [false, false, "Concurrent"]);
    results.push(
      "Stale-control drafts reject overwrites while read-only hosts allow form inspection but not filling",
    );

    await page.evaluate(() => {
      document.getElementById("form-check-editor").IsReadOnly = false;
    });
    await command("ContentControlProperties", ids.notes);
    await page.setViewportSize({ width: 390, height: 844 });
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
        bounds.height <= 760,
    );
    await page.screenshot({
      path: "test-results/form-properties-mobile.png",
      fullPage: true,
    });
    await toolbar
      .locator("dialog[open]")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.setViewportSize(viewport);
    results.push(
      "Content-control properties remain bounded and scrollable on a mobile viewport",
    );

    await page.evaluate(() => {
      document.getElementById("form-check-host").style.display = "none";
      richTextStudio.editor.IsReadOnly = false;
      richTextStudio.editor.DocumentView = "WebLayout";
      richTextStudio.loadTemplate("forms");
    });
    const sample = await page.evaluate(() => ({
      count: richTextStudio.editor.GetContentControls().length,
      missing: richTextStudio.editor.ValidateForm().length,
      data: richTextStudio.editor.GetFormData(),
    }));
    assert.equal(sample.count, 8);
    assert.equal(sample.missing, 2);
    assert.equal(sample.data.reference, "BRIEF-001");
    await page
      .locator("#word-ribbon")
      .getByRole("tab", { name: "Developer", exact: true })
      .click();
    for (const id of [
      "InsertContentControl",
      "ContentControlProperties",
      "EditContentControl",
      "RemoveContentControl",
      "FormData",
      "FillForm",
      "ValidateForm",
    ])
      assert.equal(
        await page.locator(`#word-ribbon [data-control-id="${id}"]`).count(),
        1,
      );
    await page.locator('#word-ribbon [data-control-id="FillForm"]').click();
    const service = page.locator("#document-command-service");
    await service
      .locator('textarea[name="data"]')
      .fill(
        JSON.stringify({
          project: "Reusable forms",
          ready: true,
          department: "design",
        }),
      );
    await service
      .locator("dialog[open]")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.ValidateForm().length),
      0,
    );
    await page.screenshot({
      path: "test-results/content-controls-sample.png",
      fullPage: true,
    });
    await page.evaluate(() => richTextStudio.editor.Undo());
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.ValidateForm().length),
      2,
    );
    results.push(
      "Developer ribbon and project brief sample expose eight real controls and atomic form filling",
    );
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(async (saved) => {
      const t = document.getElementById("form-check-toolbar"),
        e = document.getElementById("form-check-editor");
      t?.Dispose();
      e?.Dispose();
      document.getElementById("form-check-host")?.remove();
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
