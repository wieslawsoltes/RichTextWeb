import { createThemesSample } from "./themes.js";
import { createStylesSample } from "./styles.js";
import { createFormsSample } from "./forms.js";
import * as RT from "../src/index.ts";
import { createWordWorkspace } from "./word-workspace.js";
import { openPDFTools } from "./pdf-tools.js";
import { openCollaborationDemo } from "./collaboration-demo.js";
const $ = (id) => document.getElementById(id);
RT.registerRichTextWeb?.();
RT.registerRichTextToolbar?.();
const editor = $("editor");
let wordWorkspace;
let lastOutlineDocument, lastOutlineRevision;
let tab = "home",
  panel = "document",
  sourceFormat = "markdown",
  saved = true,
  currentMatches = [],
  matchIndex = 0;
const state = { title: "The way we work", theme: "light", zoom: 100 };
const mutationCommands = new Set([
  "undo",
  "redo",
  "bold",
  "italic",
  "underline",
  "strike",
  "superscript",
  "align-left",
  "align-center",
  "align-right",
  "align-justify",
  "normal",
  "heading1",
  "heading2",
  "clear-format",
  "bullets",
  "numbering",
  "new",
  "open",
  "table",
  "table-row-before",
  "table-row-after",
  "table-row-delete",
  "table-column-before",
  "table-column-after",
  "table-column-delete",
  "table-delete",
  "link",
  "image",
  "page-break",
  "date",
  "symbol",
  "code",
  "a4",
  "letter",
  "landscape",
  "margins",
  "spacing",
  "indent",
  "outdent",
  "comment",
  "bookmark",
  "large-document",
]);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3500);
}
function safe(fn) {
  try {
    const result = fn();
    if (result?.catch) result.catch((e) => toast(e.message));
    return result;
  } catch (e) {
    toast(e.message);
    console.error(e);
  }
}
function action(fn) {
  safe(() => {
    fn();
    editor.Focus?.();
    update();
  });
}
function canEdit() {
  if (!editor.IsReadOnly) return true;
  toast("Turn off read-only mode to edit this document.");
  return false;
}
function edit(fn) {
  if (canEdit())
    return action(() => {
      if (canEdit()) fn();
    });
}
function updateReadOnlyControls() {
  const locked = editor.IsReadOnly;
  document.querySelectorAll("[data-command]").forEach((button) => {
    if (mutationCommands.has(button.dataset.command))
      button.disabled =
        locked ||
        (button.dataset.command === "undo" && !editor.Engine.CanUndo) ||
        (button.dataset.command === "redo" && !editor.Engine.CanRedo);
  });
  for (const id of [
    "font-family",
    "font-size",
    "text-color",
    "highlight-color",
    "paper-size",
    "orientation",
    "margins-select",
    "apply-source",
    "replace-all",
    "new-comment",
    "new-bookmark",
    "document-title",
  ])
    if ($(id)) $(id).disabled = locked;
  document
    .querySelectorAll(
      "[data-comment-resolve],[data-comment-delete],[data-bookmark-delete],[data-example]",
    )
    .forEach((button) => (button.disabled = locked));
  if ($("source-code")) $("source-code").readOnly = locked;
}
const templates = {
  themes: {
    name: "Connected document themes",
    description:
      "Live palette and font schemes, theme-linked styles, direct overrides and native DOCX themes.",
    build() {
      return createThemesSample(RT);
    },
  },
  styles: {
    name: "Named document styles",
    description:
      "Live paragraph and character styles, inheritance, direct overrides and native DOCX style definitions.",
    build() {
      return createStylesSample(RT);
    },
  },
  forms: {
    name: "Fillable project brief",
    description:
      "Typed content controls, dates, choices, rich drafts, required values and native DOCX forms.",
    build() {
      return createFormsSample(RT);
    },
  },
  automation: {
    name: "Word authoring & automation",
    description:
      "Live table formulas, captions, references, document properties and field controls.",
    build() {
      const d = RT.fromHTML(`<h1>Word authoring &amp; automation</h1>
        <p>This example uses the standalone engine and reusable controls. Select a value and use Table layout → Formula or Sort. Press F9 to refresh formulas and their linked references together.</p>
        <h2>Estimate</h2><table><tbody>
        <tr><td>Description</td><td>Quantity</td><td>Unit price</td><td>Amount</td></tr>
        <tr><td>Editing</td><td>2</td><td>75</td><td>CALC_EDIT</td></tr>
        <tr><td>Design</td><td>3</td><td>90</td><td>CALC_DESIGN</td></tr>
        <tr><td>Total</td><td></td><td></td><td>CALC_TOTAL</td></tr>
        </tbody></table><p>Project: PROJECT_NAME. Budget: BUDGET_AMOUNT. Approval: APPROVAL.</p><p>Linked total: ESTIMATE_REF</p>`);
      d.SetValue("Title", "Word authoring & automation");
      d.SetValue("CustomProperties", {
        Project: "Document Studio",
        Approved: true,
      });
      const engine = new RT.RichTextEngine(d),
        features = new RT.DocumentFeatures(engine);
      engine.Select(d.Text.indexOf("Description"));
      engine.SetTableHeaderRows(1);
      features.SetDocumentVariable("Budget", 500);
      const fieldIds = new Map();
      for (const [marker, code] of [
        ["CALC_EDIT", '= B2*C2 \\# "#,##0.00"'],
        ["CALC_DESIGN", '= PRODUCT(B3:C3) \\# "#,##0.00"'],
        ["CALC_TOTAL", '= SUM(ABOVE) \\# "#,##0.00"'],
        ["PROJECT_NAME", "DOCPROPERTY Project"],
        ["BUDGET_AMOUNT", 'DOCVARIABLE Budget \\# "0.00"'],
        [
          "APPROVAL",
          'IF BudgetAmount >= EstimateTotal "Within budget" "Review estimate"',
        ],
      ]) {
        const start = d.Text.indexOf(marker);
        engine.Select(start, start + marker.length);
        const id = features.InsertFieldCode(code);
        fieldIds.set(marker, id);
      }
      for (const [marker, name] of [
        ["CALC_TOTAL", "EstimateTotal"],
        ["BUDGET_AMOUNT", "BudgetAmount"],
      ]) {
        const target = d.FindById(fieldIds.get(marker));
        engine.Select(target.ContentStart.Offset, target.ContentEnd.Offset);
        engine.AddBookmark(name);
      }
      const referenceStart = d.Text.indexOf("ESTIMATE_REF");
      engine.Select(referenceStart, referenceStart + "ESTIMATE_REF".length);
      features.InsertFieldCode("REF EstimateTotal");
      features.UpdateFields({ ReferenceMode: "Current" });
      engine.Select(d.Text.length);
      const caption = features.InsertCaption({
        Label: "Table",
        Text: "Estimated project effort",
      });
      engine.Select(d.Text.length);
      engine.InsertParagraph();
      engine.InsertText("See ");
      features.InsertCrossReference(caption.LabelNumberBookmark);
      engine.InsertText(
        " for the estimate. References → Field code edits an existing field; Lock field retains its cached value. Word count is available on Review.",
      );
      engine.Select(d.Text.length);
      engine.InsertParagraph();
      features.InsertTableOfFigures("Table", {
        Title: "List of tables",
        IncludePageNumbers: false,
      });
      engine.Dispose();
      return d;
    },
  },
  mathematics: {
    name: "Mathematics & science",
    description:
      "Editable vector equations, matrices, calculus and chemical notation.",
    build() {
      const d = new RT.FlowDocument();
      d.PageWidth = 794;
      d.PageHeight = 1123;
      d.PagePadding = new RT.Thickness(64);
      const heading = new RT.Paragraph("Mathematics & science");
      heading.HeadingLevel = 1;
      d.Blocks.Add(heading);
      d.Blocks.Add(
        new RT.Paragraph(
          "Double-click an equation to edit symbols and structures. The source remains editable LaTeX or MathML, and DOCX writes native Office equations.",
        ),
      );
      for (const name of [
        "Quadratic formula",
        "Integral",
        "Matrix",
        "Normal distribution",
        "Chemical equilibrium",
        "Euler identity",
      ]) {
        const template = RT.EquationTemplates.find((t) => t.Name === name);
        const h = new RT.Paragraph(name);
        h.HeadingLevel = 2;
        d.Blocks.Add(h);
        const equation = new RT.Equation(template.Source, "latex", true);
        equation.AlternativeText = name;
        d.Blocks.Add(new RT.Paragraph(equation));
      }
      return d;
    },
  },
  pagination: {
    name: "Pages, columns & stories",
    description:
      "Physical page breaks, two-column flow, headers and page numbers.",
    build() {
      const d = new RT.FlowDocument();
      d.PageWidth = 794;
      d.PageHeight = 1123;
      d.PagePadding = new RT.Thickness(60);
      d.SetValue("ColumnCount", 2);
      d.SetValue("ColumnGap", 30);
      for (let chapter = 1; chapter <= 3; chapter++) {
        const heading = new RT.Paragraph(`Chapter ${chapter}`);
        heading.HeadingLevel = 1;
        heading.BreakPageBefore = chapter > 1;
        heading.KeepWithNext = true;
        d.Blocks.Add(heading);
        for (let index = 0; index < 9; index++)
          d.Blocks.Add(
            new RT.Paragraph(
              `Section ${chapter}.${index + 1}. ` +
                "A document flows through columns and then continues on the next physical sheet. Explicit page breaks skip any remaining columns. ".repeat(
                  2,
                ),
            ),
          );
      }
      const engine = new RT.RichTextEngine(d),
        features = new RT.DocumentFeatures(engine);
      features.SetStory("Headers", [
        new RT.Paragraph("PAGINATION STUDY · RichTextWeb").ToJSON(),
      ]);
      const footer = new RT.Paragraph(new RT.Run("Page "));
      footer.Inlines.Add(RT.createField("PAGE"));
      footer.Inlines.Add(new RT.Run(" of "));
      footer.Inlines.Add(RT.createField("NUMPAGES"));
      features.SetStory("Footers", [footer.ToJSON()]);
      engine.Dispose();
      return d;
    },
  },
  welcome: {
    name: "The way we work",
    description: "A polished document with styles, tables, lists, and links.",
    html: `<p style="color:#1254a3;font-size:12px;letter-spacing:2px">NORTHSTAR / FIELD NOTES 01</p><h1 style="font-size:42px;color:#172d4e;font-family:Georgia">The way we work</h1><p style="font-size:18px;color:#718097">A practical guide to making room for meaningful work.</p><p style="color:#788392;font-size:12px">SEPTEMBER 2026 &nbsp; · &nbsp; WORKPLACE & CULTURE</p><p>Good work begins with a clear idea. A few considered words become a shared direction. A shared direction becomes something worth building.</p><h2 style="color:#1c487f;font-size:22px">01 &nbsp; Start with what matters</h2><p>We believe the best documents make complex ideas feel simple. They give every thought a place, every decision a reason, and every reader a way forward.</p><p><strong>Our principle:</strong> write with intention. Use structure to support your message, and give important ideas the space they deserve.</p><h2 style="color:#1c487f;font-size:22px">02 &nbsp; Build a shared rhythm</h2><p>A little structure creates a lot of freedom. These three practices help our team stay connected without adding more meetings.</p><table><tbody><tr><td style="background:#edf3fb"><p><strong>Practice</strong></p></td><td style="background:#edf3fb"><p><strong>When</strong></p></td><td style="background:#edf3fb"><p><strong>Purpose</strong></p></td></tr><tr><td><p>Weekly note</p></td><td><p>Monday</p></td><td><p>Set a clear intention</p></td></tr><tr><td><p>Open studio</p></td><td><p>Wednesday</p></td><td><p>Share work in progress</p></td></tr><tr><td><p>Reflection</p></td><td><p>Friday</p></td><td><p>Learn and carry it forward</p></td></tr></tbody></table><h2 style="color:#1c487f;font-size:22px">03 &nbsp; Make the next step clear</h2><ul><li><p>Choose one outcome that will make a difference.</p></li><li><p>Leave room for curiosity and unexpected connections.</p></li><li><p>Share your thinking early. Better work happens together.</p></li></ul><p><em>Clarity is a practice. This document is a place to begin.</em></p>`,
  },
  blank: {
    name: "Untitled document",
    description: "A clean page for your next idea.",
    html: "<p></p>",
  },
  report: {
    name: "Quarterly review",
    description: "A report with headings, ordered lists, and a data table.",
    html: "<h1>Quarterly review</h1><p><strong>Prepared by:</strong> Studio team · <em>September 2026</em></p><h2>Executive overview</h2><p>This quarter, our work focused on three priorities: clarity, consistency, and a better experience for everyone.</p><h2>Key results</h2><table><tr><td><p><strong>Measure</strong></p></td><td><p><strong>Previous</strong></p></td><td><p><strong>Current</strong></p></td></tr><tr><td><p>Completed projects</p></td><td><p>12</p></td><td><p>18</p></td></tr><tr><td><p>Team satisfaction</p></td><td><p>82%</p></td><td><p>91%</p></td></tr></table><h2>Next quarter</h2><ol><li><p>Consolidate research into a shared resource.</p></li><li><p>Refine the onboarding experience.</p></li><li><p>Document decisions as they happen.</p></li></ol>",
  },
  formatting: {
    name: "Typography & formatting",
    description: "Inline styles, multilingual text, and nested formatting.",
    html: '<h1>Every word, considered.</h1><h2>Inline formatting</h2><p>Text can be <strong>bold</strong>, <em>italic</em>, <u>underlined</u>, <s>struck through</s>, <span style="color:#1254a3">colored</span>, or <span style="background:#fff0a6">highlighted</span>. Combine <strong><em>styles naturally</em></strong>.</p><p>Superscript: E = mc<sup>2</sup>. Subscript: H<sub>2</sub>O.</p><h2>Languages belong together</h2><p>Zażółć gęślą jaźń. Καλημέρα κόσμε. こんにちは世界。 안녕하세요. 👩🏽‍💻 🌍</p><p dir="rtl">مرحبا بالعالم — أهلاً وسهلاً</p><h2>Links and line breaks</h2><p>Visit <a href="https://github.com/wieslawsoltes/RichTextWeb">the project repository</a>.<br>A line break keeps text in the same paragraph.</p><blockquote><p>“The details are not the details. They make the design.”</p></blockquote>',
  },
  lists: {
    name: "Lists & planning",
    description: "Nested lists, numbered steps, and checklists.",
    html: "<h1>A plan worth following</h1><h2>Project checklist</h2><ul><li><p>Gather the context</p><ul><li><p>Review existing research</p></li><li><p>Talk to the people doing the work</p></li></ul></li><li><p>Frame the opportunity</p></li><li><p>Create a small, useful prototype</p></li></ul><h2>Working sequence</h2><ol><li><p>Explore the question.</p></li><li><p>Test the assumptions.</p></li><li><p>Share the results.</p></li></ol><h2>Notes</h2><p>Use the Home ribbon to change paragraph alignment, style, and spacing.</p>",
  },
  api: {
    name: "Flow document API",
    description: "A document created entirely with .NET-style JavaScript APIs.",
    build() {
      const d = new RT.FlowDocument();
      const h = new RT.Paragraph(new RT.Run("A familiar document model"));
      h.HeadingLevel = 1;
      d.Blocks.Add(h);
      const p = new RT.Paragraph();
      p.Inlines.Add(new RT.Run("Compose documents with "));
      p.Inlines.Add(
        new RT.Bold(new RT.Run("FlowDocument, Paragraph, and Run")),
      );
      p.Inlines.Add(
        new RT.Run(". The same model powers editing and serialization."),
      );
      d.Blocks.Add(p);
      d.Blocks.Add(
        new RT.Paragraph(
          new RT.Run(
            "Select this text, format it, then inspect the document source on the right.",
          ),
        ),
      );
      return d;
    },
  },
};
function loadTemplate(key) {
  if (!canEdit()) return;
  const t = templates[key];
  editor.Document = t.build ? t.build() : RT.fromHTML(t.html);
  state.title = t.name;
  $("document-title").value = t.name;
  update();
  if (panel === "comments") renderPanel();
  persist();
  toast(`Opened ${t.name}`);
}
function persist() {
  try {
    localStorage.setItem(
      "richtextweb-document",
      JSON.stringify({
        document: editor.Document.ToJSON(),
        title: $("document-title").value,
      }),
    );
    $("save-state").textContent = "Saved on this device";
    saved = true;
  } catch {
    $("save-state").textContent = "Storage unavailable";
  }
}
let saveTimer;
function changed() {
  saved = false;
  $("save-state").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
  update();
  if (panel === "comments") renderPanel();
}
function walk(node, fn) {
  fn(node);
  node.children?.forEach((n) => walk(n, fn));
}
function outline() {
  const headings = [];
  let offset = 0;
  walk(RT.materializeDocumentStyles(editor.Document.ToJSON()), (n) => {
    if (n.type === "Paragraph" || n.type === "BlockUIContainer") {
      const text = plain(n);
      if (n.props?.HeadingLevel)
        headings.push({ text, level: n.props.HeadingLevel, offset });
      offset += text.length + 1;
    }
  });
  $("outline").innerHTML = headings.length
    ? headings
        .map(
          (h) =>
            `<button class="${h.level > 1 ? "level2" : ""}" data-offset="${h.offset}">${esc(h.text)}</button>`,
        )
        .join("")
    : '<p class="note" style="padding:10px">Apply a heading style to build an outline.</p>';
  $("outline")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () =>
          action(() => {
            const o = Math.min(
              Number(b.dataset.offset),
              editor.Document.Text.length,
            );
            editor.Engine.Select(o, o);
            editor.Focus();
          })),
    );
}
function plain(n) {
  return n.type === "Run"
    ? n.text || ""
    : n.type === "LineBreak"
      ? "\n"
      : ["Image", "InlineUIContainer", "BlockUIContainer"].includes(n.type)
        ? "\uFFFC"
        : (n.children || []).map(plain).join("");
}
function update() {
  if (!editor.Document) return;
  const text = editor.Document.Text;
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  $("word-count").textContent = `${words.toLocaleString()} words`;
  const sel = editor.Selection;
  const size = sel ? Math.abs(sel.End.Offset - sel.Start.Offset) : 0;
  $("selection-status").textContent = size
    ? `${size} characters selected`
    : `${text.length.toLocaleString()} characters`;
  $("editor-mode").textContent = editor.IsReadOnly ? "Read only" : "Editing";
  if (
    lastOutlineDocument !== editor.Document ||
    lastOutlineRevision !== editor.Document.Revision
  ) {
    outline();
    lastOutlineDocument = editor.Document;
    lastOutlineRevision = editor.Document.Revision;
  }
  wordWorkspace?.Refresh();
  if (panel === "document") updateStats();
  updateReadOnlyControls();
}
function updateStats() {
  const node = editor.Document.ToJSON();
  let blocks = 0;
  walk(node, (n) => {
    if (n.type === "Paragraph") blocks++;
  });
  if ($("stat-paragraphs")) $("stat-paragraphs").textContent = blocks;
  if ($("stat-characters"))
    $("stat-characters").textContent =
      editor.Document.Text.length.toLocaleString();
  if ($("stat-revision"))
    $("stat-revision").textContent = editor.Document.Revision;
}
function renderRibbon() {
  wordWorkspace?.Ribbon.selectTab(tab);
}
function showDialog(title, content, onSubmit) {
  $("dialog-title").textContent = title;
  $("dialog-content").innerHTML = content;
  $("dialog-submit").textContent = "Apply";
  $("dialog").onclose = () => {
    if ($("dialog").returnValue === "default") safe(onSubmit);
  };
  $("dialog").returnValue = "cancel";
  $("dialog").showModal();
}
const field = (label, id, value = "", type = "text", extra = "") =>
  `<label class="dialog-field">${label}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function setDocumentProp(name, value) {
  edit(() => editor.Engine.Change(() => editor.Document.SetValue(name, value)));
}
const viewNames = {
  PrintLayout: "Print layout",
  WebLayout: "Web layout",
  ReadMode: "Read mode",
  Outline: "Outline",
  Draft: "Draft",
};
function syncViewUI() {
  const mode =
    editor.DocumentView ||
    (editor.ViewMode === "page" ? "PrintLayout" : "WebLayout");
  $("view-label").textContent = viewNames[mode];
  $("view-toggle").innerHTML =
    editor.ViewMode === "page" ? "▣ <span>Page</span>" : "☷ <span>Flow</span>";
  if ($("document-view")) $("document-view").value = mode;
  if ($("page-arrangement")) {
    $("page-arrangement").value = editor.PageArrangement;
    $("page-arrangement").disabled = editor.ViewMode !== "page";
  }
  state.zoom = Math.round(editor.Zoom * 100);
  $("zoom").value = state.zoom;
  $("zoom-label").textContent = `${state.zoom}%`;
}
function setView(mode) {
  editor.DocumentView =
    mode === "page"
      ? "PrintLayout"
      : mode === "continuous"
        ? "WebLayout"
        : mode;
  syncViewUI();
}
function zoom(value) {
  state.zoom = Math.max(25, Math.min(400, value));
  editor.Zoom = state.zoom / 100;
  syncViewUI();
}
function openPanel(value) {
  wordWorkspace?.ShowPane("properties");
  panel = value;
  document.body.classList.remove("hide-inspector");
  document
    .querySelectorAll("[data-panel]")
    .forEach((b) => b.classList.toggle("active", b.dataset.panel === value));
  renderPanel();
}
function reviewAnnotations(kind) {
  return editor.Engine.Annotations.filter(
    (item) => item && item.Kind === kind && typeof item.Id === "string",
  );
}
function reviewPanel() {
  const comments = reviewAnnotations("Comment"),
    bookmarks = reviewAnnotations("Bookmark");
  return `<section class="inspector-section"><button class="plain-button wide" id="new-comment">+ New comment</button><p class="note">Comments follow document ranges through edits and undo. JSON saves their anchors and review state.</p><div id="comment-list">${
    comments.length
      ? comments
          .map((c) => {
            const quote = editor.Document.Text.slice(c.Start, c.End),
              data = c.Data || {};
            return `<div class="comment" data-annotation-id="${esc(c.Id)}"><strong>${data.Resolved ? "✓ Resolved" : esc(data.Author || "You")}</strong>${quote ? `<small>“${esc(quote.slice(0, 65))}”</small><br>` : "<small>Document position</small><br>"}${esc(data.Text)}<div><button data-comment-go="${esc(c.Id)}">Go to text</button><button data-comment-resolve="${esc(c.Id)}">${data.Resolved ? "Reopen" : "Resolve"}</button><button data-comment-delete="${esc(c.Id)}">Delete</button></div></div>`;
          })
          .join("")
      : '<p class="note">No comments yet.</p>'
  }</div></section><section class="inspector-section"><h3>Bookmarks</h3><button class="plain-button wide" id="new-bookmark">+ Add bookmark</button><div id="bookmark-list">${bookmarks.length ? bookmarks.map((b) => `<div class="comment"><strong>${esc(b.Data?.Name)}</strong><div><button data-bookmark-go="${esc(b.Id)}">Go to bookmark</button><button data-bookmark-delete="${esc(b.Id)}">Delete</button></div></div>`).join("") : '<p class="note">Save a named position or selection to return to it later.</p>'}</div></section>`;
}
function attachReviewHandlers() {
  $("new-comment").onclick = addComment;
  $("new-bookmark").onclick = addBookmark;
  const annotation = (id) =>
    editor.Engine.Annotations.find((item) => item.Id === id);
  $("comment-list")
    .querySelectorAll("[data-comment-go]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          action(() => {
            const item = annotation(button.dataset.commentGo);
            if (item)
              editor.Engine.Select(
                Math.min(item.Start, editor.Document.Text.length),
                Math.min(item.End, editor.Document.Text.length),
              );
          })),
    );
  $("comment-list")
    .querySelectorAll("[data-comment-resolve]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          edit(() => {
            const item = annotation(button.dataset.commentResolve);
            if (item)
              editor.Engine.UpdateAnnotation(item.Id, {
                Resolved: !item.Data?.Resolved,
              });
          })),
    );
  $("comment-list")
    .querySelectorAll("[data-comment-delete]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          edit(() =>
            editor.Engine.RemoveAnnotation(button.dataset.commentDelete),
          )),
    );
  $("bookmark-list")
    .querySelectorAll("[data-bookmark-go]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          action(() => {
            const item = annotation(button.dataset.bookmarkGo);
            if (item) editor.Engine.GoToBookmark(item.Data.Name);
          })),
    );
  $("bookmark-list")
    .querySelectorAll("[data-bookmark-delete]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          edit(() =>
            editor.Engine.RemoveAnnotation(button.dataset.bookmarkDelete),
          )),
    );
}
function run(command) {
  if (wordWorkspace?.HandleCommand(command)) return;
  if (command === "collaboration-demo") return openCollaborationDemo(RT);
  safe(() => {
    const e = editor.Engine;
    if (mutationCommands.has(command) && !canEdit()) return;
    if (command.startsWith("export-")) return download(command.slice(7));
    if (command.startsWith("source-")) {
      sourceFormat = command.slice(7);
      return openPanel("source");
    }
    switch (command) {
      case "undo":
        e.Undo();
        break;
      case "redo":
        e.Redo();
        break;
      case "select-all":
        editor.SelectAll();
        break;
      case "bold":
        e.ToggleFormat("FontWeight", "Bold", "Normal");
        break;
      case "italic":
        e.ToggleFormat("FontStyle", "Italic", "Normal");
        break;
      case "underline":
        e.ToggleFormat("TextDecorations", "Underline", "None");
        break;
      case "strike":
        e.ToggleFormat("TextDecorations", "Strikethrough", "None");
        break;
      case "superscript":
        e.ToggleFormat("BaselineAlignment", "Superscript", "Baseline");
        break;
      case "align-left":
      case "align-center":
      case "align-right":
      case "align-justify":
        e.SetParagraphProperty(
          "TextAlignment",
          command.slice(6).replace(/^./, (c) => c.toUpperCase()),
        );
        break;
      case "normal":
        e.SetParagraphProperty("HeadingLevel", 0);
        e.SetParagraphProperty("FontSize", 16);
        break;
      case "heading1":
        e.SetParagraphProperty("HeadingLevel", 1);
        break;
      case "heading2":
        e.SetParagraphProperty("HeadingLevel", 2);
        break;
      case "clear-format":
        e.Execute("ClearFormatting");
        break;
      case "bullets":
        e.Execute("ToggleBullets");
        break;
      case "numbering":
        e.Execute("ToggleNumbering");
        break;
      case "pdf-tools":
        openPDFTools(RT, toast, editor.Document);
        return;
      case "new":
        showDialog(
          "New document",
          '<p class="note">Your current document is saved on this device. Export a copy if you want to keep it before starting a new document.</p>',
          () => loadTemplate("blank"),
        );
        return;
      case "open":
        $("file-input").click();
        return;
      case "save":
        persist();
        toast("Document saved on this device");
        return;
      case "table":
        showDialog(
          "Insert table",
          field("Rows", "table-rows", "3", "number", 'min="1" max="50"') +
            field(
              "Columns",
              "table-columns",
              "3",
              "number",
              'min="1" max="12"',
            ),
          () =>
            edit(() =>
              e.InsertTable(
                Math.max(1, Math.min(50, +$("table-rows").value)),
                Math.max(1, Math.min(12, +$("table-columns").value)),
              ),
            ),
        );
        return;
      case "table-row-before":
        e.InsertTableRow(true);
        break;
      case "table-row-after":
        e.InsertTableRow();
        break;
      case "table-row-delete":
        e.DeleteTableRow();
        break;
      case "table-column-before":
        e.InsertTableColumn(true);
        break;
      case "table-column-after":
        e.InsertTableColumn();
        break;
      case "table-column-delete":
        e.DeleteTableColumn();
        break;
      case "table-delete":
        e.DeleteTable();
        break;
      case "link":
        showDialog(
          "Insert link",
          field("Text", "link-text", editor.Selection.Text || "Link") +
            field("URL", "link-url", "https://", "url"),
          () =>
            edit(() => {
              const url = $("link-url").value;
              if (!/^https?:\/\//i.test(url))
                throw Error("Enter an http or https URL.");
              e.InsertHyperlink(url, $("link-text").value);
            }),
        );
        return;
      case "image":
        showDialog(
          "Insert image",
          field("Image URL", "image-url", "", "url") +
            field("Description", "image-alt", "") +
            field(
              "Width",
              "image-width",
              "350",
              "number",
              'min="20" max="700"',
            ) +
            '<p class="note">Use an HTTPS image URL. The description is used by assistive technology.</p>',
          () =>
            edit(() => {
              const url = $("image-url").value;
              if (!/^https:\/\//i.test(url))
                throw Error("Use an HTTPS image URL.");
              e.InsertImage(
                url,
                $("image-alt").value,
                Math.max(20, Math.min(700, +$("image-width").value)),
              );
            }),
        );
        return;
      case "page-break":
        e.InsertPageBreak();
        break;
      case "column-break":
        e.InsertColumnBreak();
        break;
      case "date":
        e.InsertText(
          new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
            new Date(),
          ),
        );
        break;
      case "symbol":
        showDialog(
          "Insert symbol",
          field("Symbol or text", "symbol-value", "©"),
          () => edit(() => e.InsertText($("symbol-value").value)),
        );
        return;
      case "code":
        e.ApplyProperty("FontFamily", "Consolas");
        e.ApplyProperty("Background", "#edf2f7");
        break;
      case "a4":
        setDocumentProp("PageWidth", 794);
        setDocumentProp("PageHeight", 1123);
        openPanel("document");
        return;
      case "letter":
        setDocumentProp("PageWidth", 816);
        setDocumentProp("PageHeight", 1056);
        openPanel("document");
        return;
      case "landscape": {
        const w = editor.Document.PageWidth || 794,
          h = editor.Document.PageHeight || 1123;
        setDocumentProp("PageWidth", h);
        setDocumentProp("PageHeight", w);
        openPanel("document");
        return;
      }
      case "margins":
        showDialog(
          "Page margins",
          field(
            "Margin on all sides (pixels)",
            "margin-value",
            "64",
            "number",
            'min="0" max="200"',
          ),
          () => setDocumentProp("PagePadding", Number($("margin-value").value)),
        );
        return;
      case "spacing":
        showDialog(
          "Paragraph spacing",
          field(
            "Line height multiplier",
            "line-height",
            "1.6",
            "number",
            'step="0.1" min="1" max="3"',
          ),
          () =>
            edit(() =>
              e.SetParagraphProperty(
                "LineHeight",
                Number($("line-height").value) *
                  (Number(editor.Selection.Start.Paragraph?.FontSize) || 16),
              ),
            ),
        );
        return;
      case "indent":
        e.Execute("IncreaseIndentation");
        break;
      case "outdent":
        e.Execute("DecreaseIndentation");
        break;
      case "page":
        setView("page");
        return;
      case "continuous":
        setView("continuous");
        return;
      case "read-mode":
        setView("ReadMode");
        return;
      case "outline-view":
        setView("Outline");
        return;
      case "draft-view":
        setView("Draft");
        return;
      case "fit-width":
        editor.ZoomMode = "PageWidth";
        syncViewUI();
        return;
      case "fit-page":
        editor.ZoomMode = "WholePage";
        syncViewUI();
        return;
      case "two-pages":
        editor.PageArrangement = "TwoPages";
        editor.ZoomMode = "TwoPages";
        syncViewUI();
        return;
      case "vertical-pages":
        editor.PageArrangement = "Vertical";
        syncViewUI();
        return;
      case "multiple-pages":
        editor.PageArrangement = "MultiplePages";
        zoom(50);
        return;
      case "single-page":
        editor.PageArrangement = "SinglePage";
        syncViewUI();
        return;
      case "focus":
        document.body.classList.toggle("focus");
        return;
      case "navigation":
        document.body.classList.toggle("hide-navigation");
        return;
      case "properties":
        openPanel("document");
        return;
      case "source":
        openPanel("source");
        return;
      case "comments":
        openPanel("comments");
        return;
      case "comment":
        addComment();
        return;
      case "bookmark":
        addBookmark();
        return;
      case "read-only":
        editor.IsReadOnly = !editor.IsReadOnly;
        toast(editor.IsReadOnly ? "Read-only mode enabled" : "Editing enabled");
        break;
      case "spellcheck":
        editor.setAttribute(
          "spellcheck",
          editor.getAttribute("spellcheck") === "false" ? "true" : "false",
        );
        toast("Browser spell checking toggled");
        return;
      case "find":
        document.body.classList.remove("hide-navigation");
        $("find-tools").hidden = false;
        $("find-input").focus();
        return;
      case "zoom-reset":
        zoom(100);
        return;
      case "theme":
        toggleTheme();
        return;
      case "print":
        printDocument();
        return;
      case "large-document": {
        const d = new RT.FlowDocument();
        d.BeginChange();
        for (let i = 0; i < 500; i++) {
          const p = new RT.Paragraph(
            new RT.Run(
              `Paragraph ${i + 1}. A reusable text engine keeps the document model independent from any particular editing surface. Search, select, format, and inspect this large document.`,
            ),
          );
          if (i % 50 === 0) p.HeadingLevel = 2;
          d.Blocks.Add(p);
        }
        d.EndChange();
        editor.Document = d;
        $("document-title").value = "Large document · 500 paragraphs";
        changed();
        toast("Created 500 paragraphs");
        return;
      }
      case "api-example":
      case "mvvm-example":
      case "react-example":
      case "bridge-example":
        showCode(command);
        return;
    }
    editor.Focus();
    update();
  });
}
function renderPanel() {
  const labels = {
    document: "Document",
    comments: "Comments",
    source: "Source",
    export: "Export document",
  };
  $("inspector-title").textContent = labels[panel];
  let html = "";
  if (panel === "document")
    html = `<section class="inspector-section"><h3>Page setup</h3><div class="paper-mini" aria-hidden="true">${"<i></i>".repeat(10)}</div><label class="field">Paper size<select id="paper-size"><option value="a4">A4 · 210 × 297 mm</option><option value="letter">Letter · 8.5 × 11 in</option></select></label><label class="field">Orientation<select id="orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label class="field">Margins<select id="margins-select"><option value="72">Normal · 72 px</option><option value="32">Narrow · 32 px</option><option value="96">Wide · 96 px</option></select></label></section><section class="inspector-section"><h3>Document details</h3><div class="property-row"><span>Format</span><strong>Flow document</strong></div><div class="property-row"><span>Paragraphs</span><strong id="stat-paragraphs"></strong></div><div class="property-row"><span>Characters</span><strong id="stat-characters"></strong></div><div class="property-row"><span>Revision</span><strong id="stat-revision"></strong></div></section><section class="inspector-section"><h3>Make it yours</h3><p class="note">Select text to apply formatting. Use heading styles to organize your ideas.</p><p class="note"><span class="help-key">Ctrl B</span> Bold &nbsp; <span class="help-key">Ctrl I</span> Italic</p><button class="plain-button wide" id="panel-export">Export document ↗</button></section>`;
  if (panel === "comments") html = reviewPanel();
  if (panel === "source")
    html = `<section class="inspector-section"><p class="note">Edit the source and apply it to the shared document model.</p><div class="source-buttons"><select id="source-format"><option value="markdown">Markdown</option><option value="html">HTML</option><option value="json">JSON</option><option value="xaml">XAML</option><option value="rtf">RTF</option></select><button id="apply-source">Apply</button></div><textarea id="source-code" class="code-area" aria-label="Document source" spellcheck="false"></textarea><button id="refresh-source" class="plain-button wide">Refresh from document</button><p class="note">JSON preserves the engine model. Other formats preserve their supported features; see format documentation.</p></section>`;
  if (panel === "export")
    html = `<section class="inspector-section"><h3>Choose a format</h3>${[
      ["docx", "Word document", ".docx"],
      ["pdf", "PDF document", ".pdf"],
      ["markdown", "Markdown", ".md"],
      ["html", "Web document", ".html"],
      ["rtf", "Rich text", ".rtf"],
      ["xaml", "Flow document XAML", ".xaml"],
      ["json", "Document model", ".json"],
      ["text", "Plain text", ".txt"],
    ]
      .map(
        ([f, n, e]) =>
          `<button class="export-item" data-export="${f}">${n}<span>${e} ↓</span></button>`,
      )
      .join(
        "",
      )}<p class="note">Exports use the features supported by each format. PDF export includes vector equations and a separate flow layout. Use Browser print / PDF for the measured page layout, headers and columns.</p><button class="plain-button wide" id="browser-print">Browser print / PDF</button></section>`;
  $("inspector-content").innerHTML = html;
  if (panel === "document") {
    updateStats();
    $("paper-size").onchange = (e) => run(e.target.value);
    $("orientation").value =
      editor.Document.PageWidth > editor.Document.PageHeight
        ? "landscape"
        : "portrait";
    $("paper-size").value =
      Math.abs(
        Math.min(editor.Document.PageWidth, editor.Document.PageHeight) - 816,
      ) < 2
        ? "letter"
        : "a4";
    const padding = editor.Document.PagePadding;
    const uniform =
      typeof padding === "number"
        ? padding
        : padding &&
            padding.Left === padding.Right &&
            padding.Left === padding.Top &&
            padding.Left === padding.Bottom
          ? padding.Left
          : null;
    if (![72, 32, 96].includes(uniform))
      $("margins-select").add(new Option("Custom margins", "custom"));
    $("margins-select").value =
      uniform === null || ![72, 32, 96].includes(uniform)
        ? "custom"
        : String(uniform);
    $("orientation").onchange = (event) => {
      if (
        (event.target.value === "landscape") !==
        editor.Document.PageWidth > editor.Document.PageHeight
      )
        run("landscape");
    };
    $("margins-select").onchange = (e) =>
      e.target.value !== "custom" &&
      setDocumentProp("PagePadding", +e.target.value);
    $("panel-export").onclick = () => openPanel("export");
  }
  if (panel === "source") {
    $("source-format").value = sourceFormat;
    $("source-format").onchange = (e) => {
      sourceFormat = e.target.value;
      refreshSource();
    };
    $("apply-source").onclick = () =>
      edit(() => {
        const s = $("source-code").value;
        const document =
          sourceFormat === "json"
            ? RT.FlowDocument.FromJSON(JSON.parse(s))
            : {
                markdown: RT.fromMarkdown,
                html: RT.fromHTML,
                xaml: RT.fromXAML,
                rtf: RT.fromRTF,
              }[sourceFormat](s);
        editor.Engine.ReplaceDocument(document);
        toast("Source applied");
      });
    $("refresh-source").onclick = refreshSource;
    refreshSource();
  }
  if (panel === "export") {
    $("inspector-content")
      .querySelectorAll("[data-export]")
      .forEach(
        (b) => (b.onclick = () => safe(() => download(b.dataset.export))),
      );
    $("browser-print").onclick = printDocument;
  }
  if (panel === "comments") attachReviewHandlers();
  updateReadOnlyControls();
}
function refreshSource() {
  safe(() => {
    $("source-code").value =
      sourceFormat === "json"
        ? JSON.stringify(editor.Document.ToJSON(), null, 2)
        : {
            markdown: RT.toMarkdown,
            html: RT.toHTML,
            xaml: RT.toXAML,
            rtf: RT.toRTF,
          }[sourceFormat](editor.Document);
  });
}
function addComment() {
  if (!canEdit()) return;
  const engine = editor.Engine,
    document = editor.Document,
    start = editor.Selection.Start.Offset,
    end = editor.Selection.End.Offset,
    quote = editor.Selection.Text;
  showDialog(
    "Add comment",
    `<p class="note">${quote ? `Selected: “${esc(quote.slice(0, 150))}”` : "Document comment"}</p><label class="dialog-field">Comment<textarea id="comment-text" required placeholder="Add your thoughts…"></textarea></label>`,
    () =>
      edit(() => {
        const text = $("comment-text").value.trim();
        if (!text) return;
        if (editor.Document !== document)
          throw Error(
            "The document changed while the comment dialog was open.",
          );
        engine.Select(start, end);
        engine.AddComment(text, "You");
        openPanel("comments");
      }),
  );
}
function addBookmark() {
  if (!canEdit()) return;
  const engine = editor.Engine,
    document = editor.Document,
    start = editor.Selection.Start.Offset,
    end = editor.Selection.End.Offset;
  showDialog(
    "Add bookmark",
    field(
      "Bookmark name",
      "bookmark-name",
      "",
      "text",
      'required maxlength="120"',
    ),
    () =>
      edit(() => {
        if (editor.Document !== document)
          throw Error(
            "The document changed while the bookmark dialog was open.",
          );
        engine.Select(start, end);
        engine.AddBookmark($("bookmark-name").value.trim());
        openPanel("comments");
      }),
  );
}
async function download(format) {
  const fn = {
    docx: RT.toDOCX,
    pdf: RT.toPDF,
    markdown: RT.toMarkdown,
    html: RT.toHTML,
    rtf: RT.toRTF,
    xaml: RT.toXAML,
    text: RT.toText,
  };
  let data =
    format === "json"
      ? JSON.stringify(editor.Document.ToJSON(), null, 2)
      : await fn[format](editor.Document);
  const ext = { markdown: "md", text: "txt" }[format] || format;
  const mime =
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      html: "text/html",
      json: "application/json",
      rtf: "application/rtf",
    }[format] || "text/plain";
  const blob = new Blob([data], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    ($("document-title").value || "document").replace(
      /[^\p{L}\p{N} _-]/gu,
      "",
    ) +
    "." +
    ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`Exported ${ext.toUpperCase()} document`);
}
function printDocument() {
  safe(() => editor.Print());
}
function find() {
  const q = $("find-input").value;
  $("find-tools").hidden = !q;
  currentMatches = q ? editor.Engine.Find(q, { matchCase: false }) : [];
  matchIndex = 0;
  $("find-count").textContent = `${currentMatches.length} matches`;
}
function nextMatch() {
  if (!currentMatches.length) return;
  const m = currentMatches[matchIndex++ % currentMatches.length];
  const start = m.Start?.Offset ?? m.start ?? m.Start ?? m.offset ?? 0;
  const end =
    m.End?.Offset ?? m.end ?? m.End ?? start + $("find-input").value.length;
  action(() => editor.Engine.Select(start, end));
  $("find-count").textContent =
    `${((matchIndex - 1) % currentMatches.length) + 1} of ${currentMatches.length}`;
}
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "richtextweb-theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
  wordWorkspace?.SetTheme(
    document.body.classList.contains("dark") ? "dark" : "light",
  );
}
function showCode(kind) {
  const codes = {
    "api-example": `import { FlowDocument, Paragraph, Run, Bold }\n  from '@wieslawsoltes/richtextweb';\n\nconst flowDocument = new FlowDocument();\nconst paragraph = new Paragraph();\nparagraph.Inlines.Add(new Run('Hello '));\nparagraph.Inlines.Add(new Bold(new Run('world')));\nflowDocument.Blocks.Add(paragraph);\n\nconst editor = document.querySelector('rich-text-box');\neditor.Document = flowDocument;`,
    "mvvm-example": `import { ObservableObject, Binding, BindingMode,\n  RelayCommand } from '@wieslawsoltes/richtextweb/mvvm';\n\nconst editor = document.querySelector('rich-text-box');\nconst vm = new ObservableObject({ Document: editor.Document });\nconst binding = new Binding({\n  Source: vm, Path: 'Document', Mode: BindingMode.TwoWay\n}).Attach(editor, 'Document');\n\nconst bold = new RelayCommand(() => editor.Execute('ToggleBold'));\nbold.Execute();\n// When the view closes: binding.Dispose(); bold.Dispose();`,
    "react-example": `import { RichTextEditor }\n  from '@wieslawsoltes/richtextweb/react';\n\n<RichTextEditor\n  document={flowDocument}\n  onDocumentChange={setFlowDocument}\n  readOnly={false}\n/>`,
    "bridge-example": `import { connectWebView2 }\n  from '@wieslawsoltes/richtextweb/bridge';\n\n// Run inside the trusted WPF or WinUI WebView2 host page.\nconst editor = document.querySelector('rich-text-box');\nconst bridge = connectWebView2(editor.Engine, window.chrome.webview, {\n  isReadOnly: () => editor.IsReadOnly,\n  includeDocumentInEvents: true\n});\n\n// C# host uses RichTextDocumentClient from adapters/dotnet:\n// await client.InsertTextAsync("Hello from .NET");\n// await client.ExecuteAsync("ToggleBold");\n// On close: bridge.Dispose();`,
  };
  showDialog(
    "Integration example",
    `<textarea class="code-area" readonly aria-label="Integration code">${esc(codes[kind])}</textarea><p class="note"><a href="https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/INTEGRATION.md" target="_blank" rel="noreferrer">Read integration documentation ↗</a></p>`,
    () => {},
  );
  $("dialog-submit").textContent = "Done";
}
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((t) => {
        t.classList.toggle("active", t === b);
        t.setAttribute("aria-selected", String(t === b));
      });
      renderRibbon();
    }),
);
document.querySelectorAll("[data-side]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-side]")
        .forEach((t) => t.classList.toggle("active", t === b));
      $("outline").hidden = b.dataset.side !== "outline";
      $("examples").hidden = b.dataset.side !== "examples";
    }),
);
document
  .querySelectorAll("[data-panel]")
  .forEach((b) => (b.onclick = () => openPanel(b.dataset.panel)));
