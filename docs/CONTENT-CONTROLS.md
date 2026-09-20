# Content controls and fillable forms

Source additions after 0.5.0. They are not a new npm or NuGet release and do not claim complete Word compatibility. See [the source-module feature audit](WORD-FEATURE-AUDIT.md) for the wider engine and remaining acceptance gates.

## Headless typed controls

```js
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
} from "@wieslawsoltes/richtextweb/core";

const engine = new RichTextEngine(new FlowDocument(new Paragraph()));
const name = engine.InsertContentControl({
  Kind: "PlainText",
  Tag: "name",
  Title: "Full name",
  Placeholder: "Enter your name",
  Required: true,
  MaxLength: 120,
  LockContentControl: true,
});
engine.Select(engine.Document.Text.length);
engine.InsertParagraph();
const ready = engine.InsertContentControl(
  {
    Kind: "CheckBox",
    Tag: "ready",
    Title: "Ready for review",
  },
  false,
);
engine.FillForm({ name: "Ada", ready: true }); // One atomic undoable edit.
console.log(engine.GetFormData()); // { name: "Ada", ready: true }
console.log(engine.ValidateForm()); // []
engine.Undo(); // Both original values restored.
```

`Kind` supports `PlainText`, `RichText`, `CheckBox`, `DropDownList`, `ComboBox` and `Date`. `Level` is `Inline` (default) or `Block`. The canonical tree uses an owned `Span` or `Section` with validated `ContentControl` metadata. A control's stable `Id` differs from its wrapper's `NodeId`; complete pasted controls receive fresh control identities. Both remain inspectable through `GetContentControls()`.

Inline controls participate in normal UTF-16 text offsets. A floating story, header/footer or note control returns `Start: null` and `End: null`, preventing its positions from being confused with main-story text. Values can still be read/set by ID. Dialogs edit the selected main-story control; separate story editors can host the same controls.

`InsertContentControl(options, value?)` inserts or replaces the current selection. Rich-text insertion with an omitted value preserves the selected rich fragment, subject to level/category rules. Inline rich drafts must remain one paragraph. A block rich control may contain multiple paragraphs, tables, images, equations or other supported rich content.

## Dates, checkboxes and choices

```js
const due = engine.InsertContentControl(
  {
    Kind: "Date",
    Tag: "due",
    DateFormat: "dd MMMM yyyy",
    DateLocale: "en-GB",
  },
  "2026-10-01",
);
engine.SetContentControlValue(due, "2026-11-12");

const team = engine.InsertContentControl(
  {
    Kind: "DropDownList",
    Tag: "team",
    Items: [
      { DisplayText: "Research & development", Value: "rd" },
      { DisplayText: "Operations", Value: "ops" },
    ],
  },
  "rd",
);
```

Dates are actual valid Gregorian `YYYY-MM-DD` values and use the existing UTC field-date formatter for display. Unsupported date pictures or invalid dates fail before mutation. A dropdown accepts listed values or an empty placeholder; a combo accepts listed values or free text. Choice values must be unique and nonempty; duplicate display labels are allowed when native `lastValue` identifies the selected item. The generic combo edit dialog permits free text; listed items remain configurable through properties and the value API.

Checkboxes take booleans, never the strings `"true"` or `"false"` in the engine. Defaults are `☒` and `☐`; `CheckedSymbol`, `UncheckedSymbol`, `CheckedFont` and `UncheckedFont` configure their actual presentation. Native DOCX writes the corresponding Office 2010 checkbox metadata. These are character-based checkboxes rather than arbitrary images.

Empty text/date/choice values show placeholder presentation but return `""` as form data. Typing a selected text placeholder replaces the presentation rather than appending to it. Editing a placeholder's properties does not turn that presentation into user data. Regular text/rich content is held in the owned tree, not in a competing string cache.

## Metadata, editing restrictions and validation

```js
engine.SetContentControlProperties(name, {
  Title: "Applicant",
  LockContentControl: true,
  LockContents: false,
});
engine.SelectContentControl(name);
engine.SetContentControlValue(name, "Grace");
// Unlock the wrapper before explicitly removing it.
engine.SetContentControlProperties(name, { LockContentControl: false });
engine.RemoveContentControl(name); // Preserve visible rich content by default.
```

`Kind`, `Level` and `Id` are immutable. `LockContentControl` prevents removal of the wrapper; `LockContents` prevents modification of its existing contents, including formatting. They are independent: a content-locked but deletion-unlocked control can be removed. Explicit property changes can change these locks. Undo/redo restores the committed edit; review rejection uses the existing context-validated inverse and still observes incompatible later locks/changes.

Generic engine mutations validate control identities and scalar/display consistency. Dates, choices and checkboxes must be changed through the typed value API, not by corrupting their rendered run. Unlocked plain/rich text supports normal within-control edits; typing at an inline boundary stays outside its value. Partial copies become ordinary rich text instead of carrying invalid partial scalar state. Structural edits across control boundaries can reject rather than reconstruct unsupported Word editing intent. Clipboard text/HTML does not guarantee editable-control semantics; use canonical JSON or DOCX to preserve them.

`Required` and `MaxLength` are **RichTextWeb application rules**, not native Word document protection. Required values are checked by `ValidateForm()` and do not prevent temporarily clearing a field while editing. A required checkbox must be checked. Text maximum lengths count Unicode code points; editing offsets remain UTF-16. No arbitrary user-supplied regular expression or executable validator is evaluated.

