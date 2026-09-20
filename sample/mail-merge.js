/** A local-only merge template and sample data; no application-specific merge engine. */
export const mailMergeExampleRecords = [
  {
    Name: "Ada",
    Team: "Research",
    City: "Warsaw",
    Amount: 150,
    Due: "2026-10-15",
  },
  {
    Name: "Grace",
    Team: "Operations",
    City: "London",
    Amount: 270,
    Due: "2026-10-18",
  },
  {
    Name: "Katherine",
    Team: "Research",
    City: "Warsaw",
    Amount: 420,
    Due: "2026-10-21",
  },
  {
    Name: "Alan",
    Team: "Research",
    City: "Manchester",
    Amount: 95,
    Due: "2026-10-24",
  },
];
export function createMailMergeSample(RT) {
  const f = (code, cache) => RT.createFieldFromInstruction(code, cache);
  const document = new RT.FlowDocument([
    new RT.Paragraph("Project invitations"),
    new RT.Paragraph(
      "Open Mailings → Recipients & preview. The four example recipients can be filtered by team, sorted by amount, selected individually and previewed without changing this template.",
    ),
    new RT.Paragraph([
      new RT.Run("Dear "),
      f("MERGEFIELD Name", "«Name»"),
      new RT.Run(","),
    ]),
    new RT.Paragraph([
      new RT.Run("Your "),
      f("MERGEFIELD Team", "«Team»"),
      new RT.Run(" briefing is scheduled in "),
      f("MERGEFIELD City", "«City»"),
      new RT.Run("."),
    ]),
    new RT.Paragraph([
      new RT.Run("Contribution: "),
      f('MERGEFIELD Amount \\# "#,##0.00" \\b "$"', "«Amount»"),
      new RT.Run(". Due date: "),
      f("MERGEFIELD Due", "«Due»"),
      new RT.Run("."),
    ]),
    new RT.Paragraph([
      f(
        'IF Amount >= 200 "A detailed project pack is included." "A starter project pack is included."',
        "«Conditional message»",
      ),
    ]),
    new RT.Paragraph([
      new RT.Run("Query record "),
      f("MERGEREC", "?"),
      new RT.Run(" · Output "),
      f("MERGESEQ", "?"),
    ]),
    new RT.Paragraph("Regards,\nDocument Studio"),
  ]);
  document.PagePadding = new RT.Thickness(56);
  document.SetValue("Title", "Personalized project invitations");
  const engine = new RT.RichTextEngine(document);
  engine.SetDocumentTheme(RT.createDocumentTheme("Studio"));
  engine.SetDocumentStyles([
    {
      Id: "InvitationBody",
      Name: "Invitation body",
      Kind: "Paragraph",
      IsDefault: true,
      Properties: {
        FontFamily: RT.themeFont("Minor"),
        FontSize: 17,
        Margin: { Bottom: 16 },
        LineHeight: 26,
      },
    },
    {
      Id: "InvitationTitle",
      Name: "Invitation title",
      Kind: "Paragraph",
      BasedOn: "InvitationBody",
      Properties: {
        FontSize: 32,
        FontWeight: "Bold",
        Foreground: RT.themeColor("accent1"),
        HeadingLevel: 1,
      },
    },
  ]);
  engine.Select(0);
  engine.ApplyParagraphStyle("InvitationTitle");
  engine.ClearUndo();
  engine.Dispose();
  return document;
}

/** Review explicit generation results before downloading or replacing the source document. */
export function showMailMergeResults(documents, editor, RT) {
  document.getElementById("mail-merge-results")?.close();
  const original = editor.Document,
    revision = original.Revision;
  const dialog = document.createElement("dialog");
  dialog.id = "mail-merge-results";
  dialog.style.cssText =
    "width:min(700px,95vw);max-height:90dvh;overflow:auto;padding:24px;border:1px solid #ccd5e1;border-radius:12px;font:14px system-ui";
  const title = document.createElement("h2");
  title.textContent = `${documents.length} merged documents`;
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Generated document");
  documents.forEach((doc, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `Document ${i + 1} — ${doc.Text.slice(0, 60)}`;
    select.append(option);
  });
  const preview = document.createElement("flow-document-scroll-viewer");
  preview.style.cssText = "display:block;height:350px;margin:16px 0";
  preview.IsReadOnly = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const selected = () => documents[Number(select.value)];
  select.onchange = () => {
    if (selected())
      preview.Document = RT.FlowDocument.FromJSON(selected().ToJSON());
  };
  const download = (bytes, type, filename) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const button = (label, action) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.type = "button";
    b.style.margin = "4px";
    b.onclick = async () => {
      try {
        await action();
      } catch (e) {
        status.textContent = e.message;
      }
    };
    return b;
  };
  dialog.append(
    title,
    select,
    preview,
    status,
    button("Download selected DOCX", async () => {
      const index = Number(select.value),
        doc = selected();
      if (!doc) return;
      const bytes = await RT.toDOCX(doc);
      if (dialog.open)
        download(
          bytes,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          `merged-${index + 1}.docx`,
        );
    }),
    button("Download all as JSON", () =>
      download(
        JSON.stringify(
          documents.map((d) => d.ToJSON()),
          null,
          2,
        ),
        "application/json",
        "merged-documents.json",
      ),
    ),
    button("Open selected document", () => {
      if (editor.IsReadOnly) throw new Error("The editor is read-only.");
      if (editor.Document !== original || original.Revision !== revision)
        throw new Error(
          "The template changed while reviewing results. Download the result instead of replacing it.",
        );
      if (selected())
        editor.Document = RT.FlowDocument.FromJSON(selected().ToJSON());
      dialog.close();
    }),
    button("Close", () => dialog.close()),
  );
  dialog.addEventListener(
    "close",
    () => {
      preview.Dispose();
      dialog.remove();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  select.onchange();
}