$("examples").innerHTML = Object.entries(templates)
  .map(
    ([key, t]) =>
      `<button class="example-card" data-example="${key}"><strong>${esc(t.name)}</strong><span>${esc(t.description)}</span></button>`,
  )
  .join("");
$("examples")
  .querySelectorAll("button")
  .forEach((b) => (b.onclick = () => loadTemplate(b.dataset.example)));
$("theme-toggle").onclick = toggleTheme;
$("focus-mode").onclick = () => run("focus");
$("toggle-navigation").onclick = () => run("navigation");
$("show-navigation").onclick = () => run("navigation");
$("toggle-inspector").onclick = () => wordWorkspace?.TogglePane("properties");
$("export-primary").onclick = () => openPanel("export");
$("document-view").onchange = (event) => setView(event.target.value);
$("page-arrangement").onchange = (event) => {
  editor.PageArrangement = event.target.value;
  if (event.target.value === "TwoPages") editor.ZoomMode = "TwoPages";
  syncViewUI();
};
$("fit-page").onclick = () => {
  editor.ZoomMode = "WholePage";
  syncViewUI();
};
editor.addEventListener("viewchange", syncViewUI);
editor.addEventListener("paginated", syncViewUI);
$("zoom").oninput = (e) => zoom(+e.target.value);
$("zoom-out").onclick = () => zoom(state.zoom - 10);
$("zoom-in").onclick = () => zoom(state.zoom + 10);
$("view-toggle").onclick = () =>
  setView(editor.ViewMode === "page" ? "continuous" : "page");
