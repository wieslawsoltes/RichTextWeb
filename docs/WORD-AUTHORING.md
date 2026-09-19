# Word-style authoring APIs

These additions are in the source tree after 0.5.0; they are not a new npm release. See the [feature audit](WORD-FEATURE-AUDIT.md) for implemented modules, evidence and remaining work. None of these APIs imply complete Word compatibility.

## Headless table formulas

The model and authoring APIs are exported from `@wieslawsoltes/richtextweb/core`. Format conversion is a separate entry point. A formula is a real editable field, not an application-only display string.

```js
import {
  RichTextEngine,
  DocumentFeatures,
} from "@wieslawsoltes/richtextweb/core";
import { fromHTML } from "@wieslawsoltes/richtextweb/formats";

const engine = new RichTextEngine(
  fromHTML(
    "<table><tr><td>100</td></tr><tr><td>2</td></tr><tr><td>RESULT</td></tr></table>",
  ),
);
const features = new DocumentFeatures(engine);
engine.Select(0);
engine.SetTableHeaderRows(1);
const start = engine.Document.Text.indexOf("RESULT");
engine.Select(start, start + "RESULT".length);
let formulaId;
engine.Change(() => {
  formulaId = features.InsertFormula("SUM(ABOVE)", "0.00");
  const result = features.UpdateFields();
  if (result.Unresolved.length) console.warn(result.Unresolved);
});
console.assert(engine.Document.Text === "100\n2\n2.00");
engine.Undo(); // Restores RESULT in one operation; the earlier header change remains.
```

Supported functions: `ABS`, `AND`, `AVERAGE`, `COUNT`, `DEFINED`, `FALSE`, `IF`, `INT`, `MAX`, `MIN`, `MOD`, `NOT`, `OR`, `PRODUCT`, `ROUND`, `SIGN`, `SUM`, `TRUE`. Operators include arithmetic, exponentiation, percent and comparisons. `IF` evaluates only the selected branch; `ROUND` uses half-away-from-zero rounding.

References use the nearest containing table: A1, RnCn, rectangular ranges, `ABOVE`, `BELOW`, `LEFT`, `RIGHT`, and bare `R`/`C`. Directions exclude marked header rows and the formula cell; merged cells are counted once. Formula dependencies consume numeric results before display formatting, including forward references. Numeric document variables and bookmark values can be operands. Cycles, missing values, malformed tables, invalid syntax and nonfinite arithmetic produce diagnostics and preserve the old cached display. Sorting does not rewrite A1 references: update fields after changing table order.

