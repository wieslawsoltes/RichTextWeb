import type { RichTextBox } from "./control.js";
import {
  characterStyleProperties,
  paragraphStyleProperties,
  type DocumentStyle,
  type DocumentStyleKind,
} from "./document-styles.js";
interface Field {
  name: string;
  label: string;
  value: string;
  type?: string;
  options?: (string | { Value: string; Label: string })[];
}
interface Host {
  Editor: RichTextBox;
  IsCurrent(): boolean;
  CreateDialog(): HTMLDialogElement;
  Prompt(
    title: string,
    fields: Field[],
    submit: (data: Record<string, string>) => unknown,
  ): void;
  Refresh(): void;
}
const inherit = { Value: "", Label: "Inherit" };
const options: Record<string, string[]> = {
  FontWeight: ["Normal", "Bold"],
  FontStyle: ["Normal", "Italic"],
  TextDecorations: ["None", "Underline"],
  BaselineAlignment: ["Baseline", "Superscript", "Subscript"],
  TextAlignment: ["Left", "Center", "Right", "Justify"],
  FlowDirection: ["LeftToRight", "RightToLeft"],
  HeadingLevel: ["0", "1", "2", "3", "4", "5", "6"],
  BreakPageBefore: ["true", "false"],
  KeepTogether: ["true", "false"],
  KeepWithNext: ["true", "false"],
};
const numbers = new Set([
  "FontSize",
  "LineHeight",
  "TextIndent",
  "HeadingLevel",
]);
/** Reusable named-style manager; the editor's engine is the sole source of definitions and edits. */
export function executeDocumentStyleCommand(
  command: string,
  host: Host,
): boolean {
  if (
    ![
      "DocumentStyles",
      "CreateStyleFromSelection",
      "ClearDirectFormatting",
    ].includes(command)
  )
    return false;
  const editor = host.Editor,
    engine = editor.Engine,
    original = editor.Document,
    revision = original.Revision;
  const selection = engine.CaptureSelectionState(),
    styles = engine.GetDocumentStyles(),
    owner = editor.ownerDocument;
  const guard = () => {
    if (
      !host.IsCurrent() ||
      editor.Document !== original ||
      original.Revision !== revision ||
      editor.IsReadOnly
    )
      throw new Error(
        "The document changed or became read-only. Reopen the styles dialog.",
      );
  };
  const apply = (action: () => void) => {
    guard();
    engine.RestoreSelectionState(selection);
    action();
    editor.Focus();
    host.Refresh();
  };
  const uniqueId = () => {
    let i = 1;
    while (styles.some((s) => s.Id === `Style${i}`)) i++;
    return `Style${i}`;
  };
  const createFromSelection = () =>
    host.Prompt(
      "Create style from selection",
      [
        { name: "id", label: "Style identifier", value: uniqueId() },
        { name: "name", label: "Style name", value: "Selection style" },
        {
          name: "kind",
          label: "Style kind",
          value: "Paragraph",
          options: ["Paragraph", "Character"],
        },
      ],
      (data) =>
        apply(() => {
          if (styles.some((s) => s.Id === data.id))
            throw new Error("A style with this identifier already exists.");
          engine.CreateDocumentStyleFromSelection(
            data.id,
            data.name,
            data.kind as DocumentStyleKind,
          );
        }),
    );
  if (command === "CreateStyleFromSelection") {
    if (!editor.IsReadOnly) createFromSelection();
    return true;
  }
  if (command === "ClearDirectFormatting") {
    if (!editor.IsReadOnly) apply(() => engine.ClearDirectFormatting());
    return true;
  }
  const edit = (
    style?: DocumentStyle,
    kind: DocumentStyleKind = "Paragraph",
  ) => {
    kind = style?.Kind ?? kind;
    const references = [
      { Value: "", Label: "None" },
      ...styles
        .filter((s) => s.Kind === kind && s.Id !== style?.Id)
        .map((s) => ({ Value: s.Id, Label: s.Name })),
    ];
    const fields: Field[] = [
      {
        name: "id",
        label: style ? "Style identifier (unchanged)" : "Style identifier",
        value: style?.Id ?? uniqueId(),
      },
      { name: "name", label: "Style name", value: style?.Name ?? "New style" },
      {
        name: "basedOn",
        label: "Based on",
        value: style?.BasedOn ?? "",
        options: references,
      },
    ];
    if (kind === "Paragraph")
      fields.push(
        {
          name: "next",
          label: "Following paragraph style",
          value: style?.Next ?? "",
          options: [
            { Value: "", Label: "Same style" },
            ...styles
              .filter((s) => s.Kind === "Paragraph")
              .map((s) => ({ Value: s.Id, Label: s.Name })),
          ],
        },
        {
          name: "default",
          label: "Default paragraph style",
          value: style?.IsDefault ? "Yes" : "No",
          options: ["No", "Yes"],
        },
      );
    for (const key of kind === "Paragraph"
      ? paragraphStyleProperties
      : characterStyleProperties) {
      const value = style?.Properties[key];
      fields.push({
        name: key,
        label:
          key.replace(/([a-z])([A-Z])/g, "$1 $2") +
          (key === "Margin" ? " (number or JSON sides; blank inherits)" : ""),
        value:
          value === undefined
            ? ""
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value),
        ...(options[key]
          ? {
              options: [
                inherit,
                ...options[key].map((v) => ({ Value: v, Label: v })),
              ],
            }
          : numbers.has(key)
            ? { type: "number" }
            : {}),
      });
    }
    host.Prompt(
      style ? "Modify document style" : `New ${kind.toLowerCase()} style`,
      fields,
      (data) =>
        apply(() => {
          if (!style && styles.some((s) => s.Id === data.id))
            throw new Error(
              "A style with this identifier already exists. Use Modify style instead.",
            );
          if (style && data.id !== style.Id)
            throw new Error(
              "Style identifiers cannot be changed. Create a new style instead.",
            );
          const properties: Record<string, any> = {};
          for (const key of kind === "Paragraph"
            ? paragraphStyleProperties
            : characterStyleProperties) {
            const v = data[key]?.trim();
            if (!v) continue;
            properties[key] = numbers.has(key)
              ? Number(v)
              : ["BreakPageBefore", "KeepTogether", "KeepWithNext"].includes(
                    key,
                  )
                ? v === "true"
                : key === "Margin"
                  ? JSON.parse(v)
                  : v;
          }
          const next: DocumentStyle = {
            Id: data.id,
            Name: data.name,
            Kind: kind,
            Properties: properties,
          };
          if (data.basedOn) next.BasedOn = data.basedOn;
          if (kind === "Paragraph") {
            if (data.next) next.Next = data.next;
            if (data.default === "Yes") next.IsDefault = true;
          }
          const catalog = styles
            .filter((s) => s.Id !== next.Id)
            .map((s) => (next.IsDefault ? { ...s, IsDefault: false } : s));
          engine.SetDocumentStyles([...catalog, next]);
        }),
    );
  };
  const dialog = host.CreateDialog(),
    title = owner.createElement("h2"),
    list = owner.createElement("select"),
    preview = owner.createElement("p"),
    details = owner.createElement("p"),
    status = owner.createElement("p"),
    actions = owner.createElement("div");
  title.textContent = "Document styles";
  list.size = 7;
  list.style.maxWidth = "100%";
  list.style.width = "100%";
  list.setAttribute("aria-label", "Document styles");
  for (const s of styles) {
    const option = owner.createElement("option");
    option.value = s.Id;
    option.textContent = `${s.Name} · ${s.Kind}${s.IsDefault ? " · Default" : ""}`;
    list.append(option);
  }
  preview.textContent = "The quick brown fox — AaBbCc 0123";
  preview.setAttribute("aria-label", "Style preview");
  preview.style.padding = "16px";
  details.className = "muted";
  status.setAttribute("role", "alert");
  const selected = () => styles.find((s) => s.Id === list.value);
  const refresh = () => {
    const s = selected(),
      p = s ? engine.ResolveDocumentStyle(s.Id) : {};
    preview.style.fontFamily = p.FontFamily ?? "";
    preview.style.fontSize = `${Math.min(p.FontSize ?? 18, 48)}px`;
    preview.style.fontWeight = p.FontWeight ?? "";
    preview.style.fontStyle = p.FontStyle ?? "";
    preview.style.color = p.Foreground ?? "";
    preview.style.backgroundColor = p.Background ?? "";
    details.textContent = s
      ? `Id: ${s.Id}. Based on: ${s.BasedOn ?? "none"}. Next: ${s.Next ?? "same style"}. Direct formatting takes precedence.`
      : "Create a paragraph or character style to begin.";
  };
  const button = (
    text: string,
    action: () => void,
    mutation = true,
    needsSelection = false,
  ) => {
    const b = owner.createElement("button");
    b.textContent = text;
    b.disabled =
      (mutation && editor.IsReadOnly) || (needsSelection && !styles.length);
    b.onclick = () => {
      try {
        if (mutation) guard();
        action();
      } catch (error) {
        status.textContent = (error as Error).message;
      }
    };
    actions.append(b);
  };
  button(
    "Apply style",
    () => {
      const s = selected();
      if (!s) return;
      apply(() =>
        s.Kind === "Paragraph"
          ? engine.ApplyParagraphStyle(s.Id)
          : engine.ApplyCharacterStyle(s.Id),
      );
      dialog.close();
    },
    true,
    true,
  );
  button("New paragraph style", () => {
    dialog.close();
    edit();
  });
  button("New character style", () => {
    dialog.close();
    edit(undefined, "Character");
  });
  button("From selection", () => {
    dialog.close();
    createFromSelection();
  });
  button(
    "Modify style",
    () => {
      const s = selected();
      if (s) {
        dialog.close();
        edit(s);
      }
    },
    true,
    true,
  );
  button(
    "Update from selection",
    () => {
      const s = selected();
      if (!s) return;
      apply(() => engine.UpdateDocumentStyleFromSelection(s.Id));
      dialog.close();
    },
    true,
    true,
  );
  button(
    "Delete style",
    () => {
      const s = selected();
      if (!s) return;
      dialog.close();
      host.Prompt(
        "Delete document style",
        [
          {
            name: "replacement",
            label: `Replace ${s.Name} with`,
            value: "",
            options: [
              { Value: "", Label: "None (unused styles only)" },
              ...styles
                .filter((x) => x.Kind === s.Kind && x.Id !== s.Id)
                .map((x) => ({ Value: x.Id, Label: x.Name })),
            ],
          },
        ],
        (data) =>
          apply(() =>
            engine.RemoveDocumentStyle(s.Id, data.replacement || undefined),
          ),
      );
    },
    true,
    true,
  );
  button("Close", () => dialog.close(), false);
  list.onchange = refresh;
  dialog.append(title, list, preview, details, status, actions);
  if (styles.length) list.value = styles[0].Id;
  refresh();
  dialog.showModal();
  return true;
}
