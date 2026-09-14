import { pageSettings } from "./pagination.js";
import { DocumentStorySession } from "./story-session.js";
import { pageStoryKey, pageStoryVariantEnabled } from "./page-setup.js";
import { EquationEditor } from "./equation-control.js";
import { equationOptions } from "./equations.js";
import { RichTextBox } from "./control.js";
import {
  DocumentFeatures,
  createField,
  type FieldType,
  type StoryKind,
} from "./document-features.js";
import {
  FlowDocument,
  Paragraph,
  Run,
  Figure,
  type DocumentNode,
} from "./model.js";

const HTMLElementBase = (globalThis.HTMLElement ??
  class {}) as typeof HTMLElement;
export type ToolbarMode = "home" | "insert" | "layout" | "review" | "all";
interface Tool {
  label: string;
  command: string;
  title?: string;
}
const home: Tool[] = [
  { label: "Paste", command: "Paste" },
  { label: "Cut", command: "Cut" },
  { label: "Copy", command: "Copy" },
  { label: "↶", command: "Undo", title: "Undo" },
  { label: "↷", command: "Redo", title: "Redo" },
  { label: "B", command: "ToggleBold", title: "Bold" },
  { label: "I", command: "ToggleItalic", title: "Italic" },
  { label: "U", command: "ToggleUnderline", title: "Underline" },
  { label: "S̶", command: "ToggleStrikethrough", title: "Strikethrough" },
  { label: "x²", command: "ToggleSuperscript", title: "Superscript" },
  { label: "x₂", command: "ToggleSubscript", title: "Subscript" },
  { label: "Left", command: "AlignLeft" },
  { label: "Center", command: "AlignCenter" },
  { label: "Right", command: "AlignRight" },
  { label: "Justify", command: "AlignJustify" },
  { label: "• List", command: "ToggleBullets" },
  { label: "1. List", command: "ToggleNumbering" },
  { label: "Indent", command: "IncreaseIndentation" },
  { label: "Outdent", command: "DecreaseIndentation" },
  { label: "Paragraph", command: "Paragraph" },
  { label: "Clear", command: "ClearFormatting" },
];
const insert: Tool[] = [
  { label: "Equation", command: "Equation" },
  { label: "Symbol", command: "Symbol" },
  { label: "Table", command: "Table" },
  { label: "Image", command: "Image" },
  { label: "Text box", command: "TextBox" },
  { label: "Edit text box", command: "EditTextBox" },
  { label: "Link", command: "Link" },
  { label: "Unlink", command: "RemoveHyperlink" },
  { label: "Row +", command: "InsertTableRow" },
  { label: "Column +", command: "InsertTableColumn" },
  { label: "Row −", command: "DeleteTableRow" },
  { label: "Column −", command: "DeleteTableColumn" },
  { label: "Merge cells", command: "MergeTableCells" },
  { label: "Split cell", command: "SplitTableCell" },
  { label: "Field", command: "Field" },
  { label: "Contents", command: "TableOfContents" },
  { label: "Footnote", command: "Footnote" },
  { label: "Endnote", command: "Endnote" },
];
const layout: Tool[] = [
  { label: "Wrap / position", command: "FloatingLayout" },
  { label: "Page setup", command: "PageSetup" },
  { label: "Header", command: "Header" },
  { label: "Footer", command: "Footer" },
  { label: "Page number", command: "PageNumberFooter" },
  { label: "Page break", command: "PageBreak" },
  { label: "Column break", command: "ColumnBreak" },
  { label: "Keep together", command: "KeepTogether" },
  { label: "Keep with next", command: "KeepWithNext" },
  { label: "Update fields", command: "UpdateFields" },
  { label: "Update contents", command: "UpdateTableOfContents" },
  { label: "Mail merge", command: "MailMerge" },
  { label: "Page preview", command: "PagePreview" },
];
const review: Tool[] = [
  { label: "Move selection", command: "MoveSelection" },
  { label: "Track changes", command: "TrackChanges" },
  { label: "Review changes", command: "ReviewChanges" },
  { label: "Accept all", command: "AcceptAllRevisions" },
  { label: "Reject all", command: "RejectAllRevisions" },
  { label: "Comment", command: "Comment" },
  { label: "Bookmark", command: "Bookmark" },
  { label: "Find / replace", command: "FindReplace" },
];
const css = `:host{display:block;font:13px/1.4 var(--rt-ui-font,system-ui);color:var(--rt-toolbar-color,#22324b)}*{box-sizing:border-box}.tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:9px 12px;background:var(--rt-toolbar-background,#fff);border:1px solid var(--rt-toolbar-border,#dbe1eb);border-radius:8px}.group{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.group+.group{border-left:1px solid var(--rt-toolbar-border,#dbe1eb);padding-left:12px}button,input,select,textarea{font:inherit;color:inherit}button{min-height:32px;border:1px solid transparent;border-radius:5px;background:transparent;padding:5px 9px;cursor:pointer}button:hover{background:var(--rt-toolbar-hover,#edf3fc)}button[aria-pressed=true]{background:#dceaff;color:#084999;border-color:#accafa}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #367adb;outline-offset:2px}select,input,textarea{border:1px solid var(--rt-toolbar-border,#ccd5e1);border-radius:4px;background:var(--rt-toolbar-background,#fff);padding:5px;max-width:100%}select{max-width:150px}input[type=color]{width:34px;height:32px;padding:3px}dialog{max-height:90dvh;overflow:auto;background:var(--rt-toolbar-background,#fff);border:1px solid var(--rt-toolbar-border,#cad3e0);border-radius:12px;padding:22px;width:min(520px,95vw);color:var(--rt-toolbar-color,#22324b);box-shadow:0 24px 90px #10203c40}dialog::backdrop{background:#172d4e55}h2{margin:0 0 16px;font-size:19px}label{display:flex;flex-direction:column;gap:5px;margin:12px 0}textarea{min-height:100px;width:100%}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.primary{background:#1254a3;color:white}.revision{border-top:1px solid #dce3ed;padding:10px 0}.revision p{white-space:pre-wrap;overflow-wrap:anywhere}.status{font-size:12px;max-width:360px}.muted{color:#63738a}@media(max-width:600px){.tools{gap:6px;padding:6px}.group+.group{padding-left:0;border-left:0}button{padding:5px 6px}}`;

