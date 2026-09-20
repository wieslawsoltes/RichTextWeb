/** Headless-buildable form sample using only the public RichTextWeb engine. */
export function createFormsSample(RT) {
  const d = RT.fromHTML(`<h1>Project brief</h1>
        <p>Complete the fields below. Click a placeholder, date, choice or checkbox; double-click rich notes to edit them. Developer → Fill form updates tagged values in one undo step. Export DOCX to retain native content controls.</p>
        <h2>Project details</h2>
        <p><b>Reference:</b> FORM_REFERENCE</p>
        <p><b>Project name:</b> FORM_NAME</p>
        <p><b>Owner:</b> FORM_OWNER</p>
        <p><b>Department:</b> FORM_DEPARTMENT</p>
        <p><b>Target date:</b> FORM_DATE</p>
        <p><b>Delivery channel:</b> FORM_CHANNEL</p>
        <p>FORM_CONSENT I confirm this brief is ready for review.</p>
        <h2>Scope and deliverables</h2><p>FORM_NOTES</p>
        <p>The reference is locked against editing and deletion. Other wrappers are protected from deletion while their values remain editable. Required-field checks are local application rules, not authentication or document encryption.</p>`);
  const engine = new RT.RichTextEngine(d);
  const controls = [
    [
      "FORM_REFERENCE",
      {
        Kind: "PlainText",
        Tag: "reference",
        Title: "Reference",
        LockContentControl: true,
        LockContents: true,
      },
      "BRIEF-001",
    ],
    [
      "FORM_NAME",
      {
        Kind: "PlainText",
        Tag: "project",
        Title: "Project name",
        Placeholder: "Enter project name",
        Required: true,
        MaxLength: 120,
      },
      "",
    ],
    [
      "FORM_OWNER",
      { Kind: "PlainText", Tag: "owner", Title: "Owner", Required: true },
      "Ada Lovelace",
    ],
    [
      "FORM_DEPARTMENT",
      {
        Kind: "DropDownList",
        Tag: "department",
        Title: "Department",
        Items: [
          { DisplayText: "Research & development", Value: "rd" },
          { DisplayText: "Operations", Value: "ops" },
          { DisplayText: "Design", Value: "design" },
        ],
      },
      "rd",
    ],
    [
      "FORM_DATE",
      {
        Kind: "Date",
        Tag: "targetDate",
        Title: "Target date",
        DateFormat: "dd MMMM yyyy",
        DateLocale: "en-GB",
      },
      "2026-10-01",
    ],
    [
      "FORM_CHANNEL",
      {
        Kind: "ComboBox",
        Tag: "channel",
        Title: "Delivery channel",
        Items: [
          { DisplayText: "Web", Value: "web" },
          { DisplayText: "Desktop", Value: "desktop" },
        ],
      },
      "web",
    ],
    [
      "FORM_CONSENT",
      {
        Kind: "CheckBox",
        Tag: "ready",
        Title: "Ready for review",
        Required: true,
      },
      false,
    ],
    [
      "FORM_NOTES",
      {
        Kind: "RichText",
        Level: "Block",
        Tag: "notes",
        Title: "Scope and deliverables",
        Multiline: true,
      },
      "Describe the scope, then add formatting, a table, an equation or an image in the rich draft editor.",
    ],
  ];
  for (const [marker, options, value] of controls) {
    const start = d.Text.indexOf(marker);
    engine.Select(start, start + marker.length);
    engine.InsertContentControl(
      { LockContentControl: true, ...options },
      value,
    );
  }
  d.SetValue("Title", "Fillable project brief");
  engine.Dispose();
  return d;
}
