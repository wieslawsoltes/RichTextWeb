# Changelog

## 0.5.0

- Replace flattening header/footer forms with reusable rich-text controls; preserve formatting, fields, tables, images and equations. Add first/even-page ribbon commands and double-click editing of rendered stories.
- Add DOM-independent DocumentStorySession with isolated drafts/history, cancel, same-story conflict detection, optional Section scoping and a single parent undo operation.
- Add validated SetPageSetup commands with per-side margins, columns/gaps, story distances, page-number starts and variant flags, without resetting unrelated state.
- Honor native first/even-page switches, intentional blank variants, and header/footer distances in screen/print and DOCX.
- Support WPF preferred/fixed ColumnWidth semantics and export measured column counts/gaps/right padding to DOCX.
- Virtualize page container slots in Vertical/MultiplePages, pin the live editor, and retain cached geometry during distant navigation. Full-body measurement/mirror costs remain documented.
- Add 26 unit regressions and seven real-browser groups, including rich story typing and navigation to page 480 of a 500-page fixture.
- Version npm and native archives as 0.5.0; retain the independently versioned Blazor package. Continue exact-commit Pages, native and installed-package release gates.

## 0.4.0

- Recover and commit the complete paginated authoring/equation implementation as ordinary source, tests, adapters and sample files (PR #15).
- Add Print Layout, Web Layout, Read Mode, Outline and Draft; single/two/vertical/multiple-page arrangements; viewport-aware fitting, numeric navigation and cached geometry.
- Align physical page breaks across columns, stop column breaks leaking into continuation paragraphs, retain continuous-view keyboard scrolling and print measured page ranges without a trailing blank sheet.
- Add atomic Equation nodes with editable LaTeX/MathML, bounded private MathJax SVG rendering, 42 templates, native Office Math interchange and vector PDF export.
- Extend the reusable equation workbench with token insertion/deletion, matrix row/column editing, immutable structural APIs, safe bidirectional format switching, immediate draft values and Alt+= integration.
- Isolate each toolbar dialog session so queued close events cannot dispose a newly opened workbench (PR #16).
- Prioritize visible sheets before overscan and use binary page-offset lookup; retain explicit bounds instead of claiming full finite-page virtualization.
- Polish sample page/view controls, paper settings, panel overflow, responsive layouts and equation/pagination examples; keep actions in shared controls and engine APIs.
- Add deployment version/commit metadata and a post-deployment browser gate before npm publication.
- Validate 379 unit tests and 105 Chromium groups, installed ESM/CJS/TypeScript/browser consumers, Windows WPF/WinUI/Avalonia runtimes and Blazor .NET 8/10 consumers. Native adapter archives use 0.4.0; the independently versioned public Blazor package is unchanged.

See [authoring](docs/AUTHORING.md) and [compatibility](docs/COMPATIBILITY.md) for supported structures and the remaining Word/WPF layout, semantic and runtime boundaries.

## 0.3.0

- Editable finite-page control with page/column navigation, floating Figure/Floater rich stories, anchored images and move/resize handles.
- Opt-in continuous block virtualization, offscreen selection materialization and composition-safe editing.
- Expanded WPF-style property metadata, owner registration, inheritance, coercion, read-only keys, styles/triggers and value-source inspection.
- Tracked formatting, rich text/block moves and table/list structural revisions, conflict-aware rejection and merged-cell operations.
- Protocol-2 rich coauthoring for blocks, tables, objects, properties and annotations, with causal delivery, snapshots and acknowledged checkpoints.
- Original PDF text-showing operator inspection, replacement and removal with font encoding, preserved text advance and isolated shared Form edits, available in the reusable PDF control.
- Native DOCX formatting/move/table revisions and anchored text-box stories; safe HTML/XAML floating-story interchange.
- Word-style sample using RibbonWeb, Dockyard, TreeDataGridWeb, DynamicDataWeb, ReactiveWeb, RBushWeb and QuikGraphWeb through reusable editor controls.
- Executable WinUI/Avalonia smoke applications, shared local asset server, Windows runtime gates and packaged native samples.
- Updated dependencies, installed-consumer coverage and expanded real-browser regressions.

See the compatibility matrix for precise pagination, property-system, revision, coauthoring, PDF-encoding and native-platform boundaries.

## 0.2.0

- Live text positions with insertion gravity, snapshots, structural symbols and WPF-style context traversal.
- Reversible patch history, compact retained text deltas and stable model object identity through undo/redo.
- Authored tracked insertions/deletions, rich deletion restoration and accept/reject commands.
- Causal text collaboration with concurrent editing, formatting, snapshots and reusable engine bindings.
- Keyed browser rendering and measured finite-page viewing, navigation, page ranges, keep rules and overflow diagnostics.
- Default/first/even headers and footers, notes, fields, TOC generation, page references and mail merge.
- Native DOCX stories, fields, notes, TOC, comments/replies/bookmarks/revisions and safe opaque Office drawing dependencies.
- Reusable rich-text toolbar with formatting, insertion, layout and review dialogs; expanded sample and local coauthoring demonstration.
- Optional PDF.js import/preview/search module and reusable PDF control with overlays/history, editable text reconstruction and new PDF export.
- Buildable C# native projects, executable C#/Node protocol checks, Windows WPF/WebView2 qualification, packaged native sample and NuGet artifacts.
- Extended validated bridge operations for document features and review; optional PDF assets and all new package subpaths verified in installed consumers.

The compatibility matrix records remaining Word/WPF, native runtime, layout, rich-structure collaboration and original-PDF editing boundaries.

## 0.1.0

Initial RichTextWeb release:

- Shared document tree, .NET-style elements/collections/dependency properties/events and UTF-16 positions.
- Model-backed rich editing, structured operations, history, search, comments, bookmarks and table edits.
- RichTextBox custom element and document viewers with clipboard, IME reconciliation and keyboard editing.
- Safe HTML, Markdown, XAML, RTF, DOCX, selectable PDF and PDF page/overlay APIs.
- MVVM, React, validated WebView protocol and C# native-host source adapters.
- Document Studio sample, light/dark UI, source editing, PDF workspace, import/export and local persistence.
- ESM/CommonJS/declarations/standalone bundles, tested npm tarball consumers, GitHub Pages and release automation.

Full Word/WPF and file-format parity is not claimed. See docs/COMPATIBILITY.md.