These locks are **not a security boundary**. Applications still control model loading, direct model writes, authoritative collaboration, authentication and server validation. No password protection, encryption, digital signatures, restricted editable regions, VBA, ActiveX or remote data access is introduced.

## Rich content and form transactions

`SetContentControlContent(id, nodes)` edits rich-text controls with canonical inline nodes or block nodes matching their level. It validates ownership/category constraints before committing and preserves nested control identities. The toolbar's isolated rich draft supports formatting and insert tools, then applies one parent undo step; cancellation leaves the original unchanged.

`GetFormData()` returns a detached dictionary of nonempty data tags to string/boolean values. Duplicate tags are permitted: filling updates every matching control, but extraction reports a conflict if their current values disagree. Special property names such as `__proto__` remain inert own keys.

`FillForm(data, strict = true)` preflights all types, choices, dates, limits and locks before any live mutation. Unknown tags fail in strict mode; `false` ignores unknown tags. Parent/child controls whose replacement ranges overlap must be edited separately rather than guessed. Filling rich-text controls with strings replaces their rich content; use `SetContentControlContent` to retain structure. Normal engine `ReplaceAll` also preflights form constraints so a later locked match cannot leave earlier matches committed.

Existing rich collaboration transport is reused. A regression verifies sequential value/property changes and undo across two bound replicas, not a complete same-control concurrent-edit policy. Production authorization, durable persistence and conflict/intent qualification remain host work.

## Reusable controls and sample

Attach a `RichTextToolbar` to the normal editor. Shared toolbar commands are:

`InsertContentControl`, `ContentControlProperties`, `EditContentControl`, `RemoveContentControl`, `FormData`, `FillForm`, `ValidateForm`.

The editor exposes `GetContentControls()`, `GetSelectedContentControl()`, `GetFormData()`, `ValidateForm()`, read-only-guarded `SetContentControlValue()` and `FillForm()`, plus engine commands through `Execute`. Headless engine operations remain available through `Editor.Engine`.

Click a checkbox to toggle it, or focus it and press Space/Enter. Click a typed control or placeholder to edit it; double-click rich/plain content to open its editor. Checkbox state has `role="checkbox"`/`aria-checked`; controls expose accessible titles and keyboard focus. Form boundaries do not print. Screen-reader and physical touch/IME conformance are not claimed.

Dialogs reject replaced documents and newly read-only editors. Value/properties/rich drafts additionally reject changes to the target control while open, without overwriting intervening edits. Rejected native input cancels the browser edit, restores the canonical view and emits `inputrejected` with a message; the toolbar exposes the message in its status area. `contentcontroleditrequest` is cancelable for custom host UI. Disposing the toolbar detaches these subscriptions.

Document Studio's **Fillable project brief** (`forms`) has eight real controls, including a locked reference, required project name and confirmation checkbox, date, department dropdown, delivery combo and rich scope. Developer ribbon actions route to the reusable toolbar. `sample/forms.js` also builds the sample headlessly from public APIs, with tests for filling, undo and native DOCX recalculation.

## Native DOCX and explicit boundaries

Supported controls serialize as real `w:sdt`, `w:sdtPr` and `w:sdtContent`, with aliases/tags, `w:lock`, native text/rich/date/choice definitions, `w14:checkbox`, and a related glossary part for placeholder text. Native import preserves the supported behavior without the optional RichTextWeb extension. The extension additionally retains application metadata such as required/length constraints and exact internal identities; it is not a claim of arbitrary lossless Word interoperability.

Unsupported/malformed native properties, including custom XML bindings and unsupported control kinds, retain their body as ordinary rich content and add bounded `ContentControlImportWarnings`. They are not silently presented as fully supported editable controls. Foreign partial SDT structures, every native date/calendar convention, picture/repeating-section/building-block controls and legacy form fields remain unimplemented. Importing without extension data creates fresh internal control identities. Word desktop open/edit/save/reopen and visual-fidelity testing remain outstanding.

The existing private extension is guarded by the main-document digest; it does not provide exhaustive cross-part change detection. For independent native-part edits, consumers can remove/ignore the extension to exercise native import, as the interoperability tests do. This is an existing wider interchange limitation, not a security guarantee.

## Evidence

The continuation adds 66 Node regressions (576 total) and nine integrated browser groups. Run:

```sh
npm run typecheck
npm run check
npx playwright install --with-deps chromium
npm run test:browser
node scripts/audit-word-features.mjs > feature-inventory.json
```

Tests: `content-controls.test.ts`, `content-control-docx.test.ts`, `content-controls-collaboration.test.ts`, `content-controls.browser.mjs`. Check exact-commit CI for browser/package/native-host execution results. Test presence alone is not qualification. No package version is changed by this feature.

Primary comparison references: [Microsoft's Word form authoring guide](https://support.microsoft.com/en-us/word/create-a-form-in-word-that-users-can-complete-or-print), [Open XML SDT properties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sdtproperties?view=openxml-3.0.1), [Office 2010 checkbox semantics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2010.word.sdtcontentcheckbox?view=openxml-3.0.1) and [placeholder gallery serialization](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.docpartgalleryvalues?view=openxml-3.0.1). These define comparison targets, not certification.
