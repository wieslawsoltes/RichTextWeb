# RichTextWeb

Reusable rich-text engine, flow documents, browser controls, document formats and Blazor components.

[![npm](https://img.shields.io/npm/v/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![npm downloads](https://img.shields.io/npm/dm/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![RichTextWeb.Blazor on NuGet](https://img.shields.io/nuget/v/RichTextWeb.Blazor?label=RichTextWeb.Blazor&logo=nuget)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![NuGet downloads](https://img.shields.io/nuget/dt/RichTextWeb.Blazor)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml)
[![Blazor CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml)

## JavaScript and desktop adapters

```sh
npm install @wieslawsoltes/richtextweb
```

The [complete original guide](README.web.md) preserves JavaScript/React/MVVM usage, desktop adapters, architecture, tests, compatibility matrices and licensing. [Open the web demo](https://wieslawsoltes.github.io/RichTextWeb/).

## Fillable content controls — source, unreleased

RichTextWeb now has inline and block **rich text, plain text, checkbox, dropdown, combo and date content controls**. The standalone engine owns typed values, tags, placeholders, independent editing/deletion locks, atomic form filling and undo. Native DOCX SDTs preserve supported controls without depending on private RichTextWeb metadata. Unsupported native control properties produce explicit import diagnostics.

The reusable toolbar adds insertion, properties, value editing, isolated rich drafts, form-data inspection/filling and required-value checks. Document Studio's **Fillable project brief** template and Developer ribbon use the same APIs. [Content-control APIs, native interchange and limits](docs/CONTENT-CONTROLS.md) · [Updated complete feature audit](docs/WORD-FEATURE-AUDIT.md).

This does not implement every Word form feature or a security boundary: picture/repeating/building-block controls, custom XML binding, legacy forms and restricted-editing permissions remain. Required/maximum-length rules are local application metadata. Source/package versions are unchanged.

## Connected document themes — source, unreleased

The engine now retains live twelve-color palettes, semantic color mappings, Latin heading/body font roles, and symbolic style/direct-format links. Theme edits are undoable; fixed literal formatting is preserved. Shared theme preview/customization and selection pickers are available in the Design ribbon; named-style links remain in Home → Manage styles. Choose **Connected document themes** to change the report palette and heading font while keeping its direct violet brand color.

Native DOCX retains supported theme parts, mappings, font/color/shading references and fallbacks. Theme/settings/relationship fingerprints reject stale private snapshots after relevant native-part edits. [Theme APIs and explicit limits](docs/DOCUMENT-THEMES.md) · [Complete feature audit](docs/WORD-FEATURE-AUDIT.md). This is text theming, not full Office script-font, drawing/effects, table-style or native visual equivalence. Version remains 0.5.0; no new package release is implied.

## Named document styles — source, unreleased

The shared engine now supports named paragraph and character styles, based-on/default/following-paragraph roles, live definition updates, direct-format preservation, selection-based creation/update and safe deletion with replacement. The toolbar has a reusable style manager; Document Studio's Home ribbon, preset gallery and document catalog use the same APIs. Choose **Named document styles** to exercise the live sample.

Supported native DOCX style definitions/references remain editable without the private extension. Style-only external edits invalidate stale private snapshots. Named headings feed outline/contents generation; story drafts share definitions and reject conflicting catalog changes. [API examples and explicit limits](docs/DOCUMENT-STYLES.md) · [Full capability audit](docs/WORD-FEATURE-AUDIT.md). This is a supported paragraph/character subset, not complete Word themes, table/list/linked styles or native typography parity. Version remains 0.5.0; no new package publication is implied.

## Word authoring extension — source, unreleased

The core engine and reusable controls now include bounded table formulas with 18 functions and table/range dependencies; stable three-key rich table sorting; repeat-header authoring; numbered captions, bookmark cross-references and tables of figures/tables; expanded native fields, field editing/locking/unlinking, document properties/variables and Unicode word/selection statistics. Native DOCX tests exercise these without relying on the private RichTextWeb extension. Field cache loss, embedded-object offsets and typing at field/caption boundaries are also fixed.

Document Studio exposes the shared commands through References, Table layout and Review. Its **automation** template contains a calculated estimate, budget approval, caption, reference and list of tables. The additions remain in source until a subsequent package release; the version remains 0.5.0.

The continuation fixes field-update selection boundaries and caption bookmark containment. Update fields/F9 now resolves supported forward cross-references and bookmarked formula dependencies in one pass, with cycle/expansion diagnostics and locked-cache handling. Headless callers opt in with `features.UpdateFields({ ReferenceMode: "Current" })`; the existing snapshot mode remains available. The automation sample includes a formula-linked total and a live IF approval condition comparing native bookmarks. Conditional fields resolve bookmark operands and support omitted false text.

[Authoring API examples and supported limits](docs/WORD-AUTHORING.md) · [Full engine/control feature audit and prioritized remaining work](docs/WORD-FEATURE-AUDIT.md). The audit distinguishes implemented behavior from preservation and unqualified fidelity, rather than claiming complete Word parity. Reproduce its declaration inventory with `node scripts/audit-word-features.mjs > feature-inventory.json`.

## Rich page authoring — 0.5.0

Headers and footers now use the existing rich controls rather than plain-text forms: formatting, fields, tables, images and equations stay editable. Default, first-page and even-page stories have ribbon commands and double-click editing. The DOM-independent `DocumentStorySession` supports isolated drafts, cancel, conflict detection and a single parent undo step.

`SetPageSetup` validates margins, column count/gap, story distances, page numbering and variant flags before any mutation. WPF-style `ColumnWidth` and `IsColumnWidthFlexible` now affect measured columns; native DOCX preserves the resulting geometry. Vertical and MultiplePages views keep only viewport/overscan page containers plus the live page, instead of a placeholder per document page. The complete body is still measured; this is not full incremental typesetting virtualization.

```js
editor.Execute("SetPageSetup", {
  PagePadding: { Left: 48, Top: 72, Right: 48, Bottom: 64 },
  ColumnCount: 2,
  ColumnGap: 24,
  PageNumberStart: 7,
  DifferentFirstPage: true,
  DifferentOddAndEvenPages: true,
});
```

[Page-authoring APIs and supported limits](docs/PAGE-AUTHORING.md) · [PR #19](https://github.com/wieslawsoltes/RichTextWeb/pull/19). The feature candidate passed 404 unit tests and 112 Chromium groups plus native/Blazor qualification; the release adds a native DOCX column-geometry regression (405 tests). See the [verification report](docs/VERIFICATION.md) and release-commit CI for exact evidence.

## Paginated authoring and equations — 0.4.0

The recovered implementation is committed as actual source in [PR #15](https://github.com/wieslawsoltes/RichTextWeb/pull/15). [PR #16](https://github.com/wieslawsoltes/RichTextWeb/pull/16) adds structural equation editing and fixes page navigation, column-break continuation, equation draft conversion and immediate dialog reopening.

`RichTextPageEditor` supports Print Layout, Web Layout, Read Mode, Outline and Draft; single-page, two-page, vertical and multiple-page arrangements; page-width/whole-page fitting; physical page and column breaks; cached measurements; and printing of measured page ranges. The sample exposes these through the View ribbon and status bar.

`Equation` nodes retain editable LaTeX or presentation MathML and render to self-contained SVG. The reusable equation workbench includes 42 templates, token editing, fraction/root/script tools, matrix rows/columns, format conversion, alternative text and undo/redo. Insert/Edit Equation and Alt+= use the same toolbar and engine commands. Supported equations round-trip through native DOCX Office Math and export to vector PDF.

```html
<rich-text-toolbar for="document"></rich-text-toolbar>
<rich-text-page-editor
  id="document"
  document-view="PrintLayout"
  page-arrangement="Vertical"
  zoom-mode="PageWidth"
></rich-text-page-editor>
```

```js
import {
  registerRichTextWeb,
  registerRichTextToolbar,
} from "@wieslawsoltes/richtextweb/web";
registerRichTextWeb();
registerRichTextToolbar();
const editor = document.querySelector("#document");
editor.Engine.InsertEquation(
  String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
  "latex",
  true,
);
```

See [authoring/equation APIs](docs/AUTHORING.md), [verified coverage](docs/VERIFICATION.md), and the [compatibility matrix](docs/COMPATIBILITY.md). Browser pagination is not Word-identical, finite-page layout still measures the complete document, and Word/WPF/math semantics are not exhaustive. The release candidate passed 379 unit tests and 105 Chromium groups, plus installed-package, Windows desktop and Blazor consumer checks.

## Blazor

```sh
dotnet add package RichTextWeb.Blazor --version 0.4.2
```

The .NET 8/.NET 10 RCL supports interactive WebAssembly and Server, with locally packaged native rich-text/PDF assets and worker. It includes `RichTextEditor`, `RichTextPageEditor`, read-only flow viewers, `RichTextInput` with EditForm integration, format services and `PdfEditor`. Consumers need neither npm nor a CDN; fonts are not implicitly downloaded.

```razor
@using RichTextWeb.Blazor
<RichTextEditor @bind-Value="html" ValueFormat="html" Theme="light" />
@code {
    private string? html = "<p>Edit this document.</p>";
}
```

See the [Blazor guide](blazor/README.md), [integration contract](blazor/INTEGRATION.md), [sample](blazor/sample/Demo.razor) and [release notes](blazor/RELEASE.md). Typed APIs are complemented by native object/function interop. Underlying document/pagination/PDF/collaboration compatibility limits remain unchanged; this package is not an exhaustive C# desktop-framework port.

```sh
git submodule update --init --recursive
npm ci
npm run build
node blazor/build.mjs
dotnet run --project blazor/sample/Sample.csproj
# Or: dotnet run --project blazor/server/Server.csproj
```

Source builds require the .NET 10 SDK with .NET 8 targeting support. The Server sample uses `/probe/`. CI tests actual NuGet consumers on both frameworks/hosts, including EditForm field notifications, full binding values, pagination, DOCX/PDF output, PDF search/view switching, streams, Razor callbacks and remounting.

NuGet versions are independent of npm in `blazor/Version.props`. Version-changing main merges publish after validation using `NUGET_API_KEY` (`NUGET_TOKEN`/`NUGET_KEY` aliases), verify public package payloads and create `blazor-v*` releases with symbols, samples and checksums. See [LICENSE](LICENSE), [NOTICE](NOTICE) and native compatibility documentation in the original guide.
