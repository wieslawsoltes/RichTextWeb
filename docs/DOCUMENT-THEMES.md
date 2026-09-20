# Document themes

Source continuation after 0.5.0, based on merged `ca1c2e8` / PR #26. This adds live **text** theme palettes, semantic color mappings and Latin major/minor font families to the existing document/style model. It is not full Word/DrawingML theme fidelity, a font service, or a new npm/NuGet release.

## Shared engine APIs

```js
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
  createDocumentTheme,
  themeColor,
  themeFont,
} from "@wieslawsoltes/richtextweb/core";

const engine = new RichTextEngine(
  new FlowDocument(new Paragraph("Report title")),
);
engine.SetDocumentTheme(createDocumentTheme("Studio"));
engine.SetDocumentStyles([
  {
    Id: "Title",
    Name: "Title",
    Kind: "Paragraph",
    IsDefault: true,
    Properties: {
      FontFamily: themeFont("Major", "Arial"),
      Foreground: themeColor("accent1", { Fallback: "#174B75" }),
      FontSize: 32,
    },
  },
]);
const title = engine.Document.Blocks.Get(0);
console.assert(title.GetValue("Foreground") === "#174B75");
engine.SetDocumentTheme(createDocumentTheme("Editorial"));
console.assert(title.GetValue("FontFamily") === "Georgia");
console.assert(title.GetValue("Foreground") === "#7B3149");
engine.Undo(); // Restore the whole prior theme as one operation.
```

`GetDocumentTheme()` returns a detached copy or `null`. `SetDocumentTheme(theme)` validates all properties before mutation. `SetDocumentTheme(null)` removes the palette/font scheme while retaining symbolic references, which then use their explicit fallbacks. `DetachDocumentTheme()` instead freezes current effective theme values in local properties, named style definitions, independent stories and insertion formatting, then removes the theme in one undo action. Detaching can be rejected by content locks because it changes stored formatting; a palette change alone does not rewrite locked content.

`createDocumentTheme("Studio" | "Editorial" | "Forest")` returns an independent baseline palette. These are RichTextWeb examples, not copies of a complete Office theme. No fonts are downloaded or embedded; the host/browser supplies installed font fallback. Font files are not included.

## Palette, mapping and transforms

A theme contains `Name`, all twelve `Colors` slots (`dark1`, `light1`, `dark2`, `light2`, `accent1` through `accent6`, `hyperlink`, `followedHyperlink`), `Fonts: { Major, Minor }`, and an optional `ColorMap`. Colors are strict six-digit RGB values. Theme names and Latin font-family strings are bounded to 128 characters. Unknown properties, missing slots and unsupported map targets are rejected.

```js
const custom = engine.GetDocumentTheme();
custom.Name = "Project palette";
custom.Colors.accent1 = "#245078";
custom.Fonts.Major = "Georgia";
custom.ColorMap = { text1: "dark2", accent2: "accent5" };
engine.SetDocumentTheme(custom);
engine.Select(0, 6);
engine.ApplyProperty("Foreground", themeColor("accent1", { Tint: 153 }));
engine.ApplyProperty("Background", themeColor("accent2", { Shade: 191 }));
engine.ApplyProperty("FontFamily", themeFont("Major"));
```

Semantic roles `background1`, `text1`, `background2`, `text2`, the six accents and hyperlink roles map **once** to physical slots. A mapping is not a recursive alias graph. Physical `dark1/light1/dark2/light2` references bypass semantic mapping. A document without explicit mappings uses the standard light/background and dark/text pairs.

`Tint` and `Shade` are integer **bytes 0–255**, not percentages. The resolver follows Word's HSL-luminance rule: shade multiplies luminance by `Shade/255`; tint produces `1 - (1-L) * Tint/255`. Tint takes precedence when both are present. Byte 255 leaves the color unchanged; tint 0 is white and shade 0 is black. The implementation uses floating-point HSL and truncates output RGB channels. The published blue tint example (`#4F81BD`, tint `99`) yields `#95B3D7`. Exact per-channel equality with every Word version's internal quantization is **not qualified**: the published rounded-HSL red shade example differs by one green channel from this full-precision calculation. Native attributes are retained for Word's own rendering rather than replaced by this fallback alone.

`themeColor` and `themeFont` create validated string tokens, preserving compatibility with existing string dependency properties. Use these factories rather than constructing token strings manually. `parseThemeColor`, `parseThemeFont`, `validateDocumentTheme`, `transformThemeColor`, and `resolveDocumentThemeValue` are standalone helpers. Color references apply to `Foreground`, `Background`, and `BorderBrush`; fonts apply to `FontFamily`. Other token/property combinations fail before mutation. An absent theme returns a color's final `Fallback` unchanged, without applying its tint/shade again.

## Styles, formatting, history and stories

`GetValue`, selection `GetPropertyValue`, and engine `GetProperty` expose resolved colors/font families. `ReadLocalValue`, JSON and style definitions retain their references. Direct literal formatting overrides named styles and does not change when a theme is replaced. Theme replacement invalidates effective property caches, including inherited values, without copying resolved colors into every run. Reparented content resolves against its new document's palette.

