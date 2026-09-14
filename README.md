# RichTextWeb

Reusable rich-text engine, flow documents, browser controls, document formats and Blazor components.

[![npm](https://img.shields.io/npm/v/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![npm downloads](https://img.shields.io/npm/dm/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![NuGet](https://img.shields.io/nuget/v/RichTextWeb.Blazor)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![NuGet downloads](https://img.shields.io/nuget/dt/RichTextWeb.Blazor)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml)
[![Blazor CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml)

## JavaScript and desktop adapters

```sh
npm install @wieslawsoltes/richtextweb
```

The [complete original guide](README.web.md) preserves JavaScript/React/MVVM usage, desktop adapters, architecture, tests, compatibility matrices and licensing. [Open the web demo](https://wieslawsoltes.github.io/RichTextWeb/).

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
dotnet add package RichTextWeb.Blazor --version 0.4.1
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
