# Paginated authoring and equations

RichTextWeb's editing engine is the document authority. The page editor, continuous editor, React wrappers, native bridge and sample commands use it; changing a view does not replace the document or clear its history.

## Document views and page arrangements

```js
import { registerRichTextWeb } from "@wieslawsoltes/richtextweb/web";
registerRichTextWeb();
const editor = document.querySelector("rich-text-page-editor");
editor.DocumentView = "PrintLayout";
editor.PageArrangement = "Vertical";
editor.ZoomMode = "PageWidth";
const layout = await editor.Repaginate();
console.log(layout.Pages, layout.Overflows, editor.PaginationStatistics);
```

`DocumentView` accepts `PrintLayout`, `WebLayout`, `ReadMode`, `Outline` and `Draft`. Print layout and read mode show finite physical sheets; web layout is continuous rich text. Read mode adds a presentation-level read-only policy without discarding an application's existing policy. Draft uses continuous simplified presentation. Outline exposes heading hierarchy and `OutlineLevel` (1–9, where 9 includes body text); it does not implement Word's full master-document system.

`PageArrangement` accepts `SinglePage`, `TwoPages`, `Vertical` and `MultiplePages`. There is one live, selection-bearing editor. Nearby sheets are non-editable mirrors that become the live page when activated by pointer or keyboard. Mirror realization prioritizes the visible viewport, then one adjacent row, with a hard ceiling of 128 sheets for pathological host geometries; the complete body is still measured by the browser. This is **not** a fully virtualized page-layout engine. For very large continuous documents, use `EnableVirtualization` on `RichTextBox`/web view, which windows actual top-level block DOM.

`ZoomMode` accepts `Custom`, `PageWidth`, `WholePage` and `TwoPages`. Custom `Zoom` is a ratio. Automatic fitting uses the actual viewport and responds to panel resizing. The sample offers the views, arrangements and fit commands in its View ribbon and status bar.

Use `editor.Engine.InsertPageBreak()` for a physical page break at the caret, and `InsertColumnBreak()` to advance within a multi-column sheet. Ctrl/Command+Enter inserts a page break; adding Shift inserts a column break. Each command splits the current paragraph and creates one undo unit. Forced page breaks are aligned to physical sheets rather than being mistaken for single column breaks. Existing paragraph-level `BreakPageBefore`, keep-with-next and keep-together properties remain available.

Default paper geometry is A4-like **794 × 1123 CSS pixels**, with 72-pixel padding. This fixes the previous mismatch between implicit model dimensions and the viewer. Supply explicit dimensions for existing applications needing Letter or other paper. Comma-separated thickness values use .NET left/top/right/bottom order; space-separated CSS values use top/right/bottom/left. Paragraph `LineHeight` and first-line `TextIndent` use CSS pixels, not a line-spacing multiplier.

### Layout cache and printing

Selection, caret, page and zoom navigation reuse measured geometry. Document/property changes and font/image readiness invalidate it. `InvalidatePagination()` explicitly requests new geometry without replacing document data. `PaginationStatistics` exposes layout passes, cache hits, last measured duration, revision and realized mirror count. These are observations, not a performance guarantee for every input.

```js
await editor.Repaginate();
const html = await editor.GetPrintHTML({
  StartPage: 2,
  EndPage: 4,
  Title: "Review copy",
});
// Or call directly from a user gesture to prepare and open the browser print dialog:
editor.Print();
```

Browser printing uses the **measured sheets**, including page-specific stories, columns and vector equations. A selected page range does not add a trailing blank sheet. `GetPrintHTML` validates the range and limits output to 128 MiB of page markup. The standalone `toPDF` exporter remains a separate headless layout path; use browser printing when matching the visible sheet geometry is essential.

The layout uses the browser's shaping, fonts and CSS column fragmentation, not Microsoft's layout engine. Section-dependent paper geometry, per-page dynamic footnote balancing, legacy Word compatibility switches, floating-object interactions and exact Word pagination still need additional implementation/qualification. Large mirrored/printed pages clone body content; mirror count is bounded but body-node work is not independent of document size. No pixel-identical Word compatibility claim is made.

## Equation model and renderer

```js
import {
  FlowDocument,
  Paragraph,
  Run,
  Equation,
  RichTextEngine,
} from "@wieslawsoltes/richtextweb/core";
import { renderEquation } from "@wieslawsoltes/richtextweb/equations";

const math = new Equation(
  String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
  "latex",
  true,
);
const document = new FlowDocument(new Paragraph([new Run("Result: "), math]));
const engine = new RichTextEngine(document);
engine.Select(document.Text.length);
const id = engine.InsertEquation(String.raw`\int_0^1 x^2\,dx`, "latex", false);
engine.UpdateEquation(id, "x^3", "latex", false);
const vector = renderEquation({
  Source: math.Source,
  Format: math.Format,
  DisplayMode: true,
});
```

`Equation` is an atomic inline object (one UTF-16 object-replacement position) with `Source`, `Format`, `DisplayMode` and `AlternativeText`. Equation changes use the same undo, formatting, model notifications, serialization and rich collaboration machinery as other nodes. `InsertEquation` returns the actual inserted model ID. `UpdateEquation` is one undoable operation. Core-only imports do not initialize the math renderer.

The renderer uses a privately bundled, pinned MathJax 3.2.2 TeX/MathML-to-SVG pipeline. It outputs self-contained vector paths, not downloaded font files. The public result includes SVG, presentation MathML, baseline depth and measured ex dimensions. Forty-two editable templates cover fractions, roots, scripts, accents, limits, sums, integrals, matrices, aligned systems, cases, statistics, physics, chemistry and symbols.

