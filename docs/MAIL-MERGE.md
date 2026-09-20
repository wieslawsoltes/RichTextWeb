# Recipient queries, previews and mail merge

Source additions after 0.5.0; no new npm/NuGet version is implied. The merge engine is DOM-independent. The toolbar and Document Studio use the same APIs, not a sample-only implementation. This increment does not establish full Word mail-merge or printer fidelity.

## Query and generate headlessly

```js
import {
  RichTextEngine,
  FlowDocument,
  Paragraph,
  Run,
  DocumentFeatures,
  createFieldFromInstruction,
} from "@wieslawsoltes/richtextweb/core";

const field = (instruction) =>
  createFieldFromInstruction(instruction, "pending");
const engine = new RichTextEngine(
  new FlowDocument(
    new Paragraph([
      new Run("Dear "),
      field("MERGEFIELD Name"),
      new Run(" — record "),
      field("MERGEREC"),
      new Run(", output "),
      field("MERGESEQ"),
    ]),
  ),
);
const features = new DocumentFeatures(engine);
const session = features.CreateMailMergeSession(
  [
    { Name: "Ada", Team: "Research", Amount: 150 },
    { Name: "Grace", Team: "Operations", Amount: 270 },
    { Name: "Katherine", Team: "Research", Amount: 420 },
    { Name: "Alan", Team: "Research", Amount: 95 },
  ],
  {
    Filters: [{ Field: "Team", Operator: "Equal", Value: "Research" }],
    Sort: [{ Field: "Amount", Type: "Number", Descending: true }],
    Exclude: [1],
    FailOnUnresolved: true,
  },
  { Now: new Date("2026-09-20T12:00:00Z") },
);

console.log(session.Count); // 2
console.log(session.Preview(2).Document.Text); // Dear Alan — record 3, output 2
const documents = session.Generate(); // Independent FlowDocument instances.
// The source document, selection and undo stack are unchanged.
```

`CreateMailMergeSession(records, options?, context?)` snapshots the canonical template, scalar records and resolved recipient plan. The clock and property/variable dictionaries are detached. `Plan` returns a detached plan and `Count` is the selected output count. Previewing a one-based selected output index returns `{ Recipient, Document, Fields }`; `Fields.Unresolved` contains the normal field diagnostics. Returned documents and recipient data never alias the session or source. Explicit layout callbacks remain caller-owned and must remain stable to produce repeatable page results.

`Generate()` returns documents only after the complete batch succeeds. With `FailOnUnresolved`, the first unresolved field rejects generation with its original source row number; preview still supplies diagnostics. Without it, unsupported/missing fields preserve their cached text. No partial event/download or source edit is committed on failure. Outputs retain editable supported field instructions, styles, themes, stories and other canonical content; they are not flattened print images.

The existing `features.MailMerge(records, context?, options?)` remains available, retaining the original second-argument context and adding a third query argument. Sessions default to `ReferenceMode: "Current"`, so supported bookmark/formula/IF dependencies resolve from the recipient's pending values. Pass `ReferenceMode: "Snapshot"` in context for legacy cached-reference behavior. Normal headless `UpdateFields` defaults are unchanged.

## Selection and numbering contract

`createMailMergePlan(records, options?)` performs pure validation and planning without requiring a document. Its result contains `Fields`, `TotalRecords`, `MatchedRecords` and selected `Recipients`. Each recipient has detached `Data` and three deliberately distinct ordinals:

- `SourceRecord`: one-based original input row. `Include` and `Exclude` use this identity; sorting never changes it.
- `RecordNumber`: position after filtering and sorting, before manual/range selection. This supplies the native `MERGEREC` field.
- `SequenceNumber`: consecutive selected output position. This supplies native `MERGESEQ`.

Processing order is filters → stable sorting → one-based `FirstRecord`/`LastRecord` range → original-row inclusion/exclusion. Ranges refer to the filtered/sorted positions and are inclusive. Exclusion wins over inclusion. An empty `Include` selects no records; an absent `Include` includes all eligible rows. Duplicate or out-of-range source selection numbers reject; an empty result generates `[]` and cannot be previewed. This explicitly documented range/manual-selection policy is not a claim of every Word dialog interaction.

Both numbering fields require a positive, finite integer supplied by merge context. Outside a merge, `MergeRecord` and `MergeSequence` can be supplied explicitly to `UpdateFields`; missing values produce diagnostics instead of inventing numbers. Native DOCX writes their actual instructions and caches.

## Filters and sorting

Filters use `Field`, `Operator`, optional `Type` and `Value`. Operators are `Equal`, `NotEqual`, `Less`, `LessOrEqual`, `Greater`, `GreaterOrEqual`, `Blank`, `NotBlank`, `Contains` and `NotContains`. `Match: "All"` is the default; `"Any"` matches at least one condition. The core permits 32 flat conditions; the dialog exposes three. Arbitrarily nested/mixed AND/OR expressions are not implemented.

Sort accepts up to three `{ Field, Type?, Descending? }` keys. Equal keys retain source order; blank keys sort last in either direction. Comparison types are `Text` (default), `Number` and `Date`. Text uses `Intl.Collator`, an explicit default `en` locale and case-insensitive, accent-sensitive ordering; `CaseSensitive: true` changes that behavior. Contains is a literal locale-lowercased substring test, not a regular expression or wildcard language. Locale-specific collation can vary across JavaScript/ICU versions.

Blank means null, absent, empty or whitespace-only; zero and false are not blank. Number keys use the existing strict field-number parser. Dates require valid Gregorian ISO dates or timezone-qualified ISO timestamps, rejecting date/clock rollover. Invalid typed values, unknown fields/options, malformed query keys and accessors are rejected rather than silently omitted or evaluated. Relational comparisons do not match blanks. Every filter condition is checked even under `Any`, avoiding hidden malformed typed data.

