import type { RichTextBox } from "./control.js";
import type {
  ContentControlInfo,
  ContentControlKind,
  ContentControlOptions,
} from "./content-controls.js";
import { FlowDocument, Paragraph } from "./model.js";

export const contentControlCommands = [
  "InsertContentControl",
  "ContentControlProperties",
  "EditContentControl",
  "RemoveContentControl",
  "FormData",
  "FillForm",
  "ValidateForm",
] as const;
interface FormField {
  name: string;
  label: string;
  value: string;
  type?: string;
  options?: (string | { Value: string; Label: string })[];
}
interface FormHost {
  Editor: RichTextBox;
  IsCurrent(): boolean;
  CreateDialog(): HTMLDialogElement;
  Prompt(
    title: string,
    fields: FormField[],
    submit: (values: Record<string, string>) => unknown,
  ): void;
  Refresh(): void;
}
const yesNo = ["No", "Yes"];
const signature = (c: ContentControlInfo) =>
  JSON.stringify([c.Properties, c.Content]);
/** Shared toolbar dialogs. No sample state, global document or external form service is required. */
export function executeContentControlCommand(
  command: string,
  parameter: unknown,
  host: FormHost,
): boolean {
  if (!(contentControlCommands as readonly string[]).includes(command))
    return false;
  const editor = host.Editor,
    engine = editor.Engine,
    owner = editor.ownerDocument,
    original = editor.Document;
  const current = () => {
    if (!host.IsCurrent() || editor.Document !== original || editor.IsReadOnly)
      throw new Error("The target document changed or became read-only.");
  };
  const mutate = (action: () => void) => {
    current();
    action();
    editor.Focus();
    host.Refresh();
  };
  const selected = () => {
    const info =
      typeof parameter === "string"
        ? engine.GetContentControls().find((c) => c.Id === parameter)
        : engine.GetSelectedContentControl();
    if (!info) throw new Error("Select a content control first.");
    return info;
  };
  const guard = (info: ContentControlInfo) => {
    current();
    const actual = engine.GetContentControls().find((c) => c.Id === info.Id);
    if (!actual || signature(actual) !== signature(info))
      throw new Error(
        "This content control changed while its dialog was open. Reopen the dialog to edit the current value.",
      );
  };
  const show = (title: string, value: string) => {
    const dialog = host.CreateDialog(),
      heading = owner.createElement("h2"),
      result = owner.createElement("textarea"),
      close = owner.createElement("button");
    heading.textContent = title;
    result.value = value;
    result.readOnly = true;
    result.setAttribute("aria-label", title);
    result.style.minHeight = "200px";
    close.textContent = "Close";
    close.onclick = () => dialog.close();
    dialog.append(heading, result, close);
    dialog.showModal();
  };
  if (command === "FormData") {
    show("Form data", JSON.stringify(engine.GetFormData(), null, 2));
    return true;
  }
  if (command === "ValidateForm") {
    const issues = engine.ValidateForm();
    show(
      "Form validation",
      issues.length
        ? issues.map((i) => i.Message).join("\n")
        : "All required form values are present.",
    );
    return true;
  }
  if (editor.IsReadOnly) return true;
  if (command === "InsertContentControl") {
    const revision = original.Revision,
      start = engine.Selection.Start.Offset,
      end = engine.Selection.End.Offset;
    host.Prompt(
      "Insert content control",
      [
        {
          name: "kind",
          label: "Control type",
          value: "PlainText",
          options: [
            "PlainText",
            "RichText",
            "CheckBox",
            "DropDownList",
            "ComboBox",
            "Date",
          ],
        },
        {
          name: "level",
          label: "Placement",
          value: "Inline",
          options: ["Inline", "Block"],
        },
        { name: "title", label: "Title", value: "" },
        { name: "tag", label: "Data tag", value: "" },
        {
          name: "placeholder",
          label: "Placeholder",
          value: "Click or tap here to enter text.",
        },
        {
          name: "value",
          label: "Initial value (checkbox: true or false; date: YYYY-MM-DD)",
          value: engine.Selection.Text,
        },
        {
          name: "items",
          label: "Choice items as JSON",
          type: "textarea",
          value:
            '[{"DisplayText":"Option A","Value":"a"},{"DisplayText":"Option B","Value":"b"}]',
        },
        {
          name: "required",
          label: "Required value",
          value: "No",
          options: yesNo,
        },
        {
          name: "multiline",
          label: "Allow multiple lines (text controls)",
          value: "No",
          options: yesNo,
        },
      ],
      (data) =>
        mutate(() => {
          if (original.Revision !== revision)
            throw new Error(
              "The document changed while the insertion dialog was open.",
            );
          const options: ContentControlOptions = {
            Kind: data.kind as ContentControlKind,
            Level: data.level as "Inline" | "Block",
            Title: data.title,
            Tag: data.tag,
            Placeholder: data.placeholder,
            Required: data.required === "Yes",
          };
          if (["DropDownList", "ComboBox"].includes(options.Kind))
            options.Items = JSON.parse(data.items);
          if (["PlainText", "RichText"].includes(options.Kind))
            options.Multiline =
              data.multiline === "Yes" || options.Kind === "RichText";
          if (
            options.Kind === "CheckBox" &&
            data.value !== "" &&
            !["true", "false"].includes(data.value)
          )
            throw new Error("Checkbox values must be true or false.");
          engine.Select(start, end);
          engine.InsertContentControl(
            options,
            options.Kind === "CheckBox"
              ? data.value === "true"
              : options.Kind === "RichText" &&
                  data.value === engine.Selection.Text
                ? undefined
                : data.value,
          );
        }),
    );
    return true;
  }
  if (command === "FillForm") {
    const before = JSON.stringify(engine.GetContentControls().map(signature));
    host.Prompt(
      "Fill form",
      [
        {
          name: "data",
          label: "Values by data tag (JSON object)",
          type: "textarea",
          value: JSON.stringify(engine.GetFormData(), null, 2),
        },
      ],
      (data) =>
        mutate(() => {
          if (
            JSON.stringify(engine.GetContentControls().map(signature)) !==
            before
          )
            throw new Error("Form controls changed while the dialog was open.");
          engine.FillForm(JSON.parse(data.data));
        }),
    );
    return true;
  }
  const info = selected(),
    p = info.Properties;
  if (command === "RemoveContentControl") {
    mutate(() => engine.RemoveContentControl(info.Id));
    return true;
  }
  if (command === "ContentControlProperties") {
    const fields: FormField[] = [
      { name: "title", label: "Title", value: p.Title ?? "" },
      { name: "tag", label: "Data tag", value: p.Tag ?? "" },
      {
        name: "placeholder",
        label: "Placeholder",
        value: p.Placeholder ?? "Click or tap here to enter text.",
      },
      {
        name: "lockControl",
        label: "Control cannot be deleted",
        value: p.LockContentControl ? "Yes" : "No",
        options: yesNo,
      },
      {
        name: "lockContents",
        label: "Contents cannot be edited",
        value: p.LockContents ? "Yes" : "No",
        options: yesNo,
      },
      {
        name: "required",
        label: "Required value",
        value: p.Required ? "Yes" : "No",
        options: yesNo,
      },
    ];
    if (["PlainText", "RichText"].includes(p.Kind))
      fields.push(
        {
          name: "maximum",
          label: "Maximum characters (blank for no application limit)",
          value: String(p.MaxLength ?? ""),
          type: "number",
        },
        {
          name: "multiline",
          label: "Allow multiple lines",
          value: p.Multiline ? "Yes" : "No",
          options: yesNo,
        },
      );
    if (p.Kind === "Date")
      fields.push(
        {
          name: "format",
          label: "Date display format",
          value: p.DateFormat ?? "yyyy-MM-dd",
        },
        {
          name: "locale",
          label: "Date language",
          value: p.DateLocale ?? "en-US",
        },
      );
    if (["DropDownList", "ComboBox"].includes(p.Kind))
      fields.push({
        name: "items",
        label: "Choice items as JSON",
        type: "textarea",
        value: JSON.stringify(p.Items ?? [], null, 2),
      });
    host.Prompt("Content control properties", fields, (data) =>
      mutate(() => {
        guard(info);
        const patch: Partial<ContentControlOptions> = {
          Title: data.title,
          Tag: data.tag,
          Placeholder: data.placeholder,
          LockContentControl: data.lockControl === "Yes",
          LockContents: data.lockContents === "Yes",
          Required: data.required === "Yes",
        };
        if (data.maximum !== undefined) {
          patch.MaxLength =
            data.maximum === "" ? undefined : Number(data.maximum);
          patch.Multiline = data.multiline === "Yes";
        }
        if (data.format !== undefined) {
          patch.DateFormat = data.format;
          patch.DateLocale = data.locale;
        }
        if (data.items !== undefined) patch.Items = JSON.parse(data.items);
        engine.SetContentControlProperties(info.Id, patch);
      }),
    );
    return true;
  }
  if (p.LockContents)
    throw new Error(
      "This control's contents are locked. Change its properties before editing.",
    );
  if (p.Kind !== "RichText") {
    const field: FormField = {
      name: "value",
      label: p.Title || p.Tag || "Value",
      value: String(info.Value),
    };
    if (p.Kind === "Date") field.type = "date";
    else if (p.Kind === "CheckBox")
      field.options = [
        { Value: "false", Label: "Unchecked" },
        { Value: "true", Label: "Checked" },
      ];
    else if (p.Kind === "DropDownList")
      field.options = [
        { Value: "", Label: p.Placeholder || "Choose an item" },
        ...(p.Items ?? []).map((i) => ({
          Value: i.Value,
          Label: i.DisplayText,
        })),
      ];
    else if (p.Multiline) field.type = "textarea";
    host.Prompt("Edit content control", [field], (data) =>
      mutate(() => {
        guard(info);
        engine.SetContentControlValue(
          info.Id,
          p.Kind === "CheckBox" ? data.value === "true" : data.value,
        );
      }),
    );
    return true;
  }
  const dialog = host.CreateDialog();
  dialog.style.width = "min(960px,96vw)";
  const title = owner.createElement("h2");
  title.textContent = `Edit ${p.Title || "rich content control"}`;
  const nested = owner.createElement("rich-text-box"),
    toolbar = owner.createElement("rich-text-toolbar");
  nested.ViewMode = "continuous";
  nested.style.cssText =
    "display:block;height:300px;border:1px solid var(--rt-toolbar-border,#ccd5e1)";
  nested.setAttribute("aria-label", "Content control draft");
  nested.setAttribute("theme", editor.getAttribute("theme") || "light");
  nested.Document = info.Properties.ShowingPlaceholder
    ? new FlowDocument(new Paragraph())
    : FlowDocument.FromJSON({
        type: "FlowDocument",
        id: "content-control-draft",
        props: {},
        children:
          p.Level === "Block"
            ? info.Content
            : [
                {
                  type: "Paragraph",
                  id: "content-control-paragraph",
                  props: {},
                  children: info.Content,
                },
              ],
      });
  toolbar.Mode = "home";
  toolbar.Editor = nested;
  const insert = owner.createElement("div");
  insert.className = "group";
  for (const name of p.Level === "Block"
    ? ["Table", "Field", "Equation", "Image", "Link"]
    : ["Field", "Equation", "Image", "Link"]) {
    const b = owner.createElement("button");
    b.textContent = name;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => toolbar.Execute(name);
    insert.append(b);
  }
  const status = owner.createElement("p");
  status.setAttribute("role", "alert");
  const actions = owner.createElement("div");
  actions.className = "actions";
  const cancel = owner.createElement("button"),
    apply = owner.createElement("button");
  cancel.textContent = "Cancel";
  cancel.onclick = () => dialog.close();
  apply.textContent = "Apply";
  apply.className = "primary";
  apply.onclick = () => {
    try {
      guard(info);
      const blocks = nested.Document.ToJSON().children!;
      if (
        p.Level === "Inline" &&
        (blocks.length !== 1 || blocks[0].type !== "Paragraph")
      )
        throw new Error(
          "An inline control draft must contain a single paragraph. Use a block control for multiple paragraphs or tables.",
        );
      mutate(() =>
        engine.SetContentControlContent(
          info.Id,
          p.Level === "Block" ? blocks : blocks[0].children!,
        ),
      );
      dialog.close();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  };
  actions.append(cancel, apply);
  dialog.append(title, toolbar, insert, nested, status, actions);
  dialog.addEventListener(
    "close",
    () => {
      toolbar.Dispose();
      nested.Dispose();
    },
    { once: true },
  );
  dialog.showModal();
  nested.Focus();
  return true;
}