$("document-title").onchange = persist;
$("find-input").oninput = find;
$("find-input").onkeydown = (e) => {
  if (e.key === "Enter") nextMatch();
};
$("find-next").onclick = nextMatch;
$("replace-all").onclick = () =>
  edit(() => {
    const count = editor.Engine.ReplaceAll(
      $("find-input").value,
      $("replace-input").value,
      { matchCase: false },
    );
    find();
    toast(`Replaced ${count} matches`);
  });
$("file-input").onchange = () =>
  safe(async () => {
    if (!canEdit()) {
      $("file-input").value = "";
      return;
    }
    const file = $("file-input").files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024)
      throw Error("Choose a document smaller than 25 MB.");
    const ext = file.name.split(".").pop().toLowerCase();
    let doc;
    if (ext === "docx")
      doc = await RT.fromDOCX(new Uint8Array(await file.arrayBuffer()));
    else {
      const text = await file.text();
      const fn = {
        html: RT.fromHTML,
        htm: RT.fromHTML,
        md: RT.fromMarkdown,
        markdown: RT.fromMarkdown,
        xaml: RT.fromXAML,
        rtf: RT.fromRTF,
        txt: RT.fromText,
      };
      doc =
        ext === "json"
          ? RT.FlowDocument.FromJSON(JSON.parse(text))
          : fn[ext]?.(text);
      if (!doc) throw Error("Unsupported document format");
    }
    if (!canEdit()) {
      $("file-input").value = "";
      return;
    }
    editor.Document = doc;
    $("document-title").value = file.name.replace(/\.[^.]+$/, "");
    changed();
    toast("Document imported");
    $("file-input").value = "";
  });
