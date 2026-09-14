# Verification and measured performance

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
