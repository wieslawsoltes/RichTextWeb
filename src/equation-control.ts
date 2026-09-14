import {
  renderEquation,
  equationTokens,
  replaceEquationToken,
  EquationTemplates,
  editEquationMatrix,
  equationMatrixAt,
  insertEquationToken,
  deleteEquationToken,
  mathMLToLaTeX,
  type MatrixEdit,
  type EquationMatrixPosition,
  type EquationOptions,
  type EquationRenderResult,
  type MathToken,
} from "./equations.js";
import type { EquationInputFormat } from "./model.js";

const HTMLElementBase = (globalThis.HTMLElement ??
  class {}) as typeof HTMLElement;
export type EquationStructure =
  "fraction" | "power" | "subscript" | "root" | "sum" | "integral" | "matrix";
const css = `:host{display:block;color:var(--rt-toolbar-color,#243247);font:13px/1.45 var(--rt-ui-font,system-ui);min-width:0}*{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit}button,select,input,textarea{border:1px solid var(--rt-toolbar-border,#cbd5e1);border-radius:5px;background:var(--rt-toolbar-background,#fff);padding:7px}button{cursor:pointer;min-height:34px}button:hover{background:var(--rt-toolbar-hover,#eef4ff)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--rt-accent,#2563eb);outline-offset:2px}.row{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:8px 0}.row label{display:flex;gap:7px;align-items:center;margin:0}.grow{flex:1;min-width:160px}.preview{min-height:140px;max-height:300px;overflow:auto;border:1px solid var(--rt-toolbar-border,#cbd5e1);border-radius:8px;padding:24px;background:var(--rt-toolbar-background,#fff);font-size:22px;text-align:center}.preview mjx-container{max-width:100%}.preview svg{max-width:100%;height:auto;overflow:visible}.preview g[data-mml-node=mi],.preview g[data-mml-node=mn],.preview g[data-mml-node=mo],.preview g[data-mml-node=mtext]{cursor:pointer}.preview g[data-selected]{color:var(--rt-accent,#2563eb);filter:drop-shadow(0 0 2px #93c5fd)}textarea{width:100%;min-height:92px;resize:vertical;max-height:320px;font:13px/1.5 ui-monospace,monospace}.error{color:var(--rt-error,#b42318);min-height:21px;overflow-wrap:anywhere}.hint{color:var(--rt-muted,#63738a);margin:7px 0;font-size:12px}.token-select{max-width:190px}.token-input{width:100px}.gallery{max-width:100%}.alt{width:100%}details{margin:12px 0}summary{cursor:pointer;font-weight:600}.caption{font-weight:600}.structures{gap:5px}.structures button{min-width:44px}.keyboard-help{font-size:12px}@media(max-width:520px){.preview{padding:14px;min-height:110px}.row{gap:5px}.row .grow{width:100%}}`;