editor.addEventListener("documentchange", changed);
editor.addEventListener("selectionchange", update);
editor.addEventListener("commandstatechange", update);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    persist();
    toast("Document saved");
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    run("find");
  }
  if (e.key === "Escape") document.body.classList.remove("focus");
});
try {
  const stored = JSON.parse(localStorage.getItem("richtextweb-document"));
  if (stored?.document) {
    editor.Document = RT.FlowDocument.FromJSON(stored.document);
    $("document-title").value = stored.title || state.title;
    if (Array.isArray(stored.comments) && !editor.Engine.Annotations.length) {
      editor.Engine.Change(() => {
        for (const comment of stored.comments)
          editor.Engine.AddAnnotation(
            "Comment",
            {
              Text: comment.text || "",
              Author: "You",
              Resolved: !!comment.resolved,
              LegacyQuote: comment.quote || "",
            },
            0,
            0,
          );
      });
      editor.Engine.ClearUndo();
    }
  } else editor.Document = RT.fromHTML(templates.welcome.html);
  if (localStorage.getItem("richtextweb-theme") === "dark")
    document.body.classList.add("dark");
} catch {
  editor.Document = RT.fromHTML(templates.welcome.html);
}
wordWorkspace = createWordWorkspace({
  editor,
  RT,
  run,
  toast,
  openPanel,
  download,
  persist,
  openPagePreview,
  setView,
  zoom,
});
setView("page");
zoom(
  innerWidth < 900
    ? Math.max(25, Math.floor(((innerWidth - 26) / 794) * 100))
    : 100,
);
renderRibbon();
renderPanel();
update();
window.richTextStudio = {
  editor,
  RT,
  loadTemplate,
  download,
  run,
  workspace: wordWorkspace,
};

async function openPagePreview() {
  const dialog = document.createElement("dialog");
  dialog.className = "page-preview-dialog";
  const header = document.createElement("div");
  header.className = "dialog-title";
  const heading = document.createElement("h2");
  heading.textContent = "Paginated document preview";
  const close = document.createElement("button");
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const viewer = document.createElement("flow-document-page-viewer");
  viewer.Document = editor.Document;
  dialog.append(header, viewer);
  document.body.append(dialog);
  dialog.showModal();
  dialog.onclose = () => {
    viewer.Dispose();
    dialog.remove();
  };
  await viewer.Repaginate();
}
