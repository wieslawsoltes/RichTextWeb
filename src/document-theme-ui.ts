import type { RichTextBox } from "./control.js";
import {
  createDocumentTheme,
  themeColorSlots,
  themeColorRoles,
  themeColor,
  themeFont,
  resolveThemeValue,
  type ThemeColorName,
  type ThemeFontRole,
} from "./document-theme.js";
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
/** Theme authoring uses the same document property/undo pipeline as named styles. */
export function executeDocumentThemeCommand(
  command: string,
  host: Host,
): boolean {
  if (!["DocumentTheme", "ThemeColor", "ThemeFont"].includes(command))
    return false;
  const editor = host.Editor,
    engine = editor.Engine,
    original = editor.Document,
    revision = original.Revision,
    selection = engine.CaptureSelectionState(),
    theme = engine.GetDocumentTheme();
  const guard = () => {
    if (
      !host.IsCurrent() ||
      editor.Document !== original ||
      original.Revision !== revision ||
      editor.IsReadOnly
    )
      throw new Error(
        "The document changed or became read-only. Reopen the theme dialog.",
      );
  };
  const apply = (action: () => void) => {
    guard();
    engine.RestoreSelectionState(selection);
    action();
    editor.Focus();
    host.Refresh();
  };
  if (command === "ThemeColor") {
    if (editor.IsReadOnly) return true;
    host.Prompt(
      "Apply theme color",
      [
        {
          name: "property",
          label: "Apply to",
          value: "Foreground",
          options: ["Foreground", "Background"],
        },
        {
          name: "color",
          label: "Theme color",
          value: "accent1",
          options: [...new Set([...themeColorRoles, ...themeColorSlots])],
        },
        {
          name: "tint",
          label: "Tint byte (0–255; blank for none)",
          value: "",
          type: "number",
        },
        {
          name: "shade",
          label: "Shade byte (0–255; tint takes precedence)",
          value: "",
          type: "number",
        },
      ],
      (data) =>
        apply(() => {
          if (!["Foreground", "Background"].includes(data.property))
            throw new Error("Unsupported theme color property.");
          const options = {
            ...(data.tint.trim() ? { Tint: Number(data.tint) } : {}),
            ...(data.shade.trim() ? { Shade: Number(data.shade) } : {}),
          };
          const token = themeColor(data.color as ThemeColorName, options);
          const fallback = resolveThemeValue(data.property, token, theme);
          engine.ApplyProperty(
            data.property,
            themeColor(data.color as ThemeColorName, {
              ...options,
              Fallback: fallback,
            }),
          );
        }),
    );
    return true;
  }
  if (command === "ThemeFont") {
    if (!editor.IsReadOnly)
      host.Prompt(
        "Apply theme font",
        [
          {
            name: "font",
            label: "Theme font",
            value: "Minor",
            options: [
              { Value: "Major", Label: "Headings (Major)" },
              { Value: "Minor", Label: "Body (Minor)" },
            ],
          },
        ],
        (data) =>
          apply(() =>
            engine.ApplyProperty(
              "FontFamily",
              themeFont(
                data.font as ThemeFontRole,
                theme?.Fonts[data.font as ThemeFontRole] ?? "Arial",
              ),
            ),
          ),
      );
    return true;
  }
  const owner = editor.ownerDocument,
    dialog = host.CreateDialog(),
    title = owner.createElement("h2"),
    select = owner.createElement("select"),
    preview = owner.createElement("div"),
    actions = owner.createElement("div"),
    status = owner.createElement("p"),
    note = owner.createElement("p");
  title.textContent = "Document theme";
  select.setAttribute("aria-label", "Document theme preset");
  const presets = [
    createDocumentTheme("Studio"),
    createDocumentTheme("Editorial"),
    createDocumentTheme("Forest"),
  ];
  if (theme) presets.unshift(theme);
  presets.forEach((t, i) => {
    const o = owner.createElement("option");
    o.value = String(i);
    o.textContent = theme && i === 0 ? `Current: ${t.Name}` : t.Name;
    select.append(o);
  });
  preview.setAttribute("aria-label", "Theme preview");
  preview.style.padding = "16px";
  status.setAttribute("role", "alert");
  note.textContent =
    "Only theme-linked formatting changes. Direct colors/fonts remain unchanged. Fonts must be installed by the host; no font files are downloaded.";
  note.className = "muted";
  const refresh = () => {
    const current = presets[Number(select.value)];
    if (!current) return;
    preview.replaceChildren();
    const heading = owner.createElement("h3"),
      body = owner.createElement("p"),
      swatches = owner.createElement("div");
    heading.textContent = "A connected document";
    heading.style.fontFamily = current.Fonts.Major;
    heading.style.color = current.Colors.accent1;
    body.textContent = `Heading: ${current.Fonts.Major} · Body: ${current.Fonts.Minor}`;
    body.style.fontFamily = current.Fonts.Minor;
    body.style.color = current.Colors.dark1;
    swatches.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    for (const slot of themeColorSlots) {
      const swatch = owner.createElement("span");
      swatch.style.cssText =
        "display:inline-block;width:28px;height:28px;border:1px solid #888;border-radius:4px";
      swatch.style.backgroundColor = current.Colors[slot];
      swatch.title = `${slot}: ${current.Colors[slot]}`;
      swatch.setAttribute("aria-label", swatch.title);
      swatches.append(swatch);
    }
    preview.append(heading, body, swatches);
  };
  const button = (name: string, action: () => void, mutation = true) => {
    const b = owner.createElement("button");
    b.textContent = name;
    b.disabled = mutation && editor.IsReadOnly;
    b.onclick = () => {
      try {
        if (mutation) guard();
        action();
      } catch (e) {
        status.textContent = (e as Error).message;
      }
    };
    actions.append(b);
  };
  button("Apply theme", () => {
    const current = presets[Number(select.value)];
    if (!current) throw new Error("Select a theme.");
    apply(() => engine.SetDocumentTheme(current));
    dialog.close();
  });
  button("Customize theme", () => {
    const current = structuredClone(presets[Number(select.value)]);
    if (!current) throw new Error("Select a theme.");
    dialog.close();
    host.Prompt(
      "Customize document theme",
      [
        { name: "name", label: "Theme name", value: current.Name },
        {
          name: "major",
          label: "Heading font (Latin)",
          value: current.Fonts.Major,
        },
        {
          name: "minor",
          label: "Body font (Latin)",
          value: current.Fonts.Minor,
        },
        ...themeColorSlots.map((slot) => ({
          name: slot,
          label: slot,
          value: current.Colors[slot],
        })),
        ...themeColorRoles.map((role) => ({
          name: "map-" + role,
          label: `Map ${role}`,
          value: current.ColorMap?.[role] ?? "",
          options: [
            { Value: "", Label: "Standard mapping" },
            ...themeColorSlots,
          ],
        })),
      ],
      (data) =>
        apply(() => {
          current.Name = data.name;
          current.Fonts = { Major: data.major, Minor: data.minor };
          current.ColorMap = {};
          for (const slot of themeColorSlots) current.Colors[slot] = data[slot];
          for (const role of themeColorRoles)
            if (data["map-" + role])
              current.ColorMap[role] = data[
                "map-" + role
              ] as (typeof themeColorSlots)[number];
          engine.SetDocumentTheme(current);
        }),
    );
  });
  button("Detach theme", () => {
    apply(() => engine.DetachDocumentTheme());
    dialog.close();
  });
  button("Close", () => dialog.close(), false);
  select.onchange = refresh;
  dialog.append(title, select, preview, note, status, actions);
  refresh();
  dialog.showModal();
  return true;
}
