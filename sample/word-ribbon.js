/** RibbonWeb host configuration. Document commands belong to RichTextWeb controls. */
export function createDocumentRibbon({
  button,
  control,
  command,
  openCatalog,
  showGraph,
  dock,
  editor,
  RT,
}) {
  const b = (id, label, icon, execute, options = {}) =>
    button(id, label, icon, execute, options);
  const t = (id, label, icon, options = {}) =>
    b(id, label, icon, () => control(id), options);
  const app = (id, label, icon, options = {}) =>
    b(id, label, icon, () => command(id), options);
  const large = { size: "large" };
  const group = (id, header, items, options = {}) => ({
    id,
    header,
    items,
    ...options,
  });
  const tab = (id, header, groups, keyTip = header[0]) => ({
    id,
    header,
    groups,
    keyTip,
  });
  const select = (id, label, value, items, execute, extra = {}) =>
    b(id, label, "", execute, {
      type: "dropdown",
      value,
      items: items.map((x) =>
        typeof x === "string" ? { label: x, value: x } : x,
      ),
      ...extra,
    });
  const style = (value) => {
    if (editor.IsReadOnly) return;
    editor.Engine.Change(() => {
      const styles = {
        normal: {
          HeadingLevel: 0,
          FontSize: 16,
          FontFamily: "Calibri",
          FontWeight: "Normal",
        },
        title: {
          HeadingLevel: 1,
          FontSize: 40,
          FontFamily: "Calibri",
          FontWeight: "Normal",
        },
        subtitle: {
          HeadingLevel: 0,
          FontSize: 22,
          FontWeight: "Normal",
          Foreground: "#657185",
        },
        heading1: {
          HeadingLevel: 1,
          FontSize: 28,
          FontWeight: "Bold",
          Foreground: "#1f4d78",
        },
        heading2: {
          HeadingLevel: 2,
          FontSize: 22,
          FontWeight: "Bold",
          Foreground: "#1f4d78",
        },
        quote: {
          HeadingLevel: 0,
          FontSize: 18,
          FontStyle: "Italic",
          Foreground: "#526780",
          Margin: "20,12,20,12",
        },
      };
      const props = styles[value];
      if (!props) return;
      for (const [name, setting] of Object.entries({
        FontFamily: "Calibri",
        FontStyle: "Normal",
        Foreground: "#242a33",
        Margin: "0,0,0,12",
        ...props,
      }))
        editor.Engine.SetParagraphProperty(name, setting);
    });
    editor.Focus();
  };
  const gallery = b("styles", "Styles", "", style, {
    type: "gallery",
    value: "normal",
    inlineCount: 3,
    columns: 3,
    items: [
      {
        id: "normal",
        value: "normal",
        label: "Normal",
        preview: "AaBbCc",
        style: { fontSize: "18px" },
      },
      {
        id: "heading1",
        value: "heading1",
        label: "Heading 1",
        preview: "AaBbCc",
        style: { fontSize: "23px", color: "#1f4d78" },
      },
      {
        id: "heading2",
        value: "heading2",
        label: "Heading 2",
        preview: "AaBbCc",
        style: { fontSize: "20px", color: "#1f4d78" },
      },
      {
        id: "title",
        value: "title",
        label: "Title",
        preview: "Title",
        style: { fontSize: "26px" },
      },
      {
        id: "subtitle",
        value: "subtitle",
        label: "Subtitle",
        preview: "Subtitle",
        style: { color: "#657185" },
      },
      {
        id: "quote",
        value: "quote",
        label: "Quote",
        preview: "Quotation",
        style: { fontStyle: "italic" },
      },
    ],
  });
  const model = {
    id: "richtextweb-word-workspace",
    title: "Document Studio · Saved on this device",
    selectedTab: "home",
    layout: "classic",
    theme: "light",
    quickAccessToolbar: [
      app("quick-save", "Save", "save"),
      t("Undo", "Undo", "undo"),
      t("Redo", "Redo", "redo"),
    ],
    backstage: [
      app("new", "New document", "page"),
      app("open", "Open document", "download"),
      app("save", "Save on this device", "save"),
      app("export-docx", "Export Word (.docx)", "page"),
      app("export-pdf", "Export PDF", "download"),
      app("export-markdown", "Export Markdown", "download"),
      app("export-html", "Export HTML", "download"),
      app("export-rtf", "Export rich text", "download"),
      app("export-json", "Export flow document", "download"),
      app("print", "Print", "print"),
      app("pdf-tools", "Open PDF workspace", "page"),
    ],
    tabs: [
      tab(
        "home",
        "Home",
        [
          group(
            "clipboard",
            "Clipboard",
            [
              t("Paste", "Paste", "clipboard", large),
              t("Cut", "Cut", "cut"),
              t("Copy", "Copy", "copy"),
              t("ClearFormatting", "Clear formatting", "brush"),
            ],
            { priority: 6 },
          ),
          group(
            "font",
            "Font",
            [
              select(
                "font-family",
                "Font",
                "Calibri",
                [
                  "Calibri",
                  "Aptos",
                  "Arial",
                  "Cambria",
                  "Georgia",
                  "Times New Roman",
                  "Consolas",
                  "Segoe UI",
                ],
                (value) => control("FontFamily", value),
                { type: "combobox" },
              ),
              select(
                "font-size",
                "Size",
                "16",
                [
                  "10",
                  "12",
                  "14",
                  "16",
                  "18",
                  "20",
                  "24",
                  "28",
                  "32",
                  "40",
                  "48",
                  "64",
                ],
                (value) => control("FontSize", Number(value)),
              ),
              t("ToggleBold", "Bold", "bold", {
                type: "toggle",
                showLabel: false,
                keyTip: "1",
              }),
              t("ToggleItalic", "Italic", "italic", {
                type: "toggle",
                showLabel: false,
                keyTip: "2",
              }),
              t("ToggleUnderline", "Underline", "underline", {
                type: "toggle",
                showLabel: false,
                keyTip: "3",
              }),
              t("ToggleStrikethrough", "Strikethrough", "S̶", {
                showLabel: false,
              }),
              t("ToggleSubscript", "Subscript", "x₂", { showLabel: false }),
              t("ToggleSuperscript", "Superscript", "x²", { showLabel: false }),
              b(
                "font-color",
                "Font color",
                "color",
                (value) => control("Foreground", value),
                { type: "color", value: "#242a33" },
              ),
              b(
                "highlight-color",
                "Highlight",
                "paint",
                (value) => control("Background", value),
                { type: "color", value: "#fff2a8" },
              ),
            ],
            { priority: 10 },
          ),
          group(
            "paragraph",
            "Paragraph",
            [
              t("ToggleBullets", "Bullets", "list", { showLabel: false }),
              t("ToggleNumbering", "Numbering", "1.", { showLabel: false }),
              t("DecreaseIndentation", "Decrease indent", "⇤", {
                showLabel: false,
              }),
              t("IncreaseIndentation", "Increase indent", "indent", {
                showLabel: false,
              }),
              t("AlignLeft", "Align left", "left", { showLabel: false }),
              t("AlignCenter", "Center", "center", { showLabel: false }),
              t("AlignRight", "Align right", "right", { showLabel: false }),
              t("AlignJustify", "Justify", "justify", { showLabel: false }),
              t("Paragraph", "Paragraph settings", "↕"),
            ],
            { priority: 8 },
          ),
          group("style-gallery", "Styles", [gallery], {
            priority: 5,
            launcher: () => openCatalog("styles"),
          }),
          group("editing", "Editing", [
            app("find", "Find", "search"),
            t("FindReplace", "Replace", "⇄"),
            app("select-all", "Select all", "grid"),
          ]),
        ],
        "H",
      ),
      tab(
        "insert",
        "Insert",
        [
          group("insert-pages", "Pages", [
            t("PageBreak", "Page break", "page", large),
            t("ColumnBreak", "Column break", "list"),
          ]),
          group("insert-tables", "Tables", [
            t("Table", "Table", "table", large),
          ]),
          group("illustrations", "Illustrations", [
            t("Image", "Pictures", "image", large),
            t("TextBox", "Text box", "shape", large),
            t("FloatingLayout", "Wrap text", "slides", large),
            t("EditTextBox", "Edit text box", "page"),
          ]),
          group("links", "Links", [
            t("Link", "Link", "link"),
            t("Bookmark", "Bookmark", "⚑"),
            t("Comment", "Comment", "comment"),
          ]),
          group("header-footer", "Header & footer", [
            t("Header", "Header", "page", large),
            t("Footer", "Footer", "page", large),
            t("FirstPageHeader", "First-page header", "page"),
            t("FirstPageFooter", "First-page footer", "page"),
            t("EvenPageHeader", "Even-page header", "page"),
            t("EvenPageFooter", "Even-page footer", "page"),
            t("PageNumberFooter", "Page number", "#", large),
          ]),
          group("insert-text", "Text", [
            t("Field", "Quick parts / field", "formula"),
            app("date", "Date & time", "clock"),
            t("Symbol", "Symbol", "Ω"),
            t("Equation", "Equation", "formula", large),
          ]),
        ],
        "N",
      ),
      tab(
        "layout",
        "Layout",
        [
          group("page-setup", "Page setup", [
            t("PageSetup", "Page setup", "settings", large),
            app("a4", "A4", "page"),
            app("letter", "Letter", "page"),
            app("landscape", "Orientation", "slides"),
            app("margins", "Margins", "grid"),
          ]),
          group("layout-paragraph", "Paragraph", [
            t("Paragraph", "Paragraph", "↕"),
            app("indent", "Indent", "indent"),
            app("outdent", "Outdent", "⇤"),
            t("KeepTogether", "Keep together", "link"),
            t("KeepWithNext", "Keep with next", "link"),
          ]),
          group("arrange", "Arrange", [
            t("FloatingLayout", "Position & wrapping", "shape", large),
            b(
              "selection-pane",
              "Selection pane",
              "grid",
              () => openCatalog("objects"),
              large,
            ),
          ]),
        ],
        "P",
      ),
      tab(
        "references",
        "References",
        [
          group("contents", "Table of contents", [
            t("TableOfContents", "Table of contents", "list", large),
            t("UpdateTableOfContents", "Update table", "redo"),
          ]),
          group("notes", "Notes", [
            t("Footnote", "Insert footnote", "¹", large),
            t("Endnote", "Insert endnote", "i", large),
          ]),
          group("captions", "Captions", [
            t("Caption", "Insert caption", "page", large),
            t("CrossReference", "Cross-reference", "link"),
            t("TableOfFigures", "Table of figures", "list"),
          ]),
          group("fields", "Fields & references", [
            t("FieldCode", "Field code", "code"),
            t("LockField", "Lock field", "lock"),
            t("UnlockField", "Unlock field", "lock"),
            t("UnlinkField", "Unlink field", "link"),
            t("Field", "Insert field", "formula", large),
            t("UpdateFields", "Update fields", "redo"),
            b("field-catalog", "Field list", "table", () =>
              openCatalog("fields"),
            ),
            b("reference-graph", "Reference graph", "shape", showGraph),
          ]),
        ],
        "S",
      ),
      tab(
        "mailings",
        "Mailings",
        [
          group("mail-merge", "Mail merge", [
            t("MailMerge", "Start mail merge", "page", large),
            t("Field", "Insert merge field", "formula", large),
            t("UpdateFields", "Update fields", "redo"),
            b("merge-field-list", "Field list", "table", () =>
              openCatalog("fields"),
            ),
          ]),
        ],
        "M",
      ),
      tab(
        "review",
        "Review",
        [
          group("proofing", "Proofing", [
            app("spellcheck", "Spelling", "check", large),
            t("WordCount", "Word count", "chart", { ...large, mutates: false }),
          ]),
          group("review-comments", "Comments", [
            t("Comment", "New comment", "comment", large),
            app("comments", "Show comments", "comment"),
          ]),
          group("tracking", "Tracking", [
            t("TrackChanges", "Track changes", "brush", {
              ...large,
              type: "toggle",
            }),
            b("revisions-pane", "Reviewing pane", "list", () =>
              openCatalog("revisions"),
            ),
            t("ReviewChanges", "Manage changes", "settings"),
            t("MoveSelection", "Move selection", "⇄"),
          ]),
          group("changes", "Changes", [
            t("AcceptAllRevisions", "Accept all", "check", large),
            t("RejectAllRevisions", "Reject all", "close", large),
          ]),
          group("collaborate", "Collaborate", [
            app("collaboration-demo", "Coauthor demo", "⇄", {
              ...large,
              mutates: false,
            }),
            app("read-only", "Read only", "◉", {
              type: "toggle",
              mutates: false,
            }),
          ]),
        ],
        "R",
      ),
      tab(
        "view",
        "View",
        [
          group("views", "Views", [
            app("page", "Print layout", "page", { ...large, mutates: false }),
            app("continuous", "Web layout", "list", {
              ...large,
              mutates: false,
            }),
            app("read-mode", "Read mode", "page", { ...large, mutates: false }),
            app("outline-view", "Outline", "list", { mutates: false }),
            app("draft-view", "Draft", "page", { mutates: false }),
            t("PagePreview", "Page preview", "print", {
              ...large,
              mutates: false,
            }),
            app("focus", "Focus", "full", { ...large, mutates: false }),
          ]),
          group("show", "Show", [
            app("navigation", "Navigation pane", "list", { mutates: false }),
            app("properties", "Properties", "settings", { mutates: false }),
            b(
              "catalog-pane",
              "Document explorer",
              "grid",
              () => openCatalog("all"),
              { mutates: false },
            ),
            b("graph-pane", "Reference graph", "shape", showGraph, {
              mutates: false,
            }),
          ]),
          group("window", "Window", [
            b(
              "float-document",
              "Float document",
              "slides",
              () => dock("float"),
              { mutates: false },
            ),
            b("dock-document", "Dock document", "grid", () => dock("dock"), {
              mutates: false,
            }),
            b("save-layout", "Save workspace", "save", () => dock("save"), {
              mutates: false,
            }),
            b(
              "restore-layout",
              "Restore workspace",
              "undo",
              () => dock("restore"),
              { mutates: false },
            ),
          ]),
          group("page-movement", "Page movement", [
            app("single-page", "One page", "page", { mutates: false }),
            app("two-pages", "Two pages", "slides", { mutates: false }),
            app("vertical-pages", "Vertical", "list", { mutates: false }),
            app("multiple-pages", "Multiple pages", "grid", { mutates: false }),
          ]),
          group("display", "Zoom", [
            app("fit-width", "Page width", "full", { mutates: false }),
            app("fit-page", "Whole page", "page", { mutates: false }),
            app("zoom-reset", "100%", "search", { mutates: false }),
            app("theme", "Dark / light", "◐", { mutates: false }),
            b(
              "virtualization",
              "Virtualize document",
              "list",
              () => {
                editor.EnableVirtualization = !editor.EnableVirtualization;
              },
              { type: "toggle", checked: true, mutates: false },
            ),
          ]),
        ],
        "W",
      ),
      tab("table", "Table layout", [
        group("table-data", "Data", [
          t("Formula", "Formula", "formula", large),
          t("SortTable", "Sort", "list"),
          t("RepeatHeaderRows", "Repeat header rows", "table"),
        ]),
        group("table-rows", "Rows & columns", [
          t("InsertTableRow", "Insert row below", "plus"),
          app("table-row-before", "Insert row above", "plus"),
          t("InsertTableColumn", "Insert column right", "plus"),
          app("table-column-before", "Insert column left", "plus"),
          t("DeleteTableRow", "Delete row", "delete"),
          t("DeleteTableColumn", "Delete column", "delete"),
        ]),
        group("merge", "Merge", [
          t("MergeTableCells", "Merge cells", "table", large),
          t("SplitTableCell", "Split cell", "grid", large),
        ]),
        group("table-properties", "Cell", [
          b(
            "cell-shading",
            "Cell shading",
            "paint",
            (value) =>
              editor.Execute("SetCellProperty", {
                Name: "Background",
                Value: value,
              }),
            { type: "color", value: "#e6eef8" },
          ),
          app("table-delete", "Delete table", "delete"),
        ]),
      ]),
      tab(
        "developer",
        "Developer",
        [
          group("source", "Document source", [
            app("source-json", "JSON", "{}", { ...large, mutates: false }),
            app("source-xaml", "XAML", "<>", { ...large, mutates: false }),
            app("source-html", "HTML", "⌘", { ...large, mutates: false }),
            app("source-markdown", "Markdown", "M↓", {
              ...large,
              mutates: false,
            }),
          ]),
          group("apis", "API & integration", [
            app("api-example", "API example", "formula", { mutates: false }),
            app("mvvm-example", "MVVM", "⇄", { mutates: false }),
            app("react-example", "React", "⚛", { mutates: false }),
            app("bridge-example", "WebView bridge", "slides", {
              mutates: false,
            }),
          ]),
          group("performance", "Performance", [
            app("large-document", "Large document", "chart", large),
            b(
              "spatial-lookup",
              "Nearest object",
              "shape",
              () => dock("nearest"),
              { mutates: false },
            ),
            b(
              "engine-metrics",
              "Engine metrics",
              "settings",
              () => openCatalog("all"),
              { mutates: false },
            ),
          ]),
        ],
        "D",
      ),
      tab("advanced", "Advanced tools", [
        group("reusable-controls", "Reusable RichTextWeb controls", [
          b(
            "all-tools",
            "All document tools",
            "settings",
            () => dock("tools"),
            large,
          ),
          t("FloatingLayout", "Floating layout", "shape", large),
          t("MoveSelection", "Move text", "⇄", large),
          app("pdf-tools", "PDF workspace", "page", {
            ...large,
            mutates: false,
          }),
        ]),
      ]),
    ],
  };
  // RibbonWeb IDs identify a command instance, so repeated commands receive aliases.
  const ids = new Set();
  const unique = (items) =>
    items.forEach((item) => {
      if (ids.has(item.id)) item.id = `${item.id}-${ids.size}`;
      ids.add(item.id);
      if (
        item.items &&
        !["gallery", "dropdown", "combobox"].includes(item.type)
      )
        unique(item.items);
    });
  unique(model.quickAccessToolbar);
  unique(model.backstage);
  model.tabs.forEach((item) =>
    item.groups.forEach((group) => unique(group.items)),
  );
  return { model, ApplyStyle: style };
}
