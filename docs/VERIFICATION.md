# Verification and measured performance

## Named styles continuation (source, unreleased)

Based on the 576-test forms merge `ada9116`, the named-style increment adds 56 Node regressions (632 total) and eight Chromium groups (141 full-suite groups). Local typecheck, library/demo builds and Node tests pass. Local browser navigation is blocked with `ERR_BLOCKED_BY_ADMINISTRATOR`; the feature PR's normal Node 22/24, installed-consumer, native Windows and Blazor CI must qualify the exact committed source. Test presence is not an executed browser pass. No new package version or Word desktop visual/open-save verification is claimed.

New checks cover inheritance/defaults/next styles, direct overrides, typing, bounds, atomic mutation/undo/review, native XML without private metadata, external styles-only changes, import warnings, story conflicts and sequential collaboration. Browser groups exercise the reusable manager, rendering, mobile dialogs, read-only/stale guards and the actual Home-ribbon sample. Details: [DOCUMENT-STYLES.md](DOCUMENT-STYLES.md).

## Release 0.5.0 qualification

[PR #19](https://github.com/wieslawsoltes/RichTextWeb/pull/19) passed **404 unit tests and 112 Chromium groups** on Node 22/24 in [CI run 34882583486](https://github.com/wieslawsoltes/RichTextWeb/actions/runs/34882583486). The run also passed installed-package checks, the shared C# protocol suite and real WPF/WinUI/Avalonia Windows applications. [Blazor run 34882583978](https://github.com/wieslawsoltes/RichTextWeb/actions/runs/34882583978) passed .NET 8/10 WebAssembly and Server package consumers.

The release adds a native DOCX geometry regression (**405 unit tests**) and aligns exported column count/gap with the browser's preferred/fixed column calculation. Build, TypeScript and unit tests pass locally. The release PR and merged release commit repeat all CI gates; publication additionally requires exact-commit live Pages checks and downloaded npm-tarball verification. Local browser navigation remains restricted, so Chromium/native runtime evidence comes from CI rather than a claimed local browser pass.

New regressions preserve formatting/fields/equations during actual rich-header typing, verify one parent undo step and non-mutating cancel, reject conflicting footer changes, double-click the rendered page story, validate per-side margins and impossible columns in the modal, and check first/even flags, page-number starts, header distances and fixed-width columns. A 500-page fixture requires fewer than 40 page slots, navigates to page 480, verifies the live page is visible with no blank realized neighbors, and checks that navigation does not remeasure the body. Native DOCX tests inspect `w:cols`, margins and first/even-page flags rather than only library metadata.

The 0.4.0 baseline was already fully recovered, committed and published. The remaining boundaries in [COMPATIBILITY.md](COMPATIBILITY.md) and [PAGE-AUTHORING.md](PAGE-AUTHORING.md) still apply: bounded page-container DOM is not a claim of a fully virtualized layout engine, and exact Word pagination remains unqualified.

## Release 0.4.0 qualification

The authoring implementation in [PR #16](https://github.com/wieslawsoltes/RichTextWeb/pull/16), following complete source recovery in [PR #15](https://github.com/wieslawsoltes/RichTextWeb/pull/15), passed **379 unit tests and 105 Chromium check groups** on both Node 22 and 24 in [CI run 34835483979](https://github.com/wieslawsoltes/RichTextWeb/actions/runs/34835483979). The same run passed installed-package checks, the shared C# protocol suite and actual WPF/WinUI/Avalonia applications on Windows. [Blazor run 34835484495](https://github.com/wieslawsoltes/RichTextWeb/actions/runs/34835484495) passed .NET 8 and .NET 10 package consumers in WebAssembly and Server hosting.

These are checked-commit results. The release PR and merged release commit repeat qualification; read that commit's workflow result before attributing a later change to these results. Chromium was 153.0.8010.12 in the captured report. No local browser pass is claimed: the local environment blocks navigation, so browser and desktop runtime evidence comes from GitHub runners.

## What is exercised

Model/engine suites cover ownership, dependency-property semantics, live/snapshot/symbol positions, Unicode editing, patches/history, observer failures, formatting/move/structural review, merged-cell operations, coauthoring, MVVM/React/bridge, fields/stories/notes/mail merge, formats and PDF operators.

Equation suites cover safe TeX/MathML vector rendering, templates, native Office Math conversion, vector PDF paths, atomic model positions, source validation, rectangular matrix edits, fixed-arity token edits, format conversion, draft preservation, history and read-only behavior. Unsupported conversion must fail without losing the original source.

Real browser checks cover physical page versus column breaks in one/two/three-column documents, all five document views, all four page arrangements, viewport fitting, selection-preserving cache reuse and caret editing. Browser-generated PDFs are parsed independently to compare page counts with measured sheets and selected page ranges. Small-zoom multi-page fixtures require every visible sheet to be realized before overscan, and numeric navigation goes directly to a selected sheet.

The reusable math dialog tests insert/edit/apply/cancel equations, edit matrix rows and columns, convert MathML back to LaTeX, preserve immediate source drafts, and invoke Alt+=. A regression closes and reopens equation dialogs five times in one task; delayed close events must dispose only retired workbenches, never the active editor. The original failing interaction is retained in the suite.

Browser regressions also exercise native typing, caret/selection, clipboard sanitation and stale asynchronous cut rejection, composition reconciliation, read-only guards, retained DOM identity, floating stories/handles and React Strict Mode. A 3,000-paragraph continuous virtualization fixture verifies fewer than 60 realized paragraph elements and distant edit/undo. Rich coauthoring uses paused/reversed delivery and acknowledged checkpoints.

The sample instantiates all seven requested ecosystem libraries, routes ribbon/toolbar commands to the shared engine, filters a real TreeDataGrid, docks/floats the actual editor without losing history, traverses QuikGraph references, queries RBush bounds and inspects/rejects tracked formatting. Captured desktop, dark and mobile layouts are checked for readability and horizontal overflow. PDF control tests exercise source edits/undo, page organization, overlays, search, reconstruction and reflow export.

Installed-consumer tests inspect the actual npm tarball and exercise ESM, CommonJS, strict TypeScript and standalone bundles. Native checks distinguish builds from execution: WPF/WinUI capture rendered PNGs and Avalonia produces a rendered PDF; JSON success reports are required. Blazor tests consume actual NuGet packages and exercise EditForm notifications, full binding values, formats/PDF and remounting. The existing public Blazor version is independently versioned; a source/CI build is not a new NuGet publication.

## Reproduce and inspect

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:browser
node scripts/benchmark.mjs --json
# Same deployed-sample checks, with local source only for isolated React fixtures:
BROWSER_TEST_URL=https://wieslawsoltes.github.io/RichTextWeb/ npm run test:browser
```

CI artifacts contain `test-results/browser.json`, screenshots, benchmark observations, native reports and packaged desktop samples. After deployment, the Pages gate first verifies `build-info.json` against the exact version and commit, then runs the browser suite against the public sample before npm publication. Registry verification downloads and compares the immutable release tarball with published npm bytes.

## Performance observations, not guarantees

On the PR #16 Node 24.20.0 Linux/x64 AMD EPYC 9V74 runner, the repeatable 1,000-paragraph/80,892-UTF-16-unit workload measured median construction at **14.692 ms**, serialization **0.835 ms**, insertion of five characters plus undo **31.219 ms**, finding 1,000 matches **0.367 ms**, and formatting 100 characters plus undo **77.249 ms**. See the run's `benchmark.json` for repetitions and ranges. These are runner observations, not device latency targets or evidence of Word-identical layout.

Finite pages still measure the whole body and clone body content for mirrors. Visible-first realization, cached geometry and binary offset lookup reduce avoidable work but do not establish full incremental layout virtualization. Structural edits and index rebuilding can scale with document size.

## Remaining qualification

Exact Word render comparisons, exhaustive WPF APIs, arbitrary third-party Office/PDF corpora, all Word math/field grammars, Firefox/WebKit, non-Windows Avalonia runtimes, actual OS IMEs, physical devices/screen readers and production collaboration services need additional implementation or qualification. See [the compatibility matrix](COMPATIBILITY.md) for the distinction between supported behavior and remaining boundaries.
