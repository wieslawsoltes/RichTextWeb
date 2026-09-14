# Rich page stories and bounded page navigation

## Core commands and migration APIs

`RichTextEngine.SetPageSetup(options)` and `DocumentFeatures.SetPageSetup(options)` validate the complete resulting geometry before changing anything, apply one undo unit, keep the existing document/engine and body-node identities, and preserve the selection. `Execute("SetPageSetup", options)` works through the existing rich controls and native bridge; their read-only/revision guards remain in effect.

Options are `PageWidth`, `PageHeight`, `PagePadding`, `ColumnCount`, `ColumnGap`, `HeaderDistance`, `FooterDistance`, `PageNumberStart`, `DifferentFirstPage` and `DifferentOddAndEvenPages`. Only supplied properties change. Padding accepts a uniform number or an object with all four .NET `Left/Top/Right/Bottom` values; units are CSS pixels. Unknown properties and nonfinite or impossible measurements fail without changing content or history. Margins must fit the renderer's one-third-per-side limit, with at least 24 pixels per text column; columns are integers from 1 to 12. This strict command does not change the tolerant fallback policy for imported legacy properties.

```js
editor.Execute("SetPageSetup", {
  PagePadding: { Left: 48, Top: 72, Right: 48, Bottom: 64 },
  ColumnCount: 2,
  ColumnGap: 24,
  HeaderDistance: 16,
  FooterDistance: 16,
  DifferentFirstPage: true,
  DifferentOddAndEvenPages: true,
  PageNumberStart: 7,
});
```

For WPF-style direct model assignments, `ColumnWidth` now determines the number of columns when the RichTextWeb `ColumnCount` extension is not explicitly set. Flexible columns expand to use the content width. With `IsColumnWidthFlexible = false`, surplus horizontal space goes into the effective right padding. An explicitly supplied `ColumnCount` takes precedence. These properties work through effective styles as well as local values.

## Reusable rich header/footer editing

The toolbar's Header and Footer commands edit the story displayed on the current physical page. The first-page and even-page variants also have explicit ribbon commands. Double-clicking a rendered header/footer raises a cancellable `storyeditrequest` with `{ kind, pageNumber }`; the attached reusable toolbar handles it. Applications can handle it themselves instead.

The editing dialog uses an ordinary `RichTextBox`, a `RichTextToolbar`, and the shared engine. Existing runs, formatting, fields, images, tables and equations remain editable, rather than being flattened to plain text. The dialog offers field/equation/table/image/link insertion. Apply commits one parent history unit; Cancel does not mutate the parent. Concurrent changes to that same story, a replaced document or a read-only/retargeted host prevent stale commits. Unrelated body edits are allowed.

The core session API has no DOM requirement and can be used by React, MVVM or a custom host:

```js
import { DocumentStorySession } from "@wieslawsoltes/richtextweb/core";
const session = new DocumentStorySession(engine, "Headers");
session.Engine.Select(0);
session.Engine.InsertText("Revision copy — ");
// HasConflict compares only the selected story and the parent identity.
session.Apply(); // or session.Cancel()
```

Supported kinds are `Headers`, `Footers`, `FirstPageHeader`, `FirstPageFooter`, `EvenPageHeader` and `EvenPageFooter`. An optional third constructor argument scopes the session to a Section ID. Sessions are disposable and cannot apply twice. Session-local history is independent; the parent sees only the committed story. This is rich story-content editing, not simultaneous character-level coauthoring within header metadata or a full Word header/footer editing mode. Story-level review metadata is not exposed by this dialog.

Explicit `DifferentFirstPage` and `DifferentOddAndEvenPages` apply to both headers and footers. When enabled, a missing variant is intentionally blank, not substituted with the default. Explicit false retains but hides variant content. Absent flags preserve the legacy per-story presence-based browser behavior. DOCX emits and imports native `titlePg`/`evenAndOddHeaders` flags, including false values and omitted flags, independently of retained story references. PAGE fields in rendered stories use `PageNumberStart`; navigation continues to use physical page indexes. Header/footer distances now affect screen and measured-print placement.

## Page-slot virtualization

Vertical and MultiplePages arrangements now allocate only viewport/overscan slots plus the pinned live page, rather than one placeholder DOM element per document page. The sparse positioned page grid retains the overall scroll extent. Moving to a distant page realizes its slot before scrolling, does not rebuild the document, and reuses measured geometry. `PaginationStatistics.RealizedPageSlots` makes the bound observable; preview realization remains visible-first and capped at 128, plus at most one live slot.

This is **page-container virtualization**, not complete incremental document typesetting. The live body still measures all document content and mirrors still clone its body. Very large CSS scroll extents remain subject to browser limits. Use continuous block virtualization where complete finite-page measurement is too expensive. Per-section paper sizes, dynamic footnote balancing and exact Word pagination remain separate work.

## Tests and references

`tests/page-authoring.test.ts` covers core commands, invalid geometry, identity/history, native read-only dispatch, rich sessions/cancellation/conflicts, native DOCX flags and WPF column sizing. `tests/page-authoring.browser.mjs` covers real rich-story typing, modal validation, double-click editing, concurrent-update rejection, displayed stories/page numbers, and bounded navigation to page 480 in a 500-page fixture. Existing toolbar regressions now interact with the actual rich story control.

Primary behavior references:

- https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.flowdocument.columnwidth
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.flowdocument.iscolumnwidthflexible
- https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.titlepage
- https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.evenandoddheaders
