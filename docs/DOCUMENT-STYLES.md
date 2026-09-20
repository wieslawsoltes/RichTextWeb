# Named document styles

Source continuation after 0.5.0, based on `ada9116`. This is not a new npm/NuGet release and does not establish full Word style or typography parity. The reusable engine, controls, native DOCX converter and sample share one style catalog. See [the feature audit](WORD-FEATURE-AUDIT.md) for the complete capability inventory and remaining acceptance gates.

## Define, apply and update

```js
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
} from "@wieslawsoltes/richtextweb/core";

const engine = new RichTextEngine(
  new FlowDocument([new Paragraph("Report title"), new Paragraph("Body text")]),
);
engine.SetDocumentStyles([
  {
    Id: "Body",
    Name: "Body text",
    Kind: "Paragraph",
    IsDefault: true,
    Properties: { FontSize: 16, Foreground: "#283548", Margin: { Bottom: 12 } },
  },
  {
    Id: "Title",
    Name: "Report title",
    Kind: "Paragraph",
    BasedOn: "Body",
    Next: "Body",
    Properties: {
      FontSize: 30,
      FontWeight: "Bold",
      HeadingLevel: 1,
      KeepWithNext: true,
    },
  },
  {
    Id: "Accent",
    Name: "Accent",
    Kind: "Character",
    Properties: { Foreground: "#9b3c27", FontStyle: "Italic" },
  },
]);
engine.Select(0);
engine.ApplyParagraphStyle("Title");
engine.Select(13, 17);
engine.ApplyCharacterStyle("Accent");

const body = engine.GetDocumentStyles().find((s) => s.Id === "Body");
engine.SetDocumentStyle({
  ...body,
  Properties: { ...body.Properties, FontSize: 20 },
});
engine.Undo(); // Revert the definition and every affected presentation in one operation.
```

The document stores `DocumentStyles`; paragraphs and inlines store `ParagraphStyleId` or `CharacterStyleId` references, not duplicated style-derived font values. A paragraph without an explicit reference uses the default paragraph style. Character styles have no independent default role. `BasedOn` must refer to the same kind; `Next` must refer to a paragraph style. Pressing Enter at a collapsed paragraph-end caret uses `Next`; splitting in the middle retains the original style. Pasting text containing newlines does not imply the same Enter intent.

`GetDocumentStyles()` and `ResolveDocumentStyle(id)` return detached data. `validateDocumentStyles(catalog)` and `resolveDocumentStyle(catalog, id)` are standalone DOM-independent helpers. Public resolution observes the caller's current array even when that array was mutated since an earlier call; internal immutable catalog snapshots have per-identity caches.

Supported character setters are font family/size, normal/bold, normal/italic, foreground/background, none/underline, baseline/superscript/subscript and language. Paragraph styles additionally support alignment, writing direction, per-side margins, exact pixel line height, text indent, outline levels 0–6, page-break-before, keep-together and keep-with-next. Partial style margins inherit unspecified sides from their base style. Values are deliberately restricted rather than accepting arbitrary CSS or executable property expressions. For predictable native colors use six-digit hexadecimal colors. Native font-size rounding remains constrained by half-point DOCX units.

## Precedence and editing

Direct local values override named definitions. Existing host dependency-property styles/triggers and current/coerced values retain their existing layers. Named paragraph values participate in normal inherited font properties; explicit character-style setters override paragraph styling for their text. Updating the catalog invalidates effective named values without rewriting canonical local formatting. Document changes drive controls and layout; this does not promise a native WPF property-change event for every affected derived property.

Normal typing within styled text keeps style references and explicit inline overrides rather than freezing the paragraph's resolved values into the new run. `ApplyParagraphStyle(id, true)` additionally clears supported paragraph-level direct formatting. `ApplyCharacterStyle(id, true)` clears supported selected character-level direct values. Passing `null` removes the corresponding explicit style reference. `ClearDirectFormatting()` clears selected character-level direct values while retaining named references; it does not clear paragraph formatting. At a caret, character-style commands affect subsequent typing.

`CreateDocumentStyleFromSelection(id, name, kind)` captures supported effective formatting and requires a new ID. It does not capture the model's automatic line-height sentinel as an explicit 1.5-pixel line. `UpdateDocumentStyleFromSelection(id)` updates an existing style while retaining its ID, kind, name, base, next and default role. Mixed selection values that do not yield one value are omitted.

`RemoveDocumentStyle(id, replacement?)` rejects removal of an in-use style without a compatible replacement, including implicit users of the default paragraph style. Replacement updates document references, based-on and next links; validation rejects cycles introduced by retargeting. Removing the default transfers its role to the replacement. Complete catalog replacement cannot orphan existing references.

Document mutations use normal history and review validation. Formatting protected content-control contents is rejected by the existing engine rules. Changing a shared style definition is a document-level operation and may change the appearance of locked contents; locks remain editing constraints, not a security boundary. Hosts requiring formatting protection must authorize catalog changes themselves.