## Local data sources

`validateMailMergeRecords(unknown)` accepts arrays of plain records with own scalar values: strings, finite numbers, booleans and null. Records and queries are detached/validated before use. Sparse recipient arrays, accessors, executable values, nested objects and unsupported types reject. Special names such as `__proto__` remain inert own data keys. This is not an execution sandbox for hostile JavaScript proxies passed by the host.

`parseMailMergeDelimited(text, delimiter?)` supports comma, tab and semicolon delimiters, UTF-8 BOM text, CR/LF/CRLF record endings, quoted delimiters/newlines and doubled quotes. The first row supplies unique nonempty trimmed column names. Ragged rows, malformed quotes and duplicate headers reject. Data values remain strings, including spreadsheet-looking formulas: no formula, URL, database, macro or remote file is executed. A header-only source yields no records. JSON uses the same scalar-record validation.

The reusable dialog has a local file picker and an explicit Load recipients action. It holds the list in its own session rather than adding it to the template, browser storage or a remote service. Editing source/query controls invalidates the old preview and disables generation until reapplied. Closing clears the owned inputs and preview state; applications can retain anything they explicitly pass or capture. Generated documents necessarily contain the selected recipient values and should be handled as sensitive output by the host.

## Merge field text switches

```js
const contribution = createFieldFromInstruction(
  String.raw`MERGEFIELD Amount \# "#,##0.00" \b "$" \f " due"`,
  "pending",
);
```

For a nonempty resolved result, `\b` prepends its one text operand and `\f` appends its operand after supported formatting. Empty or null recipient values omit both; zero and false are real values. Empty numeric fields remain blank rather than failing their numeric picture. Missing fields remain unresolved. Mapped `\m` and vertical `\v` merge modes are explicitly diagnosed as unsupported. Other field grammar and formatting limits are unchanged.

## Shared controls and sample

`toolbar.Execute("MailMergeRecipients", records?)` opens recipient management and rich preview. A host can handle the existing `documentsgenerated` event to receive independent documents. The dialog includes local JSON/CSV/TSV input, query fields, manual checkboxes, matched selection controls, query ranges, preview navigation, diagnostics and strict generation. At most 50 table rows and the first eight data columns are realized in its recipient list; cell displays are truncated at 300 characters without truncating stored values. The rich preview uses the existing read-only viewer.

A changed template revision/document, newly read-only editor or replaced toolbar target rejects the operation. The new dialog does not use the template's old measured page mapping for expanded output: page-dependent fields require valid explicit context. Preview is continuous rich layout, not a print certification.

The original `MailMerge` JSON dialog is retained. Document Studio's Mailings ribbon exposes Recipients & preview and Quick JSON merge. Its **Personalised project invitations** template uses real themed styles, merge fields, conditional messages, prefixed currency and query/output numbering. The four supplied recipients exercise filtering and sorting. A generated-results picker lets the user preview any output, download selected native DOCX, download all canonical documents as one JSON file, or explicitly open one document. It never automatically replaces the source or initiates a download per recipient. Opening rejects intervening document changes; downloads remain explicit.

## Resource and fidelity boundaries

Source limits: 10,000 records, 256 distinct fields, 200,000 cells, 65,536 UTF-16 units per string value and four million accumulated field-name/value text units. Delimited input is capped at four million UTF-16 units; the local file picker has a separate four-MB byte limit. Generation is capped at 1,000 documents, one million template nodes across the batch and eight million serialized canonical UTF-16 units. Template-size preflight is conservative; actual expanded output is checked cumulatively. These are defensive application limits, not Word limits. The existing field evaluator's expression/dependency budgets also apply.

Not implemented here: Office data-source relationships/query persistence; Excel/Access/ODBC/Outlook connections; address-block/greeting-line mapping; record editing grids; duplicate-recipient or postal-address validation; NEXT/NEXTIF/SKIPIF and directory/label record consumption; envelopes/labels or batch printer layout; email delivery; nested instruction fields; automatic per-output pagination/TOC fixed points; arbitrary rich external values; external execution. No email is sent and no recipient data is uploaded by this feature. Microsoft Word desktop open/save/reopen and visual comparisons were not performed.

The table formula continuation also keys containing-table and grid caches by object identity, preventing reused detached IDs in independent body/header stories from sharing the wrong table. A regression uses different inputs in body and header tables with identical IDs and verifies independent calculations.

## Verification

`tests/mail-merge.test.ts` adds 53 Node regressions (732 total at this increment), including native DOCX tests that remove RichTextWeb metadata. Eight groups in `tests/mail-merge.browser.mjs` cover shared dialogs, local input, bounded rows, diagnostics, stale/read-only targets, mobile geometry, the real Mailings ribbon and generated output picker. Test presence is not a pass: consult the exact commit's CI and retained browser evidence.

```sh
npm run typecheck
npm run check
npx playwright install --with-deps chromium
npm run test:browser
node scripts/audit-word-features.mjs > feature-inventory.json
```

Primary behavior comparisons: [Microsoft recipient editing](https://support.microsoft.com/en-au/word/mail-merge-edit-recipients), [filter options](https://support.microsoft.com/en-us/word/query-options-filter-dialog), [sort options](https://support.microsoft.com/en-us/word/query-options-sort-dialog), [MERGEREC](https://support.microsoft.com/en-us/word/field-codes-mergerec-field), [MERGESEQ](https://support.microsoft.com/en-us/office/field-codes-mergeseq-field-f84ff007-79fe-4378-a535-02e53512effd) and [MERGEFIELD switches](https://support.microsoft.com/en-us/word/field-codes-mergefield-field). These are comparison targets, not certification.
