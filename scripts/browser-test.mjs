import { runWordAuthoringBrowserChecks } from "../tests/word-authoring.browser.mjs";
import { runPageAuthoringBrowserChecks } from "../tests/page-authoring.browser.mjs";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { runControlBrowserChecks } from "../tests/control.browser.mjs";
import { runReactBrowserChecks } from "../tests/react.browser.mjs";
import { runReviewBrowserChecks } from "../tests/review.browser.mjs";
import { runToolbarBrowserChecks } from "../tests/toolbar.browser.mjs";
import { runPDFBrowserChecks } from "../tests/pdf.browser.mjs";
import { runLayoutBrowserChecks } from "../tests/layout.browser.mjs";
import { runWorkspaceBrowserChecks } from "../tests/workspace.browser.mjs";
import { runRichCollaborationBrowserChecks } from "../tests/collaboration.browser.mjs";
import { runAuthoringBrowserChecks } from "../tests/authoring.browser.mjs";
import { runAuthoringPolishBrowserChecks } from "../tests/authoring-polish.browser.mjs";
const port = process.env.PORT || "4190";
const external = process.env.BROWSER_TEST_URL;
const base = external || `http://127.0.0.1:${port}`;
const server = external
  ? null
  : spawn(process.execPath, ["scripts/serve.mjs"], {
      env: { ...process.env, PORT: port },
      stdio: "ignore",
    });
await mkdir("test-results", { recursive: true });
let browser;
const results = [];
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const options = { headless: true };
  if (process.env.CHROMIUM_EXECUTABLE) {
    options.executablePath = process.env.CHROMIUM_EXECUTABLE;
    options.args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ];
  }
  browser = await chromium.launch(options);
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => window.richTextStudio?.editor?.Document.Text.length > 0,
  );
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  const initial = await page.evaluate(() => ({
    text: richTextStudio.editor.Document.Text,
    headings: document.querySelectorAll("#outline button").length,
    zoom: richTextStudio.editor.Zoom,
  }));
  assert(initial.text.includes("The way we work"));
  assert(initial.headings >= 4);
  assert.equal(initial.zoom, 1);
  results.push("Sample initial document, outline and zoom");
  const controlResults = await runControlBrowserChecks(page);
  results.push(
    ...(Array.isArray(controlResults)
      ? controlResults
      : Array.from(
          { length: controlResults },
          (_, i) => `Control browser check ${i + 1}`,
        )),
  );
  results.push(...(await runLayoutBrowserChecks(page)));
  results.push(...(await runAuthoringBrowserChecks(page)));
  results.push(...(await runAuthoringPolishBrowserChecks(page)));
  results.push(...(await runPageAuthoringBrowserChecks(page)));
  results.push(...(await runWordAuthoringBrowserChecks(page)));
  results.push(...(await runWorkspaceBrowserChecks(page)));
  results.push(...(await runRichCollaborationBrowserChecks(page)));
  const reactResults = await runReactBrowserChecks(page);
  results.push(
    ...Array.from(
      { length: reactResults },
      (_, i) => `React browser check ${i + 1}`,
    ),
  );
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Developer", exact: true })
    .click();
  await page
    .locator('#word-ribbon [data-control-id="source-markdown"]')
    .click();
  await page
    .locator("#source-code")
    .fill("# Browser test\n\nHello **rich text** world.");
  await page.locator("#apply-source").click();
  assert.equal(
    await page.evaluate(() => richTextStudio.editor.Document.Text),
    "Browser test\nHello rich text world.",
  );
  results.push("Markdown source editing updates model");
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Home", exact: true })
    .click();
  await page.evaluate(() => richTextStudio.editor.Select(13, 18));
  await page.locator('#word-ribbon [data-control-id="ToggleBold"]').click();
  assert(
    await page.evaluate(() =>
      richTextStudio.RT.toHTML(richTextStudio.editor.Document).includes(
        "font-weight:bold",
      ),
    ),
  );
  results.push("Ribbon formatting retains document selection");
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Insert", exact: true })
    .click();
  await page.locator('#word-ribbon [data-control-id="Table"]').click();
  await page.locator('#document-command-service input[name="rows"]').fill("2");
  await page
    .locator('#document-command-service input[name="columns"]')
    .fill("2");
  await page
    .locator("#document-command-service")
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await page.waitForFunction(() =>
    richTextStudio.RT.toHTML(richTextStudio.editor.Document).includes("<table"),
  );
  results.push("Table insertion from dialog");
  results.push(...(await runReviewBrowserChecks(page)));
  results.push(...(await runToolbarBrowserChecks(page)));
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Review", exact: true })
    .click();
  await page
    .locator('#word-ribbon [data-control-id="collaboration-demo"]')
    .click();
  await page.locator(".collaboration-dialog [data-network]").click();
  await page.evaluate(() => {
    const dialog = document.querySelector(".collaboration-dialog");
    dialog.editors[0].Engine.Select(0);
    dialog.editors[0].Engine.InsertText("Ada: ");
    dialog.editors[1].Engine.Select(0);
    dialog.editors[1].Engine.InsertText("Grace: ");
  });
  await page.locator(".collaboration-dialog [data-network]").click();
  const peers = await page.evaluate(() =>
    document
      .querySelector(".collaboration-dialog")
      .editors.map((editor) => editor.Document.Text),
  );
  assert.equal(peers[0], peers[1]);
  assert(peers[0].includes("Ada: ") && peers[0].includes("Grace: "));
  await page.locator(".collaboration-dialog [data-close]").click();
  results.push(
    "Two reusable editors converge after offline concurrent edits and reconnection",
  );
  await page.evaluate(() => richTextStudio.loadTemplate("welcome"));
  await page.locator("#export-primary").click();
  const pendingDownload = page.waitForEvent("download");
  await page.locator('[data-export="docx"]').click();
  const dl = await pendingDownload;
  assert(dl.suggestedFilename().endsWith(".docx"));
  results.push("DOCX export download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .locator("#word-ribbon")
    .getByRole("button", { name: "Open PDF workspace", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("rich-pdf-editor")?.Engine?.PageCount > 0,
  );
  await page.evaluate(async () => {
    const pdf = document.querySelector("rich-pdf-editor");
    await pdf.AddText(0, "Reviewed", { x: 50, y: 50, fontSize: 14 });
  });
  const pendingPDF = page.waitForEvent("download");
  await page.locator('rich-pdf-editor [data-command="save"]').click();
  assert((await pendingPDF).suggestedFilename().endsWith(".pdf"));
  await page.locator("[data-close]").click();
  results.push("PDF workspace conversion, overlay and download");
  results.push(...(await runPDFBrowserChecks(page)));
  await page.evaluate(() => richTextStudio.loadTemplate("welcome"));
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Home", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.getElementById("toast")?.classList.contains("visible"),
  );
  await page.locator("#theme-toggle").click();
  assert(
    await page.locator("body").evaluate((el) => el.classList.contains("dark")),
  );
  await page.screenshot({ path: "test-results/studio-dark.png" });
  results.push("Dark theme");
  await page.locator("#theme-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  results.push("Mobile shell has no horizontal overflow");
  await page.setViewportSize({ width: 1512, height: 982 });
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "View", exact: true })
    .click();
  await page
    .locator("#word-ribbon")
    .getByRole("button", { name: "Properties", exact: true })
    .click();
  await page
    .locator("#word-ribbon")
    .getByRole("tab", { name: "Home", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  results.push("No uncaught browser errors");
  await writeFile(
    "test-results/browser.json",
    JSON.stringify({ browser: browser.version(), results }, null, 2),
  );
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}