## Reusable controls and sample

The shared toolbar offers `DocumentStyles`, `CreateStyleFromSelection` and `ClearDirectFormatting`. The manager previews resolved font appearance and exposes apply, new paragraph/character style, create/update from selection, modify and delete-with-replacement actions. Blank property fields mean inheritance. It remains inspectable in read-only mode while mutation buttons are disabled. Mutation dialogs retain the original selection and reject replaced or revised documents; they never overwrite a changed document silently.

Document Studio's Home ribbon exposes the same manager and commands. Its existing preset gallery now creates reusable `Studio_*` named definitions and applies them; once created, modified definitions are not overwritten by clicking a preset again. The document catalog includes user paragraph and character styles with apply actions. The **Named document styles** (`styles`) sample, built by `sample/styles.js` solely through public APIs, demonstrates derived titles, a quotation, character emphasis and independent direct formatting. Named outline levels feed both the sample outline and the engine's contents generator.

Headers, footers and floating stories render shared definitions. Header/footer, floating and rich-content-control drafts copy the current catalog so existing styles can be applied within them. Shared definition edits belong in the parent document: an apply rejects changed draft/parent catalogs rather than losing definitions or replacing intervening changes. This is not a nested style-catalog merging system.

Style references and sequential catalog changes use the existing rich collaboration protocol; tests cover two bound replicas and undo. There is no new fine-grained same-style concurrent merge algorithm. Applications still own authorization, conflict policy, persistence and production transport.

## Native interchange and explicit limits

DOCX uses real `w:style`, `w:basedOn`, `w:next`, default style roles, `w:pStyle` and `w:rStyle`. Supported derived formatting is not flattened into every paragraph or run. Native tests remove private RichTextWeb metadata, then edit imported definitions and verify changes. Bold/italic definitions are translated through native toggle semantics within supported same-kind inheritance chains. The canonical API uses absolute values; arbitrary Word toggle interactions across document defaults, paragraph/character/table styles and every Word version are not equivalent to those absolute setters and remain unqualified.

The native reader diagnoses missing/cyclic/incompatible bases, unsupported properties, linked style metadata, theme indirection and over-budget definitions. Missing or unsupported references are removed with a warning so retained body content remains editable. Supported explicit setters are retained when theme-only font/color metadata cannot be resolved. Unsupported style definitions and metadata are not promised to round-trip losslessly. The body is retained, not silently labelled as fully qualified Word formatting.

Authored documents containing styles include a style-part fingerprint alongside the existing main-part fingerprint in their optional private snapshot. Editing `styles.xml` invalidates that snapshot and uses native import, preventing an old catalog from hiding external style edits. Older snapshots without a style fingerprint remain backward compatible. This is not exhaustive cross-part tamper detection or a security guarantee.

HTML, Markdown, XAML and PDF exports resolve a copy for their existing format paths; the live canonical document is not flattened. These formats do not promise editable named-style catalogs or exact Word layout. PDF and browser shaping, advanced bidirectional text, font metrics and print fidelity retain their existing boundaries.

Catalogs have at most 256 entries, inheritance depth at most 64, portable IDs of at most 128 characters and names of at most 256. Numeric bounds are checked before mutation. Native compatibility definitions needed for legacy heading/caption paragraphs count against the same budget; a document combining a full catalog with additional legacy styles must migrate those paragraphs to existing named definitions before export. Native warnings are bounded to 100 entries.

Remaining work includes table/list styles, linked-style intent, document themes and font/color maps, latent styles and template organizers, automatic style redefinition, advanced OpenType/effects, complete native toggle/default precedence, every line-spacing/indentation convention, style-scoped multilevel numbering and production-scale incremental invalidation. Word desktop open/edit/save/reopen and visual qualification were not performed.

## Evidence

This increment adds 56 Node regressions to the 576-test forms baseline (632 total), plus eight integrated Chromium groups. It covers live model precedence, explicit overrides, typing, following styles, selections, undo/review, safe deletion, native style XML without extensions, style-only external edits, unsupported imports, story drafts, sequential collaboration and the public-API sample. Browser/package/native-host results belong to the exact checked commit, not test presence.

```sh
npm run typecheck
npm run check
npx playwright install --with-deps chromium
npm run test:browser
node scripts/audit-word-features.mjs > feature-inventory.json
```

Primary comparison targets: [Microsoft style authoring](https://support.microsoft.com/en-us/word/customize-or-create-new-styles), [based-on semantics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.basedon?view=openxml-3.0.1), [following paragraph styles](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.nextparagraphstyle?view=openxml-3.0.1) and [Word toggle-property notes](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/f7130225-2368-48f3-acae-a9d278d0fb25). These are comparison references, not interoperability certification.
