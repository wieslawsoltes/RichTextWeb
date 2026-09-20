import type { RichTextBox } from "./control.js";
import {
  DocumentFeatures,
  type MailMergeSession,
} from "./document-features.js";
import {
  createMailMergePlan,
  parseMailMergeDelimited,
  validateMailMergeRecords,
  type MailMergeRecord,
  type MailMergeOptions,
  type MailMergeCondition,
  type MailMergeSort,
} from "./mail-merge.js";
import type { FlowDocument } from "./model.js";
interface Host {
  Editor: RichTextBox;
  IsCurrent(): boolean;
  CreateDialog(): HTMLDialogElement;
  Generated(documents: FlowDocument[]): void;
}
/** Local-only recipient selection and rich preview. Never replaces the live template. */
export function openMailMergeRecipients(host: Host, initial?: unknown): void {
  const editor = host.Editor,
    original = editor.Document,
    revision = original.Revision;
  const owner = editor.ownerDocument,
    dialog = host.CreateDialog();
  dialog.classList.add("mail-merge-dialog");
  dialog.style.width = "min(960px,95vw)";
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
  ) => {
    const node = owner.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const css = element("style");
  css.textContent = `.mail-merge-dialog fieldset{border:1px solid var(--rt-toolbar-border,#ccd5e1);border-radius:6px;margin:12px 0;min-width:0}.mail-merge-dialog .merge-row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.mail-merge-dialog .merge-row label{flex:1;min-width:90px}.mail-merge-dialog select,.mail-merge-dialog input{max-width:100%;width:100%}.mail-merge-dialog input[type=checkbox]{width:auto}.mail-merge-dialog .merge-table{overflow:auto;max-height:240px}.mail-merge-dialog table{border-collapse:collapse;width:100%;font-size:12px}.mail-merge-dialog th,.mail-merge-dialog td{padding:6px;border-bottom:1px solid #ccd5e1;text-align:left;max-width:200px;overflow-wrap:anywhere}.mail-merge-dialog .merge-check{display:flex;flex-direction:row;align-items:center;gap:8px}.mail-merge-dialog .merge-preview{height:320px;min-height:180px;display:block;border:1px solid #ccd5e1}.mail-merge-dialog .merge-error{overflow-wrap:anywhere}.mail-merge-dialog textarea{min-height:100px}.mail-merge-dialog .merge-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.mail-merge-dialog summary{cursor:pointer;font-weight:600}`;
  const guard = () => {
    if (
      !host.IsCurrent() ||
      !dialog.isConnected ||
      !dialog.open ||
      editor.Document !== original ||
      original.Revision !== revision ||
      editor.IsReadOnly
    )
      throw new Error(
        "The template changed or became read-only. Reopen mail merge.",
      );
  };
  const error = element("p");
  error.className = "merge-error";
  error.setAttribute("role", "alert");
  const safe = (action: () => void) => {
    try {
      guard();
      action();
      error.textContent = "";
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const button = (label: string, action: () => void) => {
    const b = element("button", label);
    b.type = "button";
    b.onclick = () => safe(action);
    return b;
  };
  const label = (caption: string, node: HTMLElement) => {
    const l = element("label", caption);
    l.append(node);
    node.setAttribute("aria-label", caption);
    return l;
  };
  const select = (caption: string, values: string[], value = "") => {
    const s = element("select");
    s.setAttribute("aria-label", caption);
    values.forEach((v) => {
      const o = element("option", v || "None");
      o.value = v;
      s.append(o);
    });
    s.value = value || values[0]!;
    return s;
  };
  const input = (caption: string, type = "text", value = "") => {
    const i = element("input");
    i.type = type;
    i.value = value;
    i.setAttribute("aria-label", caption);
    return i;
  };
  const source = element("fieldset"),
    sourceText = element("textarea");
  source.append(element("legend", "1. Recipient data"));
  sourceText.name = "records";
  sourceText.value = JSON.stringify(
    initial ?? [
      { Name: "Ada", Team: "Research", Amount: 150 },
      { Name: "Grace", Team: "Operations", Amount: 270 },
    ],
    null,
    2,
  );
  const format = select("Source format", ["JSON", "CSV", "TSV", "Semicolon"]);
  const file = input("Open local recipient file", "file");
  file.accept = ".json,.csv,.tsv,.txt,text/csv,text/plain,application/json";
  const sourceRow = element("div");
  sourceRow.className = "merge-row";
  sourceRow.append(
    label("Source format", format),
    label("Open local recipient file", file),
  );
  source.append(
    sourceRow,
    label("Recipient records", sourceText),
    element(
      "p",
      "Data stays in this dialog. No recipient list is saved to the template or sent to a service.",
    ),
  );
  const query = element("fieldset");
  query.hidden = true;
  query.append(element("legend", "2. Filter, sort and select"));
  const filters: {
    field: HTMLSelectElement;
    op: HTMLSelectElement;
    type: HTMLSelectElement;
    value: HTMLInputElement;
  }[] = [];
  const sorts: {
    field: HTMLSelectElement;
    type: HTMLSelectElement;
    direction: HTMLSelectElement;
  }[] = [];
  const match = select("Match filters", ["All", "Any"]);
  const locale = input("Comparison locale", "text", "en");
  const caseSensitive = input("Case-sensitive text", "checkbox");
  const first = input("First query record", "number", "1"),
    last = input("Last query record", "number");
  first.min = last.min = "1";
  const strict = input("Reject unresolved fields", "checkbox");
  strict.checked = true;
  const settings = element("div");
  settings.className = "merge-row";
  settings.append(
    label("Match filters", match),
    label("Comparison locale", locale),
    label("First query record", first),
    label("Last query record", last),
  );
  query.append(settings);
  for (let i = 0; i < 3; i++) {
    const row = element("div");
    row.className = "merge-row";
    const field = select(`Filter ${i + 1} field`, [""]),
      op = select(`Filter ${i + 1} comparison`, [
        "Equal",
        "NotEqual",
        "Less",
        "LessOrEqual",
        "Greater",
        "GreaterOrEqual",
        "Blank",
        "NotBlank",
        "Contains",
        "NotContains",
      ]),
      type = select(`Filter ${i + 1} type`, ["Text", "Number", "Date"]),
      value = input(`Filter ${i + 1} value`);
    filters.push({ field, op, type, value });
    row.append(
      label(`Filter ${i + 1} field`, field),
      label("Comparison", op),
      label("Type", type),
      label("Compare to", value),
    );
    // Preserve unique accessible names despite shorter visual labels.
    op.setAttribute("aria-label", `Filter ${i + 1} comparison`);
    type.setAttribute("aria-label", `Filter ${i + 1} type`);
    value.setAttribute("aria-label", `Filter ${i + 1} value`);
    query.append(row);
  }
  const advanced = element("details");
  advanced.append(element("summary", "Sort records (up to three keys)"));
  for (let i = 0; i < 3; i++) {
    const row = element("div");
    row.className = "merge-row";
    const field = select(`Sort ${i + 1} field`, [""]),
      type = select(`Sort ${i + 1} type`, ["Text", "Number", "Date"]),
      direction = select(`Sort ${i + 1} direction`, [
        "Ascending",
        "Descending",
      ]);
    sorts.push({ field, type, direction });
    row.append(
      label(`Sort ${i + 1} field`, field),
      label("Type", type),
      label("Direction", direction),
    );
    type.setAttribute("aria-label", `Sort ${i + 1} type`);
    direction.setAttribute("aria-label", `Sort ${i + 1} direction`);
    advanced.append(row);
  }
  query.append(advanced);
  for (const [caption, node] of [
    ["Case-sensitive text", caseSensitive],
    ["Reject unresolved fields", strict],
  ] as const) {
    const l = label(caption, node);
    l.className = "merge-check";
    query.append(l);
  }
  const summary = element("p");
  summary.setAttribute("role", "status");
  const tableContainer = element("div");
  tableContainer.className = "merge-table";
  const table = element("table");
  table.setAttribute("aria-label", "Mail merge recipients");
  tableContainer.append(table);
  const actions = element("div");
  actions.className = "merge-actions";
  const previewArea = element("section");
  previewArea.hidden = true;
  const previewSummary = element("p");
  previewSummary.setAttribute("role", "status");
  const previewNumber = input("Preview output record", "number", "1");
  previewNumber.min = "1";
  const viewer = element("flow-document-scroll-viewer");
  viewer.className = "merge-preview";
  viewer.setAttribute("aria-label", "Merged document preview");
  viewer.IsReadOnly = true;
  const diagnostics = element("p");
  diagnostics.setAttribute("role", "status");
  let rows: MailMergeRecord[] = [],
    loadedSource = "",
    loadedFormat = "",
    session: MailMergeSession | undefined;
  let excluded = new Set<number>(),
    tablePage = 0,
    view: ReturnType<typeof createMailMergePlan> | undefined,
    fileGeneration = 0;
  const invalidate = () => {
    session = undefined;
    generate.disabled = true;
    summary.textContent =
      "Apply the current recipient query before previewing or generating.";
    previewArea.hidden = true;
  };
  sourceText.addEventListener("input", invalidate);
  format.addEventListener("change", invalidate);
  query.addEventListener("input", invalidate);
  query.addEventListener("change", invalidate);
  const options = (): MailMergeOptions => ({
    Locale: locale.value,
    CaseSensitive: caseSensitive.checked,
    Match: match.value as "All" | "Any",
    Filters: filters
      .filter((f) => f.field.value)
      .map((f) => ({
        Field: f.field.value,
        Operator: f.op.value as MailMergeCondition["Operator"],
        Type: f.type.value as MailMergeCondition["Type"],
        Value: f.value.value,
      })),
    Sort: sorts
      .filter((s) => s.field.value)
      .map((s) => ({
        Field: s.field.value,
        Type: s.type.value as MailMergeSort["Type"],
        Descending: s.direction.value === "Descending",
      })),
    FirstRecord: Number(first.value),
    ...(last.value ? { LastRecord: Number(last.value) } : {}),
    FailOnUnresolved: strict.checked,
  });
  const ensureLoaded = () => {
    if (loadedSource !== sourceText.value || loadedFormat !== format.value)
      throw new Error(
        "Load recipients again after editing the source or its format.",
      );
  };
  const preview = () => {
    ensureLoaded();
    if (!session) throw new Error("Apply the recipient query first.");
    const result = session.Preview(Number(previewNumber.value));
    viewer.Document = result.Document;
    previewArea.hidden = false;
    previewSummary.textContent = `Output ${result.Recipient.SequenceNumber} of ${session.Count} · Query record ${result.Recipient.RecordNumber} · Source row ${result.Recipient.SourceRecord}`;
    diagnostics.textContent = result.Fields.Unresolved.length
      ? `${result.Fields.Unresolved.length} unresolved fields: ${result.Fields.Unresolved.map(
          (f) => f.Reason,
        )
          .slice(0, 3)
          .join("; ")}`
      : "All fields resolved. The source template is unchanged.";
  };
  const createSession = () => {
    ensureLoaded();
    session = new DocumentFeatures(editor.Engine).CreateMailMergeSession(rows, {
      ...options(),
      Exclude: [...excluded],
    });
    generate.disabled = !session.Count;
    summary.textContent = `${session.Count} selected · ${view?.MatchedRecords ?? 0} matched · ${rows.length} source records. Blank sort keys appear last.`;
    previewNumber.max = String(session.Count);
    previewNumber.value = String(
      Math.max(1, Math.min(Number(previewNumber.value) || 1, session.Count)),
    );
    if (session.Count) preview();
    else previewArea.hidden = true;
  };
  const renderRows = () => {
    table.replaceChildren();
    if (!view) return;
    const header = element("tr");
    header.append(element("th", "Include"), element("th", "Record / source"));
    for (const name of view.Fields.slice(0, 8))
      header.append(element("th", name));
    const thead = element("thead");
    thead.append(header);
    table.append(thead);
    const body = element("tbody");
    table.append(body);
    tablePage = Math.max(
      0,
      Math.min(tablePage, Math.ceil(view.Recipients.length / 50) - 1),
    );
    for (const recipient of view.Recipients.slice(
      tablePage * 50,
      (tablePage + 1) * 50,
    )) {
      const tr = element("tr"),
        cell = element("td"),
        checkbox = input(
          `Include source row ${recipient.SourceRecord}`,
          "checkbox",
        );
      checkbox.checked = !excluded.has(recipient.SourceRecord);
      checkbox.onchange = () =>
        safe(() => {
          if (!session)
            throw new Error(
              "Apply the query before changing recipient selection.",
            );
          if (checkbox.checked) excluded.delete(recipient.SourceRecord);
          else excluded.add(recipient.SourceRecord);
          createSession();
        });
      cell.append(checkbox);
      tr.append(
        cell,
        element("td", `${recipient.RecordNumber} / ${recipient.SourceRecord}`),
      );
      for (const name of view.Fields.slice(0, 8))
        tr.append(
          element("td", String(recipient.Data[name] ?? "").slice(0, 300)),
        );
      body.append(tr);
    }
    pageLabel.textContent = `Recipient page ${tablePage + 1} of ${Math.max(1, Math.ceil(view.Recipients.length / 50))}${view.Fields.length > 8 ? " (first eight columns shown)" : ""}`;
  };
  const applyQuery = () => {
    session = undefined;
    generate.disabled = true;
    ensureLoaded();
    view = createMailMergePlan(rows, options());
    tablePage = 0;
    renderRows();
    createSession();
  };
  const load = button("Load recipients", () => {
    invalidate();
    rows =
      format.value === "JSON"
        ? validateMailMergeRecords(JSON.parse(sourceText.value))
        : parseMailMergeDelimited(
            sourceText.value,
            format.value === "TSV"
              ? "\t"
              : format.value === "Semicolon"
                ? ";"
                : ",",
          );
    const names = createMailMergePlan(rows).Fields;
    for (const s of [
      ...filters.map((f) => f.field),
      ...sorts.map((s) => s.field),
    ]) {
      s.replaceChildren();
      for (const name of ["", ...names]) {
        const o = element("option", name || "None");
        o.value = name;
        s.append(o);
      }
    }
    excluded = new Set();
    first.value = "1";
    last.value = "";
    loadedSource = sourceText.value;
    loadedFormat = format.value;
    query.hidden = false;
    applyQuery();
  });
  source.append(load);
  file.onchange = async () => {
    const generation = ++fileGeneration;
    invalidate();
    try {
      guard();
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 4000000)
        throw new RangeError("Recipient file is too large (four MB maximum).");
      const text = await selected.text();
      guard();
      if (generation !== fileGeneration) return;
      sourceText.value = text;
      format.value = /\.json$/i.test(selected.name)
        ? "JSON"
        : /\.tsv$/i.test(selected.name)
          ? "TSV"
          : "CSV";
      summary.textContent =
        "Local file loaded. Select Load recipients to validate it.";
    } catch (e) {
      if (generation === fileGeneration && dialog.open)
        error.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const pageLabel = element("span");
  actions.append(
    button("Apply query", applyQuery),
    button("Select all matched", () => {
      ensureLoaded();
      if (!session || !view) throw new Error("Apply query first.");
      for (const r of view.Recipients) excluded.delete(r.SourceRecord);
      renderRows();
      createSession();
    }),
    button("Clear matched", () => {
      ensureLoaded();
      if (!session || !view) throw new Error("Apply query first.");
      for (const r of view.Recipients) excluded.add(r.SourceRecord);
      renderRows();
      createSession();
    }),
    button("Previous recipients", () => {
      if (tablePage > 0) tablePage--;
      renderRows();
    }),
    button("Next recipients", () => {
      tablePage++;
      renderRows();
    }),
    pageLabel,
  );
  const navigation = element("div");
  navigation.className = "merge-actions";
  navigation.append(
    label("Preview output record", previewNumber),
    button("Preview record", preview),
    button("Previous preview", () => {
      previewNumber.value = String(
        Math.max(1, Number(previewNumber.value) - 1),
      );
      preview();
    }),
    button("Next preview", () => {
      previewNumber.value = String(
        Math.min(session?.Count ?? 0, Number(previewNumber.value) + 1),
      );
      preview();
    }),
  );
  previewArea.append(
    element("h3", "3. Preview results"),
    navigation,
    previewSummary,
    viewer,
    diagnostics,
  );
  const generate = button("Generate documents", () => {
    ensureLoaded();
    if (!session || !session.Count)
      throw new Error("No recipients are selected.");
    const documents = session.Generate();
    guard();
    host.Generated(documents);
    dialog.close();
  });
  generate.className = "primary";
  generate.disabled = true;
  const close = element("button", "Close");
  close.type = "button";
  close.onclick = () => dialog.close();
  const footer = element("div");
  footer.className = "merge-actions";
  footer.append(close, generate);
  dialog.append(
    css,
    element("h2", "Mail merge recipients"),
    source,
    query,
    error,
    actions,
    summary,
    tableContainer,
    previewArea,
    footer,
  );
  dialog.addEventListener(
    "close",
    () => {
      fileGeneration++;
      rows = [];
      view = undefined;
      session = undefined;
      excluded.clear();
      sourceText.value = "";
      viewer.Dispose();
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
}