`evaluateFormula(expression, context?)` and `validateFormula(expression)` are also available independently. The evaluator never executes JavaScript or fetches external data. It enforces expression, nesting, evaluation, dependency and grid budgets. Unsupported formulas are not silently converted to zero. See [the audit's formula contract](WORD-FEATURE-AUDIT.md#new-authoring-contract) for limits.

## Sort tables and author header rows

For a table with at least two logical columns, put the caret in that table and call:

```js
engine.SortTable({
  Keys: [
    { Column: 0, Type: "Text" },
    { Column: 1, Type: "Number", Descending: true },
  ],
  Locale: "en",
});
engine.SetTableHeaderRows(1);
```

The selection determines the containing table. Columns are zero-based; one to three keys are supported. `HeaderRows` can override the leading-header count for sorting, and `CaseSensitive` affects text comparison. Header authoring creates actual header/body row groups for DOM `thead` rendering and native DOCX `w:tblHeader` export.

Sorting is stable, preserves rich node IDs, keeps the caret with its paragraph and uses normal engine undo/review. It sorts within original body row groups to preserve inherited group formatting. Vertical merges, invalid logical grids, out-of-range keys and malformed numeric/date keys are rejected before mutation. Dates must be ISO dates or timezone-qualified timestamps. Word AutoFit and printer-identical repeated-header pagination are not established.

## Captions, cross-references and tables of figures

```js
const caption = features.InsertCaption({
  Label: "Figure",
  Text: "System overview",
  NumberFormat: "ARABIC",
});
engine.Select(engine.Document.Text.length);
engine.InsertParagraph();
engine.InsertText("See ");
features.InsertCrossReference(caption.LabelNumberBookmark, { Hyperlink: true });
engine.Select(0);
features.InsertTableOfFigures("Figure", {
  Title: "List of figures",
  IncludePageNumbers: false,
});
```

`InsertCaption` creates an independent caption paragraph, a label-scoped `SEQ` field and bookmark targets for the whole caption, number and label-plus-number. The returned object has `Id`, `Bookmark`, `NumberBookmark` and `LabelNumberBookmark`. Creation and target setup are one undo action; continuing into a new paragraph does not duplicate caption metadata.

`InsertCrossReference` accepts `PageNumber: true` to insert `PAGEREF` rather than `REF`. Page results need caller-supplied/current measured layout. `InsertTableOfFigures` uses the selected label and existing TOC machinery; it can produce a list of tables with label `Table`. Native DOCX uses caption styles, `SEQ`, bookmarks, reference fields and `TOC \c` instructions, not just private JSON.

Updates resolve bookmark references from a pre-update snapshot. When the referenced sequence itself changes, a second update may be necessary. Automatic chapter numbering, arbitrary index/authority fields and a general fixed-point field scheduler remain outside this increment.

## Inspect, edit, update, lock and unlink fields

```js
const id = features.InsertFieldCode(
  String.raw`= SUM(2,3) \# "0.00"`,
  "pending",
);
features.UpdateFields();
features.SetFieldLocked(id, true);
features.SetFieldCode(id, "= 6+7");
features.UpdateFields(); // Locked cached text remains 5.00.
features.SetFieldLocked(id, false);
features.UpdateFields(); // Now 13.
features.UnlinkField(id); // Keep visible text, remove field behavior.
```

`GetSelectedField()` returns a detached outer field at the selection or its trailing boundary. `SetFieldCode` validates before mutation and preserves cached text/lock state until update. `UpdateFields(context?)` returns `Updated`, `Unresolved` entries (`Id`, `Instruction`, `Reason`) and main-story UTF-16 `TextChanges`. Successful substitutions remap annotations and selection using the actual text splices, including embedded-object positions.

Field types include existing page/date/reference/merge/sequence fields plus `=`, `IF`, `DOCPROPERTY`, `DOCVARIABLE`, `NUMWORDS`, `NUMCHARS`, `NUMPARAS`, `SECTION`, `SECTIONPAGES`, `CREATEDATE` and `SAVEDATE`. General case/numeric formats, common numeric pictures and UTC date pictures are implemented; not every Word field or switch is supported. Unsupported/locked fields retain cached content. No `INCLUDETEXT`, DDE, shell or external-data execution is performed.

Context can supply `Now`, `Locale`, `Data`, `FileName`, `Properties`, `Variables`, `PageNumber`, `PageCount`, `PageOfNode`, `SectionNumber`, `SectionPageCount`, `SectionOfNode` and `SectionPagesOfNode`. Missing layout is reported, not invented. For deterministic dates, pass an explicit `Now`.

```js
features.SetDocumentVariable("Budget", 500);
features.InsertFieldCode("DOCVARIABLE Budget");
features.UpdateFields({ Now: new Date("2026-09-19T12:00:00Z") });
```

Scalar custom properties are retained in `DocumentProperties`; document variables use `DocumentVariables`. Native DOCX exports/imports core properties, typed scalar custom properties and document variables. Native Word variables are strings; objects and arbitrary custom XML bindings are not supported. Tests remove the private RichTextWeb extension when checking native interchange.

## Reusable controls and sample

Register the controls and toolbar normally, attach the same editor to `RichTextToolbar.Editor`, and use `toolbar.Execute(command)` or visible buttons. The new shared commands are `Formula`, `SortTable`, `RepeatHeaderRows`, `Caption`, `CrossReference`, `TableOfFigures`, `FieldCode`, `LockField`, `UnlockField`, `UnlinkField` and `WordCount`. Dialog submissions reject a changed document or newly read-only editor. No sample-only engine is required.

`editor.UpdateFields(context?)` is read-only guarded and combines caller context with available measured page context. `F9` updates document fields; `Ctrl+F11` locks, `Ctrl+Shift+F11` unlocks, and `Ctrl+Shift+F9` unlinks the selected field. The Insert Field dialog preserves existing page-field caches. Explicit field updates may use current measured pagination. Shortcuts are ignored during composition and mutation is blocked in read-only mode.

Document Studio exposes these actions in References, Table layout and Review. The `automation` template demonstrates calculated line items (150.00 and 270.00), total 420.00, budget approval, custom properties, a table caption, cross-reference and list of tables. Run `npm ci`, `npm run build:demo` and `npm run dev`, then select the automation template.

## Statistics and audit tooling

```js
const all = features.GetStatistics();
const selection = features.GetStatistics({ Start: 0, End: 5 });
const includingNotes = features.GetStatistics({
  IncludeNotes: true,
  Locale: "en",
});
```

Results contain `Words`, `Characters`, `CharactersWithoutSpaces`, `Paragraphs` and `Lines`. Words use Unicode segmentation; characters are code points excluding paragraph separators and embedded objects; lines are logical rather than printed. Selection offsets remain UTF-16, as in the engine. Notes are opt-in for document totals. Headers/floating stories are not automatically counted. These are not certified Word proofing-engine counts.

`node scripts/audit-word-features.mjs > feature-inventory.json` inventories top-level source exports, declared public class members and test paths without adding a runtime dependency. It supports the installed TypeScript compiler API (including its version-7 native API) and does not count declarations as behavioral coverage.