Creating/updating a style from consistently theme-linked selection formatting keeps the common theme reference. Heterogeneous theme/literal sources with the same appearance capture that literal appearance instead of inventing a link. Normal typing preserves symbolic insertion formatting. Theme changes use the normal history/review pipeline and do not move text positions or annotations.

Header/footer, floating-content and rich content-control drafts share the theme at opening. They reject conflicting parent theme changes and cannot silently publish a separate shared theme back to the owner. Edit the parent theme, then reopen the story. Sequential whole-theme collaboration and undo use the existing rich protocol; fine-grained concurrent palette-property merges and production authorization are not added. Theme changes can affect content-locked text because locks protect stored content, not an authenticated appearance/security boundary.

## Reusable UI and sample

`RichTextToolbar` commands `DocumentTheme`, `ThemeColor`, and `ThemeFont` are available in Home mode. The manager previews without modifying the document, applies a preset, customizes colors/fonts/mappings, or detaches the theme. Existing named-style properties now include theme link selectors and tint/shade controls, with literal/fallback values available separately. No application-only theme engine is involved.

Editor controls expose `GetDocumentTheme`, read-only-guarded `SetDocumentTheme` and `DetachDocumentTheme`, plus generic engine commands through `Execute`. Read-only documents permit theme inspection. Modification dialogs validate input and reject changed document revisions, replaced editors/documents and newly read-only state before applying captured selections. The UI's light/dark chrome theme is separate from the document theme.

Document Studio includes **Connected document themes** (`themes`) and Home ribbon theme commands. Choose Editorial to change the linked heading color/font, or Forest for another palette; its fixed violet brand text stays unchanged. The public-API sample factory is `sample/themes.js`. Existing outline, styles, form tools and automation remain available.

## Native DOCX

Export creates a native DrawingML theme part, its package relationship/content type, a twelve-slot color scheme, Latin major/minor font scheme, and document-settings `w:clrSchemeMapping`. Run/style fonts retain `w:asciiTheme/w:hAnsiTheme`; foreground and shading retain `w:themeColor` or `w:themeFill` and their tint/shade bytes together with resolved literal fallbacks. Supported table-cell shading also retains theme fill attributes. Named styles remain references rather than being flattened. Native tests remove the RichTextWeb extension before changing the imported theme and editing/undoing the result.

Import uses the related theme part, including alternate package paths and normalized namespace prefixes. Supported system colors use `lastClr` with a warning, not live operating-system color lookup. Unsupported/malformed color schemes or transforms retain native cached run formatting instead of inventing missing colors. Mixed/script-specific font choices and other unsupported features produce bounded `DocxThemeImportWarnings`. External theme relationships are not fetched. Missing supported schemes can later be replaced through `SetDocumentTheme` while surviving symbolic references become live.

Private snapshots written by this increment fingerprint the main document, styles, theme, settings and main-document relationships. Theme-only, settings-only and relationship-only edits therefore invalidate stale snapshots. Older snapshots keep their older compatibility rules; this is not exhaustive package-wide change detection. Independent modifications to every header, numbering, note, media, custom XML or glossary part still need a broader native interoperability policy.

HTML/Markdown/XAML/PDF presentation conversions use resolved copies; canonical JSON preserves the theme data and references. Editable theme semantics in arbitrary HTML/CSS or foreign document runtimes are not claimed. Theme-aware native borders, full table styles, scripts/language font selection, font embedding, effect/style matrices, scheme-colored drawings/charts, Office theme organizers/templates and printer-identical rendering remain outstanding. Export emits a minimal neutral DrawingML format scheme, not an arbitrary imported effects matrix. Word desktop open/edit/save/reopen and visual comparison were not performed.

## Evidence and reproduction

The continuation adds **47 Node regressions** to the 632-test baseline (**679 total**) and **seven integrated browser groups** (148 when the full suite passes). Tests cover live/model/selection behavior, style capture, schema/transform bounds, locks, undo, story conflicts, sequential collaboration, native DOCX with/without private snapshots, cross-part invalidation, fallbacks and the real sample. Browser tests exercise shared dialogs, mapped styles, read-only/stale validation, mobile geometry and the Home ribbon.

```sh
npm run typecheck
npm run check
npx playwright install --with-deps chromium
npm run test:browser
node scripts/audit-word-features.mjs > feature-inventory.json
```

Local Chromium navigation is blocked by the implementation environment; exact-commit GitHub Actions provides browser/package/native-host qualification. Test presence is not a pass claim. See the PR/CI evidence for the executed result.

Primary comparison references: [Word color transformations](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/8229a077-7fc8-4fba-96cc-c77b6a4fc768), [color-scheme mapping](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.colorschememapping?view=openxml-3.0.1), [run fonts](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.runfonts?view=openxml-3.0.1), [shading](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.shading?view=openxml-3.0.1), and [DrawingML theme structure](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.theme?view=openxml-3.0.1). These specify comparison targets, not certification of this implementation.
