# Folio — native Avalonia WYSIWYG editor

**0.1.0-preview.1. This is an engineering preview, not a complete production-ready word processor.** The implementation uses native Avalonia text layout and drawing, not a WebView or HTML `contenteditable` element. Desktop and WebAssembly share the same control and sample UI.

Work is isolated in `native/AvaloniaWysiwyg/` on `feat/native-avalonia-wysiwyg`. The surrounding RichTextWeb TypeScript library is not a dependency of these projects. See draft PR #36 for the exact validation status and remaining work.

## Projects

| Project | Responsibility |
| --- | --- |
| `src/Wysiwyg.Core` | Immutable document model, Unicode-aware editing, selection, formatting, history, tables, annotations, search and replacement. No Avalonia dependency. |
| `src/Wysiwyg.Formats` | Native JSON persistence; constrained, sanitized HTML and Markdown interchange. |
| `src/Wysiwyg.Avalonia` | `Wysiwyg.Controls.WysiwygEditor`, replaceable control theme, native drawing surface, input and clipboard integration. |
| `samples/Folio.Sample` | Shared native workspace, outline, properties, review panel and host-injected persistence. |
| `samples/Folio.Desktop` | Desktop application using Avalonia's platform backend. |
| `samples/Folio.Browser` | .NET WebAssembly application using Avalonia.Browser. |
| `tests/Wysiwyg.Core.Tests` | Executable regression suite, randomized editing invariants and an engine-only large-document check. |

## Build

Pinned toolchain: .NET SDK **10.0.402**, Avalonia **12.1.3**. Run commands from this directory.

```sh
dotnet run --project tests/Wysiwyg.Core.Tests -c Release
dotnet build samples/Folio.Desktop -c Release
dotnet run --project samples/Folio.Desktop -c Release

dotnet workload install wasm-tools
dotnet publish samples/Folio.Browser -c Release -o artifacts/browser
```

Serve the generated browser bundle over HTTP; do not open `index.html` with a `file:` URL. The web root is the generated directory containing both `index.html` and `_framework/dotnet.js`. The browser host must serve `.wasm` files as `application/wasm`. The sample uses a single-threaded WebAssembly runtime and does not require shared-memory support. Use HTTPS or localhost for clipboard capabilities.

The browser sample intentionally disables trimming and enables reflection-based JSON serialization. AOT, trimming and startup/download optimization require additional validation before enabling them.

## Use the control

Add a project reference to `src/Wysiwyg.Avalonia/Wysiwyg.Avalonia.csproj`, or pack the three library projects locally. These preview packages have not been published to NuGet.

Load the theme after your application theme:

```xml
<Application.Styles>
  <FluentTheme />
  <StyleInclude Source="avares://Wysiwyg.Avalonia/Themes/Generic.axaml" />
</Application.Styles>
```

The control namespace is `Wysiwyg.Controls`:

```xml
<UserControl xmlns="https://github.com/avaloniaui"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             xmlns:editor="using:Wysiwyg.Controls">
  <editor:WysiwygEditor x:Name="Editor"
                        Document="{Binding Document, Mode=TwoWay}"
                        IsReadOnly="{Binding IsReadOnly}"
                        ShowToolbar="True"
                        ShowStatusBar="True"
                        PageWidth="794"
                        PagePadding="64"
                        Zoom="1" />
</UserControl>
```

`Document` uses immutable snapshots. View models should implement ordinary property-change notification and retain the replacement snapshot supplied by the two-way binding. Perform control and session mutations on the owning UI thread.

```csharp
using Wysiwyg.Core;
using Wysiwyg.Formats;

Editor.Session.Load(RichDocument.FromText("Hello, world!", "My document"));
Editor.Session.SetSelection(0, 5);
Editor.Session.ToggleBold();
Editor.Session.AddComment("Check the opening.", "Reviewer");

string json = DocumentFormats.ToJson(Editor.Session.Document);
RichDocument restored = DocumentFormats.FromJson(json);
Editor.Session.Load(restored);
Editor.Session.MarkSaved();
```

`Session.Load` is an explicit host operation: it validates the replacement document, resets selection/history and marks the document saved. Read-only mode gates interactive mutations and undo/redo; it does not prevent the application from loading another document. Set the control's `IsReadOnly` property rather than modifying the session's corresponding property independently.

The reusable control does not choose storage locations or make network requests. The sample injects host persistence through `SampleServices`: atomic temporary-file replacement on desktop, and device-local `localStorage` in the browser. Browser quota failures are reported in the status area; explicit native-file export remains separate from autosave.

## Templating contract

`WysiwygEditor` derives from `TemplatedControl`. All chrome is in `Themes/Generic.axaml`. Its session, commands and document state are independent of the template.

| Part | Type | Purpose |
| --- | --- | --- |
| `PART_Surface` | `DocumentSurface` | Editable native document surface. Required for visual editing. |
| `PART_ScrollViewer` | `ScrollViewer` | Scrolling and viewport/fit-width integration. |
| `PART_SearchBox` | `TextBox` | Optional focus target for the search command. |

Toolbar, search and status chrome can be replaced or omitted. If the surface part is absent, document commands remain available but the control cannot display/edit the document visually. The default template exposes additional named buttons for host UI testing; they are not required by the control.

Useful properties include `Document`, `IsReadOnly`, `Zoom`, `PageWidth`, `PagePadding`, `PaperBrush`, `PaperForeground`, `SelectionBrush`, `SearchText`, `ReplacementText`, `MatchCase`, `WholeWord`, `SearchVisible`, `SelectedBlockId` and the formatting/status properties. `DocumentChanged`, `SelectionChanged` and `OperationFailed` are available to hosts.