/** Reusable visual math workbench. Apply its Value to any engine or host framework. */
export class EquationEditor extends HTMLElementBase {
  private value: EquationOptions = {
    Source: "x",
    Format: "latex",
    DisplayMode: false,
    AlternativeText: "",
  };
  private undo: EquationOptions[] = [];
  private redo: EquationOptions[] = [];
  private result: EquationRenderResult | null = null;
  private tokens: MathToken[] = [];
  private selected = 0;
  private error = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private locked = false;
  private sourceInput: HTMLTextAreaElement | null = null;
  private preview: HTMLDivElement | null = null;
  private status: HTMLElement | null = null;
  private tokenSelect: HTMLSelectElement | null = null;
  private tokenInput: HTMLInputElement | null = null;
  constructor() {
    super();
    if (this.attachShadow) this.attachShadow({ mode: "open" });
  }
  connectedCallback(): void {
    this.render();
    this.Validate();
  }
  disconnectedCallback(): void {
    clearTimeout(this.timer);
  }
  get Value(): EquationOptions {
    return { ...this.value };
  }
  set Value(value: EquationOptions) {
    clearTimeout(this.timer);
    if (!value || typeof value.Source !== "string")
      throw new TypeError("Equation Value needs a Source string.");
    this.value = {
      Source: value.Source,
      Format: value.Format ?? "latex",
      DisplayMode: !!value.DisplayMode,
      AlternativeText: value.AlternativeText ?? "",
    };
    this.undo = [];
    this.redo = [];
    this.selected = 0;
    if (this.isConnected) {
      this.render();
      this.Validate();
    }
  }
  get Source(): string {
    return this.value.Source;
  }
  set Source(value: string) {
    this.Value = { ...this.value, Source: value };
  }
  get Format(): EquationInputFormat {
    return this.value.Format ?? "latex";
  }
  set Format(value: EquationInputFormat) {
    this.Value = { ...this.value, Format: value };
  }
  /** Convert a valid equation, or interpret a replacement draft in its requested format.
   * Failed conversions preserve the source and history. The Format setter remains
   * available for callers that explicitly want to change only interpretation.
   */
  ConvertFormat(format: EquationInputFormat): boolean {
    if (format !== "latex" && format !== "mathml")
      throw new TypeError("Equation format must be latex or mathml.");
    if (this.locked || format === this.Format) return false;
    let current: EquationRenderResult | null = null;
    try {
      current = renderEquation(this.value);
    } catch {
      // A replacement may already use the target syntax before the selector changes.
      // It is accepted only when that syntax validates; no valid tree is discarded.
    }
    const source = current
      ? format === "mathml"
        ? current.MathML
        : mathMLToLaTeX(current.MathML)
      : this.Source;
    const next = { ...this.value, Source: source, Format: format };
    renderEquation(next);
    this.change(next, true);
    return true;
  }
  get DisplayMode(): boolean {
    return !!this.value.DisplayMode;
  }
  set DisplayMode(value: boolean) {
    this.Value = { ...this.value, DisplayMode: value };
  }
  get IsReadOnly(): boolean {
    return this.locked;
  }
  set IsReadOnly(value: boolean) {
    this.locked = !!value;
    if (this.isConnected) this.render();
  }
  get IsValid(): boolean {
    return !this.error && this.result !== null;
  }
  get Error(): string {
    return this.error;
  }
  get RenderResult(): EquationRenderResult | null {
    return this.result;
  }
  get CanUndo(): boolean {
    return !!this.undo.length;
  }
  get CanRedo(): boolean {
    return !!this.redo.length;
  }
  get SelectedToken(): Readonly<MathToken> | null {
    const token = this.tokens[this.selected];
    return token ? { ...token, Path: [...token.Path] } : null;
  }
  Validate(): boolean {
    clearTimeout(this.timer);
    try {
      this.result = renderEquation(this.value);
      this.tokens = equationTokens(this.result.MathML);
      this.error = "";
    } catch (error) {
      this.result = null;
      this.tokens = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.selected = Math.min(
      this.selected,
      Math.max(0, this.tokens.length - 1),
    );
    this.renderPreview();
    this.dispatchEvent(
      new CustomEvent("validationchange", {
        detail: { isValid: this.IsValid, error: this.error },
        bubbles: true,
        composed: true,
      }),
    );
    return this.IsValid;
  }
  SelectToken(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.tokens.length)
      throw new RangeError("Equation token index is outside the equation.");
    this.selected = index;
    this.updateTokenSelection();
  }
  ReplaceToken(text: string, structure?: EquationStructure): void {
    if (this.locked) return;
    if (!this.Validate() || !this.result || !this.tokens[this.selected])
      throw new Error(this.error || "Select a math token first.");
    const source = replaceEquationToken(
      this.result.MathML,
      this.tokens[this.selected].Path,
      text,
      structure,
    );
    this.change({ ...this.value, Source: source, Format: "mathml" }, true);
  }
  get SelectedMatrix(): EquationMatrixPosition | null {
    if (!this.result || !this.tokens[this.selected]) return null;
    try {
      return equationMatrixAt(
        this.result.MathML,
        this.tokens[this.selected].Path,
      );
    } catch {
      return null;
    }
  }
  EditMatrix(operation: MatrixEdit): void {
    if (this.locked) return;
    const selected = this.validSelection();
    const source = editEquationMatrix(
      this.result!.MathML,
      selected.Path,
      operation,
    );
    this.change({ ...this.value, Source: source, Format: "mathml" }, true);
  }
  InsertToken(text: string, before = false): void {
    if (this.locked) return;
    const selected = this.validSelection();
    this.change(
      {
        ...this.value,
        Source: insertEquationToken(
          this.result!.MathML,
          selected.Path,
          text,
          before,
        ),
        Format: "mathml",
      },
      true,
    );
  }
  DeleteToken(): void {
    if (this.locked) return;
    const selected = this.validSelection();
    this.change(
      {
        ...this.value,
        Source: deleteEquationToken(this.result!.MathML, selected.Path),
        Format: "mathml",
      },
      true,
    );
  }
  private validSelection(): MathToken {
    if (!this.Validate() || !this.tokens[this.selected])
      throw new Error(this.error || "Select a math token first.");
    return this.tokens[this.selected];
  }
  InsertTemplate(name: string): void {
    const template = EquationTemplates.find((item) => item.Name === name);
    if (!template) throw new RangeError(`Unknown equation template: ${name}`);
    if (this.locked) return;
    this.selected = 0;
    this.change(
      { ...this.value, Source: template.Source, Format: "latex" },
      true,
    );
  }
  Undo(): boolean {
    if (this.locked || !this.undo.length) return false;
    this.redo.push(this.Value);
    this.value = this.undo.pop()!;
    this.refreshValue();
    return true;
  }
  Redo(): boolean {
    if (this.locked || !this.redo.length) return false;
    this.undo.push(this.Value);
    this.value = this.redo.pop()!;
    this.refreshValue();
    return true;
  }
  Dispose(): void {
    clearTimeout(this.timer);
    this.undo = [];
    this.redo = [];
    this.result = null;
    this.shadowRoot?.replaceChildren();
  }
  private change(
    next: EquationOptions,
    rebuild = false,
    deferred = false,
  ): void {
    if (this.locked || JSON.stringify(next) === JSON.stringify(this.value))
      return;
    this.undo.push(this.Value);
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
    this.value = next;
    if (rebuild) this.render();
    clearTimeout(this.timer);
    if (deferred) {
      // The public Value always follows the typed draft; only typesetting is debounced.
      this.result = null;
      this.error = "";
      this.timer = setTimeout(() => this.Validate(), 120);
    } else this.Validate();
    this.emitValue();
  }
  private refreshValue(): void {
    this.render();
    this.Validate();
    this.emitValue();
  }
  private emitValue(): void {
    this.dispatchEvent(
      new CustomEvent("equationchange", {
        detail: { value: this.Value, isValid: this.IsValid },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private render(): void {
    if (!this.shadowRoot) return;
    const d = this.ownerDocument,
      style = d.createElement("style");
    style.textContent = css;
    const top = d.createElement("div");
    top.className = "row";
    const gallery = d.createElement("select");
    gallery.className = "gallery grow";
    gallery.setAttribute("aria-label", "Equation templates");
    gallery.add(new Option("Choose an equation template…", ""));
    for (const category of [
      ...new Set(EquationTemplates.map((item) => item.Category)),
    ]) {
      const group = d.createElement("optgroup");
      group.label = category;
      EquationTemplates.filter((item) => item.Category === category).forEach(
        (item) => group.append(new Option(item.Name, item.Name)),
      );
      gallery.append(group);
    }
    gallery.onchange = () => {
      if (gallery.value) this.InsertTemplate(gallery.value);
    };
    top.append(
      gallery,
      this.button("Undo", () => this.Undo(), !this.CanUndo),
      this.button("Redo", () => this.Redo(), !this.CanRedo),
    );
    this.preview = d.createElement("div");
    this.preview.className = "preview";
    this.preview.setAttribute("part", "preview");
    this.preview.setAttribute(
      "aria-label",
      "Equation preview; select a symbol to edit",
    );
    const hint = d.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Select a symbol in the preview, or use the token selector. Structural tools wrap the selected symbol. Visual edits use editable MathML.";
    const tokenRow = d.createElement("div");
    tokenRow.className = "row";
    this.tokenSelect = d.createElement("select");
    this.tokenSelect.className = "token-select";
    this.tokenSelect.setAttribute("aria-label", "Equation token");
    this.tokenSelect.onchange = () =>
      this.SelectToken(Number(this.tokenSelect!.value));
    this.tokenInput = d.createElement("input");
    this.tokenInput.className = "token-input";
    this.tokenInput.setAttribute("aria-label", "Symbol text");
    this.tokenInput.maxLength = 2048;
    this.tokenInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.ReplaceToken(this.tokenInput!.value);
      }
    };
    tokenRow.append(
      this.tokenSelect,
      this.tokenInput,
      this.button("Replace symbol", () =>
        this.ReplaceToken(this.tokenInput!.value),
      ),
      this.button("Insert before", () =>
        this.InsertToken(this.tokenInput!.value, true),
      ),
      this.button("Insert after", () =>
        this.InsertToken(this.tokenInput!.value),
      ),
      this.button("Delete symbol", () => this.DeleteToken()),
    );
    const structures = d.createElement("div");
    structures.className = "row structures";
    for (const [label, operation] of [
      ["a/b", "fraction"],
      ["x²", "power"],
      ["xᵢ", "subscript"],
      ["√x", "root"],
      ["∑", "sum"],
      ["∫", "integral"],
      ["Matrix", "matrix"],
    ] as const) {
      const button = this.button(label, () =>
        this.ReplaceToken(this.tokenInput!.value, operation),
      );
      button.title = `Insert ${operation}`;
      structures.append(button);
    }
    const matrixTools = d.createElement("div");
    matrixTools.className = "row structures";
    matrixTools.setAttribute("aria-label", "Matrix editing");
    for (const [label, operation] of [
      ["Row before", "InsertRowBefore"],
      ["Row after", "InsertRowAfter"],
      ["Delete row", "DeleteRow"],
      ["Column before", "InsertColumnBefore"],
      ["Column after", "InsertColumnAfter"],
      ["Delete column", "DeleteColumn"],
    ] as const) {
      const button = this.button(label, () => this.EditMatrix(operation));
      button.dataset.matrix = operation;
      matrixTools.append(button);
    }
    const options = d.createElement("div");
    options.className = "row";
    const display = d.createElement("label"),
      check = d.createElement("input");
    check.type = "checkbox";
    check.checked = this.DisplayMode;
    check.onchange = () =>
      this.change({ ...this.value, DisplayMode: check.checked });
    display.append(check, "Display equation on its own line");
    options.append(display);
    const format = d.createElement("select");
    format.setAttribute("aria-label", "Equation input format");
    format.add(new Option("LaTeX", "latex"));
    format.add(new Option("MathML", "mathml"));
    format.value = this.Format;
    format.onchange = () => {
      try {
        this.ConvertFormat(format.value as EquationInputFormat);
      } catch (error) {
        format.value = this.Format;
        if (this.status)
          this.status.textContent =
            error instanceof Error ? error.message : String(error);
      }
    };
    const sourceLabel = d.createElement("label");
    sourceLabel.className = "caption";
    sourceLabel.textContent = "Equation source";
    this.sourceInput = d.createElement("textarea");
    this.sourceInput.value = this.Source;
    this.sourceInput.setAttribute("aria-label", "Equation source");
    this.sourceInput.spellcheck = false;
    this.sourceInput.oninput = () => {
      clearTimeout(this.timer);
      this.change(
        { ...this.value, Source: this.sourceInput!.value },
        false,
        true,
      );
    };
    // Ensure Apply never reads the preceding debounce value.
    this.sourceInput.onchange = () => {
      clearTimeout(this.timer);
      this.change({ ...this.value, Source: this.sourceInput!.value });
      this.Validate();
    };
    const sourceRow = d.createElement("div");
    sourceRow.className = "row";
    sourceRow.append(sourceLabel, format);
    const alt = d.createElement("input");
    alt.className = "alt";
    alt.placeholder =
      "Describe the equation for readers using assistive technology";
    alt.setAttribute("aria-label", "Equation alternative text");
    alt.value = this.value.AlternativeText ?? "";
    alt.maxLength = 4096;
    alt.oninput = () => {
      if (!this.locked)
        this.change({ ...this.value, AlternativeText: alt.value });
    };
    this.status = d.createElement("div");
    this.status.className = "error";
    this.status.setAttribute("role", "status");
    this.shadowRoot.replaceChildren(
      style,
      top,
      this.preview,
      hint,
      tokenRow,
      structures,
      matrixTools,
      options,
      sourceRow,
      this.sourceInput,
      alt,
      this.status,
    );
    if (this.locked)
      this.shadowRoot
        .querySelectorAll<HTMLInputElement>("input,select,textarea,button")
        .forEach((control) => (control.disabled = true));
    this.renderPreview();
  }
  private button(
    text: string,
    action: () => unknown,
    disabled = false,
  ): HTMLButtonElement {
    const button = this.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.action = text.toLowerCase();
    button.disabled = disabled || this.locked;
    button.onclick = () => {
      try {
        action();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        if (this.status) this.status.textContent = this.error;
      }
    };
    return button;
  }
  private renderPreview(): void {
    if (!this.preview || !this.tokenSelect) return;
    this.preview.replaceChildren();
    const undo = this.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-action="undo"]',
    );
    const redo = this.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-action="redo"]',
    );
    if (undo) undo.disabled = this.locked || !this.CanUndo;
    if (redo) redo.disabled = this.locked || !this.CanRedo;
    if (this.result) {
      this.preview.innerHTML = this.result.SVG;
      this.preview
        .querySelectorAll<HTMLElement>(
          "g[data-mml-node=mi],g[data-mml-node=mn],g[data-mml-node=mo],g[data-mml-node=mtext]",
        )
        .forEach((token, index) => {
          if (index < this.tokens.length)
            token.onclick = (event) => {
              event.stopPropagation();
              this.SelectToken(index);
              this.tokenInput?.focus();
            };
        });
    } else this.preview.textContent = "The equation preview will appear here.";
    this.tokenSelect.replaceChildren();
    this.tokens.forEach((token, i) =>
      this.tokenSelect!.add(
        new Option(`${i + 1}: ${token.Text || "empty"}`, String(i)),
      ),
    );
    if (this.status) this.status.textContent = this.error;
    this.updateTokenSelection();
  }
  private updateTokenSelection(): void {
    const matrix = this.SelectedMatrix;
    this.shadowRoot
      ?.querySelectorAll<HTMLButtonElement>("[data-matrix]")
      .forEach((button) => {
        button.disabled =
          this.locked ||
          !matrix ||
          (button.dataset.matrix === "DeleteRow" && matrix.Rows === 1) ||
          (button.dataset.matrix === "DeleteColumn" && matrix.Columns === 1);
      });
    if (this.tokenSelect) this.tokenSelect.value = String(this.selected);
    if (this.tokenInput)
      this.tokenInput.value = this.tokens[this.selected]?.Text ?? "";
    this.preview
      ?.querySelectorAll(
        "g[data-mml-node=mi],g[data-mml-node=mn],g[data-mml-node=mo],g[data-mml-node=mtext]",
      )
      .forEach((node, i) =>
        node.toggleAttribute("data-selected", i === this.selected),
      );
  }
}

export function registerEquationEditor(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (registry && !registry.get("rich-equation-editor"))
    registry.define("rich-equation-editor", EquationEditor);
}
declare global {
  interface HTMLElementTagNameMap {
    "rich-equation-editor": EquationEditor;
  }
}