TeX inputs are limited to 16 KiB, with bounded macro expansion and isolated per-equation macros. Only explicitly selected packages are enabled. MathML is presentation-only with a strict element/attribute allowlist, node/depth limits and structural validation. HTML/actions/external-resource requests are rejected. Renderer cache entries are immutable and bounded. Unsupported input fails explicitly; imported unsupported Office math may be preserved as opaque markup by the DOCX importer instead of silently being called editable.

### Reusable visual equation control

```html
<rich-equation-editor id="math"></rich-equation-editor>
<rich-text-toolbar for="document" mode="all"></rich-text-toolbar>
<rich-text-page-editor id="document"></rich-text-page-editor>
```

```js
const workbench = document.querySelector("#math");
workbench.Value = {
  Source: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  Format: "latex",
};
workbench.addEventListener("equationchange", (event) =>
  console.log(event.detail.value),
);
workbench.addEventListener("validationchange", (event) =>
  console.log(event.detail.isValid),
);
```

`EquationEditor` provides a live vector preview, clickable symbols, accessible token selection, text replacement, structural wrapping, a template gallery, source editing, alternative text and independent undo/redo. Visual edits become editable MathML. `Validate()`, `IsValid`, `Error`, `RenderResult`, `SelectToken`, `ReplaceToken`, `InsertTemplate`, `Undo`, `Redo` and `Dispose` are public. The existing toolbar's Equation dialog uses this control, checks for stale/read-only targets and applies or cancels a single document edit. It is not a complete Word linear-math keyboard grammar or an exhaustive structural math editor.

```jsx
import { ReactEquationEditor, RichTextPagedEditor } from '@wieslawsoltes/richtextweb/react';
<ReactEquationEditor value={equation} onValueChange={setEquation} />
<RichTextPagedEditor document={document} documentView="PrintLayout"
  pageArrangement="Vertical" zoomMode="PageWidth" onPaginated={onLayout} />
```

Native hosts can use `ExecuteAsync("InsertEquation", new { Source = @"\frac{a}{b}", Format = "latex", DisplayMode = true })`. The bridge accepts equation nodes in document JSON and exposes `UpdateEquation` through a command parameter containing `Id` (or `ElementId`), `Source`, `Format` and `DisplayMode`. Host read-only/revision/size validation still applies.

## Interchange

HTML exports sanitized vector markup with exact source metadata. HTML MathML imports as equation nodes. Markdown recognizes inline `$...$` and display `$$...$$` while preserving ordinary currency text; MathML uses an inert HTML marker when no LaTeX source exists. Extended FlowDocument XAML serializes EquationSource/EquationFormat/DisplayMode as inert data. These equation elements are RichTextWeb extensions, not native WPF types.

DOCX exports native Office Math (`m:oMath`) structures rather than pictures, and imports common Office Math structures to editable MathML. A hash-bound RichTextWeb extension preserves exact original source for the library's own round-trip. Cross-application conversion can change advanced spacing, styling and unsupported structures. PDF export paints equation SVG paths as vectors; these paths are not searchable or fully accessibility-tagged math. Glyphs outside the renderer's outline coverage can require a different export route; unsupported path/text cases fail rather than silently dropping content.

## References

- MathJax SVG options: https://docs.mathjax.org/en/v3.2/options/output/svg.html
- MathJax TeX input options: https://docs.mathjax.org/en/v3.2/options/input/tex.html
- Open XML Office Math: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.officemath
- CSS fragmentation in multi-column layouts: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Multicol_layout/Handling_content_breaks

## Matrix and token authoring

`EquationEditor.EditMatrix(operation)` inserts/deletes rows and columns in the innermost selected matrix. Operations are `InsertRowBefore`, `InsertRowAfter`, `DeleteRow`, `InsertColumnBefore`, `InsertColumnAfter`, and `DeleteColumn`. Select a token within a cell first. `SelectedMatrix` reports its zero-based row/column, shape, and path. Regular unmerged matrices up to 32 × 32 cells are supported; the last row/column cannot be deleted. Existing cells and surrounding delimiters are preserved. New cells contain editable square placeholders.

`InsertToken(text, before)` and `DeleteToken()` add or remove symbols without violating fixed-arity fraction/script operands. All these edits participate in the workbench undo/redo stack; Apply remains one shared document edit. The pure functions `editEquationMatrix`, `equationMatrixAt`, `insertEquationToken`, and `deleteEquationToken` are also available through the equations entry point.

The source property follows input immediately; only vector rendering is debounced. `Validate()` validates the latest draft synchronously. Setting a new Value cancels pending validation. The format selector now converts common presentation MathML structures to TeX rather than rendering XML as TeX text. `mathMLToLaTeX` rejects unsupported structures such as padded expressions and labeled rows, retaining the original source. Conversion preserves supported mathematical structure but does not promise identical fine spacing/styling for every MathML attribute. Keep MathML for those documents.

With a toolbar attached, Alt+= opens the reusable equation workbench; a text selection becomes the initial equation source. Read-only hosts reject authoring. Multiple toolbars do not open duplicate dialogs.

## Navigation and page windows

The reusable page-navigation control includes a validated numeric page jump. `GetPageAtOffset(offset, backward)` returns the measured page using binary search; backward affinity selects the previous sheet at an exact boundary. Continuous views no longer intercept PageUp/PageDown as finite-page navigation. Enter and multiline paste clear inherited physical/column breaks on continuation paragraphs, and HTML now retains explicit column breaks.

`pagePreviewWindow` computes visible-first sheet realization using the actual viewport. Multiple-page layouts at small zoom no longer leave visible lower rows blank merely because overscan consumed an eight-sheet budget. The hard ceiling protects pathological host viewports; complete document body measurement and mirrored-body cloning remain document-size work.