The `Command` property accepts string command parameters. Examples: `Undo`, `Redo`, `Bold`, `Italic`, `Underline`, `Strike`, `Body`, `H1`, `H2`, `H3`, `Bullet`, `Numbered`, `Check`, `Left`, `Center`, `Right`, `Justify`, `Indent`, `Outdent`, `Quote`, `Code`, `Table`, `AddRow`, `DeleteRow`, `AddColumn`, `DeleteColumn`, `Rule`, `Copy`, `Cut`, `Paste`, `Search`, `NextMatch`, `PreviousMatch`, `Replace`, `ReplaceAll`, `ZoomIn`, `ZoomOut`, `Fit` and `DeleteBlock`. Image insertion, links, annotations and richer formatting are also exposed through `Session` APIs.

## Implemented source features

- Styled text runs: bold, italic, underline, strike, font family/size, foreground/highlight, inline code, subscript/superscript and restricted hyperlink metadata.
- Paragraphs: headings, alignment, indentation, line/paragraph spacing, quotes, code blocks, bullets, numbered lists, checklists, soft breaks and explicit right-to-left direction.
- Editing: pointer selection, keyboard navigation, grapheme-safe deletion, grouped typing history, undo/redo with selection restoration, read-only command gating and IME/preedit integration hooks.
- Structures: rectangular tables with row/column insertion and deletion, cell shading and relative column widths; embedded raster images with selection, proportional resize-on-release and deletion; horizontal rules.
- Review: text-range comments, resolve/reopen/delete, anchor updates during text edits and orphan markers for fully deleted anchors.
- Search: case/whole-word options, wrapped navigation, bounded regular expressions through the engine API, and atomic replace-all. Replacement text is literal even when regex search is enabled.
- Workspace: outline navigation, formatting inspector, light/dark application chrome, zoom, local drafts, file pickers and exports.

These are implemented features, not a claim that every feature has passed desktop or browser interaction testing. Consult CI evidence in the PR.

## Document semantics and bounds

Text positions are UTF-16 offsets. One LF separates every editable leaf, including table cells. Embedded objects are block objects and do not occupy text offsets. Selection endpoints snap to grapheme boundaries. Paragraph runs use U+2028 for soft breaks and cannot contain LF/CR/NUL.

Cross-cell text deletion preserves the rectangular table grid; removing a table, row or column is a separate structural operation. Clipboard selection currently flattens selected cells into paragraph fragments rather than preserving a table grid. Native rich clipboard data and plain text are implemented; HTML clipboard interoperability is not.

Default import/model limits are 10,000 blocks, 2,000,000 characters, 100,000 characters per paragraph, 200,000 runs, 100 rows by 20 columns per table, 2,000 comments, 8 MiB per embedded image, 24 MiB total embedded images and 40 MiB serialized input. Raster headers are checked before native decoding, with a maximum of 8,192 pixels per side and 16 million pixels total. History is bounded by entry count and an estimated retained-byte budget, not an exact allocator-memory cap.

Documents and paragraph runs are immutable. Retained native text layouts are reused for unchanged paragraphs; drawing is culled to the viewport. Initial layout still formats the document's paragraphs, and the cache is not a fully lazy virtualized document engine. The 10,000-paragraph engine test is not a 10,000-paragraph browser-rendering benchmark.

## Formats and security

Native `.folio` JSON is the intended lossless format, including comments and stable IDs. Unknown schema versions, malformed structures, invalid Unicode, duplicate IDs and invalid style values are rejected before a document is loaded.

HTML and Markdown are constrained interchange formats, not browser/Word layout equivalence. HTML is parsed without resource loading and exported through explicit escaping and allowlisted structure/style handling. Scripts, forms, SVG, MathML and embedded active content are removed. Links are restricted to absolute HTTP, HTTPS and mailto URLs. Remote images are not fetched; supported embedded raster formats are PNG, JPEG, GIF and WebP. `AngleSharp` is pinned to 1.8.4. Markdown input disables raw HTML before conversion to the constrained document model.

Import warnings are returned to the caller. Merged/nested table semantics are flattened or rejected rather than represented faithfully. Comments are retained in native JSON, not HTML/Markdown. Numbered-list grouping and checklist HTML round-trip behavior still require correction/regression coverage. Do not treat the HTML importer as a general-purpose sanitizer for unrelated web applications.

## Validation and remaining work

The current core suite has **46 passing cases**, including a deterministic 1,000-operation randomized editing check. The corrected native desktop sample compiles. See the PR's subsequent CI records for browser publication results.

A platform safety-status block prevented publication of the subsequent browser-interaction test update. **Actual browser interaction, rendering screenshots, IME behavior, clipboard round-tripping and accessibility have not been validated.** A successful WebAssembly publish is not evidence that these runtime behaviors work.

Known release blockers and missing advanced functionality:

- Review comment anchors after structural table edits, HTML list interchange and clipboard compatibility.
- Finish browser interaction tests, format/security regression tests and visual inspection; verify template replacement and host binding behavior at runtime.
- The paper view is continuous. True pagination, headers/footers, page numbering and native print/PDF output are not implemented; the page-break property currently adds visual separation rather than implementing pagination.
- No tracked changes, collaborative synchronization, spellchecking, DOCX/RTF import/export, embedded equations, table-cell merging, floating image layout, image cropping or full screen-reader rich-text range patterns.
- No claim of full Microsoft Word/editor-suite feature parity or production readiness.
- Remove the temporary branch-scoped source-correction workflow and repair/verify source-archive packaging before merging the draft PR.