/** Reusable editor chrome. All mutations go through the attached RichTextBox engine. */
export class RichTextToolbar extends HTMLElementBase {
  static get observedAttributes() {
    return ["for", "mode"];
  }
  private editor: RichTextBox | null = null;
  private mode: ToolbarMode = "all";
  private subscriptions: (() => void)[] = [];
  private status = "";
  constructor() {
    super();
    if (this.attachShadow) this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    if (this.editor) this.Editor = this.editor;
    if (this.Target) this.connectTarget();
    this.render();
  }
  disconnectedCallback() {
    this.detach();
  }
  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ) {
    if (name === "mode") this.Mode = value as ToolbarMode;
    else this.connectTarget();
  }
  get Editor() {
    return this.editor;
  }
  set Editor(value: RichTextBox | null) {
    if (value !== this.editor)
      this.shadowRoot?.querySelector("dialog")?.close();
    this.detach();
    this.editor = value;
    if (value)
      for (const event of [
        "documentchange",
        "selectionchange",
        "commandstatechange",
      ]) {
        const handler = () => this.Refresh();
        value.addEventListener(event, handler);
        this.subscriptions.push(() =>
          value.removeEventListener(event, handler),
        );
      }
    if (value) {
      const storyHandler = (event: Event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.executeSafe("EditStory", (event as CustomEvent).detail.kind);
      };
      value.addEventListener("storyeditrequest", storyHandler);
      this.subscriptions.push(() =>
        value.removeEventListener("storyeditrequest", storyHandler),
      );
      const handler = (event: Event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        const object = value.GetSelectedObject();
        this.executeSafe(
          object?.type === "Figure" || object?.type === "Floater"
            ? "EditTextBox"
            : object?.type === "Equation"
              ? "Equation"
              : "FloatingLayout",
        );
      };
      const equationKey = (event: KeyboardEvent) => {
        if (
          !event.defaultPrevented &&
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.code === "Equal" || event.key === "=") &&
          !value.IsReadOnly
        ) {
          event.preventDefault();
          this.executeSafe("Equation");
        }
      };
      value.addEventListener("keydown", equationKey);
      this.subscriptions.push(() =>
        value.removeEventListener("keydown", equationKey),
      );
      value.addEventListener("objecteditrequest", handler);
      this.subscriptions.push(() =>
        value.removeEventListener("objecteditrequest", handler),
      );
    }
    this.Refresh();
  }
  get Target() {
    return this.getAttribute("for") ?? "";
  }
  set Target(value: string) {
    this.setAttribute("for", value);
  }
  get Mode() {
    return this.mode;
  }
  set Mode(value: ToolbarMode) {
    this.mode = ["home", "insert", "layout", "review", "all"].includes(value)
      ? value
      : "all";
    this.render();
  }
  private detach() {
    this.subscriptions.splice(0).forEach((dispose) => dispose());
  }
  private connectTarget() {
    const candidate = this.ownerDocument?.getElementById(this.Target);
    this.Editor = candidate instanceof RichTextBox ? candidate : null;
  }
  Dispose() {
    this.detach();
    this.editor = null;
    this.shadowRoot?.replaceChildren();
  }
  private render() {
    if (!this.shadowRoot || !this.ownerDocument) return;
    this.shadowRoot.innerHTML = `<style>${css}</style><div class="tools" part="toolbar" role="toolbar" aria-label="Rich text formatting"></div><dialog part="dialog"></dialog>`;
    const tools = this.shadowRoot.querySelector(".tools")!;
    const groups =
      this.mode === "all"
        ? [home, insert, layout, review]
        : [{ home, insert, layout, review }[this.mode]];
    for (const entries of groups) {
      const group = this.ownerDocument.createElement("div");
      group.className = "group";
      if (entries === home) {
        const font = this.select(
          "Font family",
          [
            "Segoe UI",
            "Arial",
            "Georgia",
            "Times New Roman",
            "Verdana",
            "Consolas",
          ],
          (value) => this.executeSafe("FontFamily", value),
        );
        font.id = "font-family";
        group.append(font);
        const size = this.select(
          "Font size",
          ["10", "12", "14", "16", "18", "20", "24", "32", "42", "56", "72"],
          (value) => this.executeSafe("FontSize", Number(value)),
        );
        size.id = "font-size";
        size.value = "16";
        group.append(size);
        const style = this.select(
          "Paragraph style",
          ["Normal", "Heading 1", "Heading 2", "Heading 3", "Heading 4"],
          (value) =>
            this.executeSafe(
              "Heading",
              value === "Normal" ? 0 : Number(value.slice(-1)),
            ),
        );
        group.append(style);
      }
      for (const entry of entries) {
        const button = this.ownerDocument.createElement("button");
        button.type = "button";
        button.textContent = entry.label;
        button.dataset.command = entry.command;
        button.title = entry.title ?? entry.label;
        button.setAttribute("aria-label", entry.title ?? entry.label);
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => this.executeSafe(entry.command));
        group.append(button);
      }
      if (entries === home)
        for (const [id, label, command, value] of [
          ["text-color", "Text color", "Foreground", "#1254a3"],
          ["highlight-color", "Highlight color", "Background", "#fff0a6"],
        ]) {
          const input = this.ownerDocument.createElement("input");
          input.type = "color";
          input.id = id;
          input.title = label;
          input.setAttribute("aria-label", label);
          input.value = value;
          input.addEventListener("input", () =>
            this.executeSafe(command, input.value),
          );
          group.append(input);
        }
      tools.append(group);
    }
    const status = this.ownerDocument.createElement("span");
    status.className = "status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    tools.append(status);
    this.Refresh();
  }
  private select(
    label: string,
    values: string[],
    change: (value: string) => void,
  ): HTMLSelectElement {
    const select = this.ownerDocument.createElement("select");
    select.setAttribute("aria-label", label);
    select.title = label;
    for (const value of values) {
      const option = this.ownerDocument.createElement("option");
      option.value = option.textContent = value;
      select.append(option);
    }
    select.onchange = () => change(select.value);
    return select;
  }
  Refresh() {
    if (!this.shadowRoot) return;
    const locked = !this.editor || this.editor.IsReadOnly,
      engine = this.editor?.Engine;
    this.shadowRoot
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >(".tools button,.tools input,.tools select")
      .forEach((control) => {
        control.disabled =
          locked &&
          !["PagePreview", "ReviewChanges", "Copy"].includes(
            control.dataset.command ?? "",
          );
        if (control.dataset.command === "Undo")
          control.disabled = locked || !engine?.CanUndo;
        if (control.dataset.command === "Redo")
          control.disabled = locked || !engine?.CanRedo;
      });
    if (engine) {
      for (const [command, property, value] of [
        ["ToggleBold", "FontWeight", "Bold"],
        ["ToggleItalic", "FontStyle", "Italic"],
        ["ToggleUnderline", "TextDecorations", "Underline"],
      ])
        this.shadowRoot
          .querySelector(`[data-command="${command}"]`)
          ?.setAttribute(
            "aria-pressed",
            String(engine.Selection.GetPropertyValue(property) === value),
          );
      this.shadowRoot
        .querySelector('[data-command="TrackChanges"]')
        ?.setAttribute("aria-pressed", String(engine.TrackChanges));
    }
    const status = this.shadowRoot.querySelector(".status");
    if (status) status.textContent = this.status;
  }
  private executeSafe(command: string, parameter?: unknown) {
    const report = (error: unknown) => {
      this.status = error instanceof Error ? error.message : String(error);
      this.Refresh();
      this.dispatchEvent(
        new CustomEvent("commanderror", {
          detail: { command, error },
          bubbles: true,
          composed: true,
        }),
      );
    };
    try {
      const result = this.Execute(command, parameter);
      if (result && typeof (result as Promise<unknown>).then === "function")
        void Promise.resolve(result).catch(report);
    } catch (error) {
      report(error);
    }
  }
  /** Commands can also be driven by framework bindings and application menus. */
  Execute(command: string, parameter?: unknown): unknown {
    const editor = this.editor;
    if (!editor) return false;
    if (
      editor.IsReadOnly &&
      !["PagePreview", "ReviewChanges", "Copy"].includes(command)
    )
      return false;
    const engine = editor.Engine,
      features = new DocumentFeatures(engine);
    const mutate = (action: () => unknown) => {
      if (editor.IsReadOnly) return false;
      const result = action();
      editor.Focus();
      this.Refresh();
      return result;
    };
    switch (command) {
      case "Copy":
      case "Cut":
      case "Paste":
        return editor.Execute(command);
      case "Paragraph": {
        const paragraph = editor.Selection.Start.Paragraph;
        const margin = paragraph?.Margin;
        const m =
          typeof margin === "number"
            ? { Left: margin, Right: margin, Top: margin, Bottom: margin }
            : margin && typeof margin === "object"
              ? margin
              : { Left: 0, Right: 0, Top: 0, Bottom: 0 };
        this.prompt(
          "Paragraph settings",
          [
            {
              name: "align",
              label: "Alignment",
              value: String(paragraph?.TextAlignment || "Left"),
              options: ["Left", "Center", "Right", "Justify"],
            },
            {
              name: "left",
              label: "Left indent (px)",
              value: String(m.Left ?? 0),
              type: "number",
            },
            {
              name: "right",
              label: "Right indent (px)",
              value: String(m.Right ?? 0),
              type: "number",
            },
            {
              name: "first",
              label: "First line indent (px; negative for hanging)",
              value: String(paragraph?.GetValue("TextIndent") ?? 0),
              type: "number",
            },
            {
              name: "before",
              label: "Space before (px)",
              value: String(m.Top ?? 0),
              type: "number",
            },
            {
              name: "after",
              label: "Space after (px)",
              value: String(m.Bottom ?? 0),
              type: "number",
            },
            {
              name: "line",
              label: "Line height (px)",
              value: String(
                Number(paragraph?.LineHeight) > 4
                  ? paragraph?.LineHeight
                  : (paragraph?.FontSize || 16) * 1.5,
              ),
              type: "number",
            },
            {
              name: "keep",
              label: "Keep paragraph together",
              value: paragraph?.KeepTogether ? "Yes" : "No",
              options: ["No", "Yes"],
            },
            {
              name: "next",
              label: "Keep with next paragraph",
              value: paragraph?.KeepWithNext ? "Yes" : "No",
              options: ["No", "Yes"],
            },
          ],
          (data) =>
            mutate(() => {
              const numeric = [
                "left",
                "right",
                "first",
                "before",
                "after",
                "line",
              ].map((key) => Number(data[key]));
              if (
                numeric.some(
                  (value) => !Number.isFinite(value) || Math.abs(value) > 20000,
                ) ||
                Number(data.line) <= 0
              )
                throw new RangeError(
                  "Paragraph measurements must be finite; line height must be positive.",
                );
              engine.Change(() => {
                engine.SetParagraphProperty("TextAlignment", data.align);
                engine.SetParagraphProperty("Margin", {
                  Left: Number(data.left),
                  Right: Number(data.right),
                  Top: Number(data.before),
                  Bottom: Number(data.after),
                });
                engine.SetParagraphProperty("TextIndent", Number(data.first));
                engine.SetParagraphProperty("LineHeight", Number(data.line));
                engine.SetParagraphProperty(
                  "KeepTogether",
                  data.keep === "Yes",
                );
                engine.SetParagraphProperty(
                  "KeepWithNext",
                  data.next === "Yes",
                );
              });
            }),
        );
        break;
      }
      case "MoveSelection":
        this.prompt(
          "Move selected content",
          [
            {
              name: "destination",
              label: "Destination text offset (before the move)",
              value: String(editor.Document.Text.length),
              type: "number",
            },
          ],
          (data) =>
            mutate(() => engine.MoveSelection(Number(data.destination))),
        );
        break;
      case "MergeTableCells":
        this.prompt(
          "Merge adjacent table cells",
          [
            {
              name: "count",
              label: "Number of cells",
              value: "2",
              type: "number",
            },
          ],
          (data) => mutate(() => engine.MergeTableCells(Number(data.count))),
        );
        break;
      case "TextBox":
        this.prompt(
          "Insert text box",
          [
            {
              name: "text",
              label: "Text",
              value: "Text box",
              type: "textarea",
            },
            {
              name: "width",
              label: "Width (px)",
              value: "240",
              type: "number",
            },
          ],
          (data) =>
            mutate(() => {
              const width = Number(data.width);
              if (!Number.isFinite(width) || width < 16 || width > 20000)
                throw new RangeError(
                  "Text box width must be between 16 and 20000 pixels.",
                );
              const figure = new Figure(new Paragraph(data.text));
              figure.Width = width;
              figure.SetValue("WrapStyle", "Square");
              figure.SetValue("Padding", 12);
              figure.SetValue("BorderBrush", "#8395ab");
              figure.SetValue("BorderThickness", 1);
              engine.InsertNode(figure.ToJSON());
            }),
        );
        break;
      case "EditTextBox": {
        const object = editor.GetSelectedObject();
        if (!object || !["Figure", "Floater"].includes(object.type))
          throw new Error("Select or double-click a floating text box first.");
        this.editFloatingStory(editor, object);
        break;
      }
      case "FloatingLayout": {
        const object = editor.GetSelectedObject();
        if (!object) throw new Error("Select an image or text box first.");
        const props = object.props;
        const dimension = (value: unknown, fallback: number) =>
          typeof value === "number"
            ? value
            : value && typeof value === "object" && "Value" in value
              ? Number(value.Value) || fallback
              : fallback;
        this.prompt(
          "Object wrapping and position",
          [
            {
              name: "wrap",
              label: "Text wrapping",
              value:
                props.WrapStyle ||
                (object.type === "Figure" || object.type === "Floater"
                  ? "Square"
                  : "Inline"),
              options: [
                "Inline",
                "Square",
                "Tight",
                "TopAndBottom",
                "BehindText",
                "InFrontOfText",
              ],
            },
            {
              name: "alignment",
              label: "Horizontal alignment",
              value: props.HorizontalAlignment || "Right",
              options: ["Left", "Center", "Right"],
            },
            {
              name: "width",
              label: "Width (px)",
              value: String(dimension(props.Width, 240)),
              type: "number",
            },
            {
              name: "height",
              label: "Height (px, leave empty for automatic)",
              value: props.Height ? String(dimension(props.Height, 120)) : "",
              type: "number",
            },
            {
              name: "x",
              label: "Horizontal offset (px)",
              value: String(props.HorizontalOffset || 0),
              type: "number",
            },
            {
              name: "y",
              label: "Vertical offset (px)",
              value: String(props.VerticalOffset || 0),
              type: "number",
            },
            {
              name: "distance",
              label: "Distance from text (px)",
              value: String(props.WrapDistance ?? 12),
              type: "number",
            },
            {
              name: "shape",
              label: "Tight wrapping shape",
              value: props.Shape || "Rectangle",
              options: ["Rectangle", "Ellipse"],
            },
            {
              name: "rotation",
              label: "Rotation (degrees)",
              value: String(props.Rotation || 0),
              type: "number",
            },
          ],
          (data) =>
            mutate(() =>
              editor.SetFloatingLayout(object.id, {
                WrapStyle: data.wrap as any,
                HorizontalAlignment: data.alignment as any,
                Width: Number(data.width),
                ...(data.height ? { Height: Number(data.height) } : {}),
                HorizontalOffset: Number(data.x),
                VerticalOffset: Number(data.y),
                WrapDistance: Number(data.distance),
                Shape: data.shape as any,
                Rotation: Number(data.rotation),
              }),
            ),
        );
        break;
      }
      case "Table":
        this.prompt(
          "Insert table",
          [
            { name: "rows", label: "Rows", value: "3", type: "number" },
            { name: "columns", label: "Columns", value: "3", type: "number" },
          ],
          (data) =>
            mutate(() =>
              engine.InsertTable(Number(data.rows), Number(data.columns)),
            ),
        );
        break;
      case "Link":
        this.prompt(
          "Insert hyperlink",
          [
            { name: "url", label: "URL", value: "https://" },
            {
              name: "text",
              label: "Display text",
              value: engine.Selection.Text,
            },
          ],
          (data) =>
            mutate(() =>
              engine.Execute("InsertHyperlink", {
                uri: data.url,
                text: data.text,
              }),
            ),
        );
        break;
      case "Equation":
        this.editEquation(editor);
        break;
      case "Symbol":
        this.prompt(
          "Insert symbol",
          [
            {
              name: "symbol",
              label: "Symbol or Unicode text",
              value: "Ω",
              options: [
                "Ω",
                "α",
                "β",
                "γ",
                "δ",
                "π",
                "λ",
                "μ",
                "σ",
                "θ",
                "∞",
                "±",
                "×",
                "÷",
                "≤",
                "≥",
                "≠",
                "≈",
                "→",
                "©",
                "®",
                "™",
                "€",
                "£",
                "§",
                "¶",
                "†",
                "‡",
                "—",
                "…",
              ],
            },
          ],
          (data) => mutate(() => engine.InsertText(data.symbol)),
        );
        break;
      case "Image":
        this.prompt(
          "Insert image",
          [
            { name: "url", label: "Image URL", value: "https://" },
            { name: "alt", label: "Alternative text", value: "" },
            {
              name: "width",
              label: "Width (px)",
              value: "320",
              type: "number",
            },
          ],
          (data) =>
            mutate(() =>
              engine.Execute("InsertImage", {
                source: data.url,
                alt: data.alt,
                width: Number(data.width),
              }),
            ),
        );
        break;
      case "Field":
        this.prompt(
          "Insert field",
          [
            {
              name: "type",
              label: "Field type",
              value: "PAGE",
              options: [
                "PAGE",
                "NUMPAGES",
                "DATE",
                "TIME",
                "MERGEFIELD",
                "REF",
                "PAGEREF",
                "SEQ",
                "TITLE",
                "AUTHOR",
                "FILENAME",
              ],
            },
            {
              name: "argument",
              label: "Bookmark, merge column, or sequence name",
              value: "",
            },
          ],
          (data) =>
            mutate(() => {
              features.InsertField(data.type as FieldType, data.argument);
              features.UpdateFields();
            }),
        );
        break;
      case "TableOfContents":
        mutate(() => features.InsertTableOfContents());
        break;
      case "Footnote":
      case "Endnote":
        this.prompt(
          `Insert ${command.toLowerCase()}`,
          [{ name: "text", label: "Note text", value: "", type: "textarea" }],
          (data) => mutate(() => features.InsertNote(command, data.text)),
        );
        break;
      case "Header":
      case "Footer":
        this.editStory(
          editor,
          pageStoryKey(
            editor.Document.ToJSON().props,
            command,
            (editor as any).PageNumber || 1,
          ) as StoryKind,
        );
        break;
      case "FirstPageHeader":
      case "FirstPageFooter":
      case "EvenPageHeader":
      case "EvenPageFooter":
        this.editStory(editor, command);
        break;
      case "EditStory":
        this.editStory(editor, parameter as StoryKind);
        break;
      case "PageNumberFooter":
        mutate(() => {
          const p = new Paragraph(new Run("Page "));
          p.Inlines.Add(createField("PAGE"));
          p.Inlines.Add(new Run(" of "));
          p.Inlines.Add(createField("NUMPAGES"));
          p.TextAlignment = "Center";
          features.SetStory("Footers", [p.ToJSON()]);
        });
        break;
      case "PageSetup": {
        const props = editor.Document.ToJSON().props;
        const margins = pageSettings(props).Padding;
        this.prompt(
          "Page setup",
          [
            {
              name: "PageWidth",
              label: "Page width (px)",
              value: String(editor.Document.PageWidth),
              type: "number",
            },
            {
              name: "PageHeight",
              label: "Page height (px)",
              value: String(editor.Document.PageHeight),
              type: "number",
            },
            ...(["Left", "Top", "Right", "Bottom"] as const).map((side) => ({
              name: side,
              label: `${side} margin (px)`,
              value: String(margins[side]),
              type: "number",
            })),
            {
              name: "ColumnCount",
              label: "Columns",
              value: String(props.ColumnCount ?? 1),
              type: "number",
            },
            {
              name: "ColumnGap",
              label: "Column gap (px)",
              value: String(props.ColumnGap ?? 32),
              type: "number",
            },
            {
              name: "HeaderDistance",
              label: "Header distance from paper edge (px)",
              value: String(props.HeaderDistance ?? Math.min(8, margins.Top)),
              type: "number",
            },
            {
              name: "FooterDistance",
              label: "Footer distance from paper edge (px)",
              value: String(
                props.FooterDistance ?? Math.min(8, margins.Bottom),
              ),
              type: "number",
            },
            {
              name: "PageNumberStart",
              label: "Start page numbering at",
              value: String(props.PageNumberStart ?? 1),
              type: "number",
            },
            {
              name: "DifferentFirstPage",
              label: "Different first page",
              value: pageStoryVariantEnabled(props, "FirstPage") ? "Yes" : "No",
              options: ["No", "Yes"],
            },
            {
              name: "DifferentOddAndEvenPages",
              label: "Different odd and even pages",
              value: pageStoryVariantEnabled(props, "EvenPage") ? "Yes" : "No",
              options: ["No", "Yes"],
            },
          ],
          (data) =>
            mutate(() =>
              features.SetPageSetup({
                PageWidth: Number(data.PageWidth),
                PageHeight: Number(data.PageHeight),
                PagePadding: {
                  Left: Number(data.Left),
                  Top: Number(data.Top),
                  Right: Number(data.Right),
                  Bottom: Number(data.Bottom),
                },
                ColumnCount: Number(data.ColumnCount),
                ColumnGap: Number(data.ColumnGap),
                HeaderDistance: Number(data.HeaderDistance),
                FooterDistance: Number(data.FooterDistance),
                PageNumberStart: Number(data.PageNumberStart),
                DifferentFirstPage: data.DifferentFirstPage === "Yes",
                DifferentOddAndEvenPages:
                  data.DifferentOddAndEvenPages === "Yes",
              }),
            ),
        );
        break;
      }
      case "PageBreak":
        mutate(() => engine.InsertPageBreak());
        break;
      case "ColumnBreak":
        mutate(() => engine.InsertColumnBreak());
        break;
      case "KeepTogether":
      case "KeepWithNext":
        mutate(() => engine.SetParagraphProperty(command, true));
        break;
      case "UpdateFields":
        mutate(() => {
          const result = features.UpdateFields();
          this.status = `${result.Updated} fields updated${result.Unresolved.length ? `; ${result.Unresolved.length} need page or merge data` : ""}`;
        });
        break;
      case "UpdateTableOfContents":
        mutate(() => features.UpdateTableOfContents());
        break;
      case "MailMerge":
        this.prompt(
          "Mail merge",
          [
            {
              name: "records",
              label: "JSON array of records",
              value: '[{"Name":"Ada"},{"Name":"Grace"}]',
              type: "textarea",
            },
          ],
          (data) =>
            mutate(() => {
              const records = JSON.parse(data.records);
              if (
                !Array.isArray(records) ||
                records.some(
                  (row) =>
                    !row || typeof row !== "object" || Array.isArray(row),
                )
              )
                throw new TypeError("Supply an array of record objects.");
              const documents = features.MailMerge(records);
              this.dispatchEvent(
                new CustomEvent("documentsgenerated", {
                  detail: { documents },
                  bubbles: true,
                  composed: true,
                }),
              );
              this.status = `${documents.length} merged documents generated`;
            }),
        );
        break;
      case "TrackChanges":
        mutate(() => {
          engine.TrackChanges = !engine.TrackChanges;
        });
        break;
      case "AcceptAllRevisions":
        mutate(() => engine.AcceptAllRevisions());
        break;
      case "RejectAllRevisions":
        mutate(() => engine.RejectAllRevisions());
        break;
      case "ReviewChanges":
        this.reviewChanges();
        break;
      case "Comment":
        this.prompt(
          "Add comment",
          [{ name: "text", label: "Comment", value: "", type: "textarea" }],
          (data) =>
            mutate(() => engine.AddComment(data.text, engine.CurrentAuthor)),
        );
        break;
      case "Bookmark":
        this.prompt(
          "Add bookmark",
          [{ name: "name", label: "Bookmark name", value: "" }],
          (data) => mutate(() => engine.AddBookmark(data.name)),
        );
        break;
      case "FindReplace":
        this.prompt(
          "Find and replace",
          [
            { name: "find", label: "Find", value: engine.Selection.Text },
            { name: "replace", label: "Replace with", value: "" },
          ],
          (data) => mutate(() => engine.ReplaceAll(data.find, data.replace)),
        );
        break;
      case "PagePreview":
        this.dispatchEvent(
          new CustomEvent("previewrequest", {
            detail: { document: editor.Document },
            bubbles: true,
            composed: true,
          }),
        );
        break;
      default:
        return mutate(() => editor.Execute(command, parameter));
    }
    this.dispatchEvent(
      new CustomEvent("commandexecuted", {
        detail: { command },
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }
  /** Each invocation owns a dialog: queued close events must not reach a new session. */
  private createDialog(): HTMLDialogElement {
    const previous = this.shadowRoot!.querySelector("dialog");
    const dialog = this.ownerDocument.createElement("dialog");
    dialog.setAttribute("part", "dialog");
    if (previous) {
      if (previous.open) previous.close();
      previous.replaceWith(dialog);
    } else this.shadowRoot!.append(dialog);
    return dialog;
  }
  private prompt(
    title: string,
    fields: {
      name: string;
      label: string;
      value: string;
      type?: string;
      options?: string[];
    }[],
    submit: (data: Record<string, string>) => unknown,
  ) {
    const dialog = this.createDialog();
    const targetEditor = this.editor,
      targetDocument = this.editor?.Document;
    dialog.replaceChildren();
    const form = this.ownerDocument.createElement("form");
    form.method = "dialog";
    const heading = this.ownerDocument.createElement("h2");
    heading.textContent = title;
    form.append(heading);
    for (const field of fields) {
      const label = this.ownerDocument.createElement("label");
      label.textContent = field.label;
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (field.options)
        input = this.select(field.label, field.options, () => {});
      else
        input = this.ownerDocument.createElement(
          field.type === "textarea" ? "textarea" : "input",
        );
      if (input instanceof HTMLInputElement) input.type = field.type ?? "text";
      input.name = field.name;
      input.value = field.value;
      label.append(input);
      form.append(label);
    }
    const actions = this.ownerDocument.createElement("div");
    actions.className = "actions";
    const cancel = this.ownerDocument.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    const apply = this.ownerDocument.createElement("button");
    apply.textContent = "Apply";
    apply.className = "primary";
    actions.append(cancel, apply);
    const errorMessage = this.ownerDocument.createElement("p");
    errorMessage.setAttribute("role", "alert");
    form.append(errorMessage, actions);
    dialog.append(form);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (
        this.editor !== targetEditor ||
        this.editor?.Document !== targetDocument ||
        this.editor?.IsReadOnly
      ) {
        dialog.close();
        return;
      }
      try {
        submit(
          Object.fromEntries(new FormData(form)) as Record<string, string>,
        );
        dialog.close();
      } catch (error) {
        errorMessage.textContent =
          error instanceof Error ? error.message : String(error);
        this.status = errorMessage.textContent;
        this.Refresh();
      }
    };
    dialog.showModal();
  }
  private editStory(editor: RichTextBox, kind: StoryKind): void {
    const session = new DocumentStorySession(editor.Engine, kind);
    const dialog = this.createDialog();
    dialog.style.width = "min(960px,96vw)";
    const title = this.ownerDocument.createElement("h2");
    const label = kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/s$/, "");
    title.textContent = `Edit ${label.toLowerCase()}`;
    const hint = this.ownerDocument.createElement("p");
    hint.className = "muted";
    hint.textContent =
      "Formatting, tables, images, fields and equations are preserved. Apply saves one document undo step; Cancel leaves the original story unchanged.";
    const nested = this.ownerDocument.createElement("rich-text-box");
    nested.ViewMode = "continuous";
    nested.style.cssText =
      "height:300px;min-height:160px;border:1px solid var(--rt-toolbar-border,#ccd5e1)";
    nested.setAttribute("aria-label", `${label} content`);
    nested.setAttribute("theme", editor.getAttribute("theme") || "light");
    nested.Document = session.Document;
    const toolbar = this.ownerDocument.createElement("rich-text-toolbar");
    toolbar.Mode = "home";
    toolbar.Editor = nested;
    const insertTools = this.ownerDocument.createElement("div");
    insertTools.className = "group";
    for (const command of ["Field", "Equation", "Table", "Image", "Link"]) {
      const button = this.ownerDocument.createElement("button");
      button.type = "button";
      button.textContent = command;
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => toolbar.Execute(command);
      insertTools.append(button);
    }
    const status = this.ownerDocument.createElement("p");
    status.setAttribute("role", "alert");
    const actions = this.ownerDocument.createElement("div");
    actions.className = "actions";
    const cancel = this.ownerDocument.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    const apply = this.ownerDocument.createElement("button");
    apply.textContent = "Apply";
    apply.className = "primary";
    apply.onclick = () => {
      try {
        if (this.editor !== editor || editor.IsReadOnly)
          throw new Error("The target editor changed or became read-only.");
        if (nested.Document !== session.Document)
          session.Engine.SetDocument(nested.Document);
        session.Apply();
        dialog.close();
        editor.Focus();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
    };
    actions.append(cancel, apply);
    dialog.append(title, hint, toolbar, insertTools, nested, status, actions);
    dialog.addEventListener(
      "close",
      () => {
        toolbar.Dispose();
        nested.Dispose();
        session.Dispose();
      },
      { once: true },
    );
    dialog.showModal();
    nested.Focus();
  }
  private editEquation(editor: RichTextBox): void {
    const dialog = this.createDialog();
    dialog.replaceChildren();
    dialog.style.width = "min(840px,96vw)";
    const heading = this.ownerDocument.createElement("h2");
    const object = editor.GetSelectedObject();
    const equation = object?.type === "Equation" ? object : null;
    const original = equation && JSON.stringify(equation.props);
    const originalDocument = editor.Document,
      originalRevision = editor.Document.Revision;
    const start = editor.Selection.Start.Offset,
      end = editor.Selection.End.Offset;
    heading.textContent = equation ? "Edit equation" : "Insert equation";
    const workbench = new EquationEditor();
    workbench.Value = equation
      ? equationOptions(equation)
      : {
          Source:
            editor.Selection.Text.trim() ||
            String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
          Format: "latex",
          DisplayMode: false,
        };
    const status = this.ownerDocument.createElement("p");
    status.setAttribute("role", "alert");
    const actions = this.ownerDocument.createElement("div");
    actions.className = "actions";
    const cancel = this.ownerDocument.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    const apply = this.ownerDocument.createElement("button");
    apply.textContent = "Apply";
    apply.className = "primary";
    apply.onclick = () => {
      try {
        // Flush an in-progress source edit before reading the accepted value.
        workbench.shadowRoot
          ?.querySelector("textarea")
          ?.dispatchEvent(new Event("change"));
        if (!workbench.Validate()) throw new Error(workbench.Error);
        if (
          this.editor !== editor ||
          editor.IsReadOnly ||
          editor.Document !== originalDocument
        )
          throw new Error("The target document changed or became read-only.");
        const value = workbench.Value;
        editor.Engine.BeginChange();
        try {
          let id: string;
          if (equation) {
            const current = editor.Document.FindById(equation.id);
            if (!current || JSON.stringify(current.ToJSON().props) !== original)
              throw new Error(
                "The equation changed while this dialog was open; reopen the current equation.",
              );
            id = equation.id;
            editor.Engine.UpdateEquation(
              id,
              value.Source,
              value.Format,
              value.DisplayMode,
            );
          } else {
            if (editor.Document.Revision !== originalRevision)
              throw new Error(
                "The document changed while the equation dialog was open; reopen at the intended position.",
              );
            editor.Select(start, end);
            id = editor.Engine.InsertEquation(
              value.Source,
              value.Format,
              value.DisplayMode,
            );
          }
          editor.Engine.SetElementProperty(
            id,
            "AlternativeText",
            value.AlternativeText ?? "",
          );
        } finally {
          editor.Engine.EndChange();
        }
        dialog.close();
        editor.Focus();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
    };
    actions.append(cancel, apply);
    dialog.append(heading, workbench, status, actions);
    dialog.addEventListener(
      "close",
      () => {
        workbench.Dispose();
        dialog.style.width = "";
      },
      { once: true },
    );
    dialog.showModal();
  }
  private editFloatingStory(editor: RichTextBox, object: DocumentNode): void {
    const dialog = this.createDialog();
    dialog.replaceChildren();
    dialog.style.width = "min(900px,95vw)";
    const heading = this.ownerDocument.createElement("h2");
    heading.textContent = "Edit floating text box";
    const nested = this.ownerDocument.createElement("rich-text-box");
    nested.ViewMode = "continuous";
    nested.style.height = "320px";
    nested.setAttribute("aria-label", "Text box content");
    nested.Document = FlowDocument.FromJSON({
      type: "FlowDocument",
      id: `${object.id}-editing-story`,
      props: { Annotations: object.props.StoryAnnotations || [] },
      children: structuredClone(object.children || []),
    });
    const toolbar = this.ownerDocument.createElement("rich-text-toolbar");
    toolbar.Mode = "home";
    toolbar.Editor = nested;
    const actions = this.ownerDocument.createElement("div");
    actions.className = "actions";
    const status = this.ownerDocument.createElement("p");
    status.setAttribute("role", "status");
    const cancel = this.ownerDocument.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    const save = this.ownerDocument.createElement("button");
    save.textContent = "Apply";
    save.className = "primary";
    const original = JSON.stringify(object.children || []);
    save.onclick = () => {
      try {
        if (this.editor !== editor || editor.IsReadOnly)
          throw new Error("The target editor changed or became read-only.");
        const find = (node: DocumentNode): DocumentNode | undefined =>
          node.id === object.id ? node : node.children?.map(find).find(Boolean);
        const current = find(editor.Document.ToJSON());
        if (!current || JSON.stringify(current.children || []) !== original)
          throw new Error(
            "Text box content changed while this dialog was open; close and reopen to edit the latest content.",
          );
        editor.Engine.EditFloatingContent(object.id, (story) =>
          story.ReplaceDocument(nested.Document),
        );
        dialog.close();
        editor.Focus();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
    };
    actions.append(cancel, save);
    dialog.append(heading, toolbar, nested, status, actions);
    dialog.addEventListener(
      "close",
      () => {
        toolbar.Dispose();
        nested.Dispose();
        dialog.style.width = "";
      },
      { once: true },
    );
    dialog.showModal();
    nested.Focus();
  }
  private reviewChanges() {
    const dialog = this.createDialog();
    dialog.replaceChildren();
    const h = this.ownerDocument.createElement("h2");
    h.textContent = "Tracked changes";
    dialog.append(h);
    const revisions = this.editor!.Engine.Revisions;
    if (!revisions.length) {
      const p = this.ownerDocument.createElement("p");
      p.textContent = "No pending changes.";
      dialog.append(p);
    }
    for (const revision of revisions) {
      const row = this.ownerDocument.createElement("div");
      row.className = "revision";
      const p = this.ownerDocument.createElement("p");
      p.textContent = `${revision.Kind} · ${revision.Data.Author ?? "Author"}\n${revision.Data.Text ?? revision.Data.Operation ?? this.editor!.Document.Text.slice(revision.Start, revision.End)}`;
      row.append(p);
      for (const action of ["Accept", "Reject"]) {
        const b = this.ownerDocument.createElement("button");
        b.textContent = action;
        b.disabled = this.editor!.IsReadOnly;
        b.onclick = () => {
          if (this.editor!.IsReadOnly) return;
          try {
            action === "Accept"
              ? this.editor!.Engine.AcceptRevision(revision.Id)
              : this.editor!.Engine.RejectRevision(revision.Id);
            dialog.close();
            this.reviewChanges();
          } catch (error) {
            this.status = String(error);
            this.Refresh();
          }
        };
        row.append(b);
      }
      dialog.append(row);
    }
    const close = this.ownerDocument.createElement("button");
    close.textContent = "Close";
    close.onclick = () => dialog.close();
    dialog.append(close);
    dialog.showModal();
  }
}
export function registerRichTextToolbar(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (registry && !registry.get("rich-text-toolbar"))
    registry.define("rich-text-toolbar", RichTextToolbar);
}
