# RichTextWeb 0.5.0 — rich page stories and bounded page navigation

All recovered authoring/equation source is committed in main. This release builds on that recovered 0.4.0 baseline with [PR #19](https://github.com/wieslawsoltes/RichTextWeb/pull/19).

- **Rich header/footer authoring:** reuse RichTextBox/RichTextToolbar for isolated drafts containing formatted text, fields, equations, tables, images and links. Apply is one parent undo step; Cancel is non-mutating; stale same-story or replaced-document commits are rejected. Double-click a visible story or use default/first/even-page ribbon commands.
- **Shared page setup:** validate separate margins, page dimensions, column count/gaps, header/footer distances, page-number starts and variant flags before mutation. Keep document identity, selection, history and unrelated metadata. Expose the same command through core, controls and the existing native bridge.
- **Layout and interchange:** honor first/even flags and intentionally blank variants, page-number starts and story distances. WPF preferred/fixed ColumnWidth affects measured layout; DOCX exports matching column count/gap/right padding and native story flags.
- **Page-container performance:** Vertical and MultiplePages retain viewport/overscan slots plus the pinned live editor, not one placeholder per document page. Distant navigation preserves cached geometry and native selection. Full-body measurement and mirror cloning remain explicit limits.
- **Regression coverage:** 405 unit tests (26 new), 112 Chromium groups (seven new), installed ESM/CJS/TypeScript/browser consumers, real Windows WPF/WinUI/Avalonia hosts and Blazor .NET 8/10 consumers. The 500-page fixture checks bounded slots, visible page 480 and no layout recomputation on navigation.

```sh
npm install @wieslawsoltes/richtextweb@0.5.0
```

Npm and native adapter archives use 0.5.0. Blazor NuGet remains independently versioned; validating the current source does not republish its existing immutable package. Release CI verifies the exact deployed Pages commit and runs the browser suite against the live sample before npm publication, then verifies downloaded registry bytes/provenance.

**Complete Word/WPF parity remains unfinished.** This release does not establish Word-identical pagination, complete section/footnote/floating interactions, full finite-page incremental virtualization, exhaustive field/math/WPF semantics, universal Office/PDF interoperability, or physical/non-Windows qualification. The retained equation renderer and editing tools have the bounds documented in the authoring guide.

[Live Document Studio](https://wieslawsoltes.github.io/RichTextWeb/) · [Page-authoring APIs](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/PAGE-AUTHORING.md) · [Equations and views](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/AUTHORING.md) · [Verification](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/VERIFICATION.md) · [Compatibility](https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/COMPATIBILITY.md)
