# RichTextWeb 0.4.0 — paginated authoring and equations

The complete recovered implementation is committed as actual source (PR #15), followed by tested authoring/performance fixes and structural equation editing (PR #16).

- **Views and pagination:** Print Layout, Web Layout, Read Mode, Outline and Draft; single/two/vertical/multiple-page arrangements; automatic page fitting, numbered-page navigation, cached measurement and visible-first sheet realization. Physical page breaks skip remaining columns; column breaks no longer carry into continuation paragraphs. Browser printing uses measured sheets and selected page ranges.
- **Equations:** editable atomic LaTeX/MathML nodes, self-contained MathJax SVG rendering, 42 templates, native Office Math DOCX interchange and vector PDF export. The reusable equation workbench adds token insertion/deletion, matrix row/column tools, safe format conversion, alternative text and undo/redo. Alt+= and Insert/Edit Equation route through the existing shared toolbar.
- **Editing reliability:** source values follow typing immediately while previews are deferred. Unsupported format conversion preserves the draft. Independent toolbar dialog lifetimes prevent a previous close event from disposing a newly opened workbench.
- **Sample and reuse:** page/view selectors, equation/pagination examples, corrected paper/paragraph settings, responsive panels, light/dark layouts and the existing seven-library Word-style workspace. Functionality is in the core/control packages rather than sample-only implementations; React/MVVM/native integrations use those APIs.
- **Distribution:** versioned native adapter archives, npm ESM/CJS/types/standalone bundles, source/sample archives and checksums. A post-deployment gate checks the exact Pages commit and exercises the public sample before npm publication. The separate Blazor NuGet version is unchanged.

```sh
npm install @wieslawsoltes/richtextweb@0.4.0
```

The release candidate passed **379 unit tests**, **105 Chromium groups** on Node 22/24, installed package consumers, real Windows WPF/WinUI/Avalonia hosts and Blazor .NET 8/10 WebAssembly/Server consumers. Release CI repeats those gates; the live Pages gate and npm registry-byte/provenance verification record publication results.

**Complete Word/WPF parity is not claimed.** Remaining boundaries include Word-identical pagination, complex section/footnote/floating interactions, exhaustive WPF and Word math/field semantics, fully virtualized finite-page layout, universal Office/PDF interchange and physical/non-Windows qualification. Matrix editing supports rectangular non-spanning matrices up to 32 by 32; unsupported structures are rejected without mutation.

[Open Document Studio](https://wieslawsoltes.github.io/RichTextWeb/) · [Authoring and equation APIs](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/AUTHORING.md) · [Verification](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/VERIFICATION.md) · [Compatibility](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/COMPATIBILITY.md)
