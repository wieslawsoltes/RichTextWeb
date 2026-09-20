import type { DocumentNode } from "./model.js";
import { uid } from "./engine-tree.js";
import {
  child,
  descendants,
  textContent,
  escapeMarkup as esc,
  type MarkupNode,
} from "./formats-markup.js";
import {
  contentControlText,
  validateContentControlNode,
  validateContentControlProperties,
  type ContentControlProperties,
  type ContentControlKind,
} from "./content-controls.js";

const attr = (n?: MarkupNode, name = "val") => n?.attrs["w:" + name];
const on = (n?: MarkupNode, prefix = "w") =>
  !!n && !["0", "false", "off"].includes(n.attrs[prefix + ":val"] ?? "1");
/** Native SDT properties. The body is emitted by the normal rich-content DOCX writer. */
export function contentControlPropertiesXML(
  node: DocumentNode,
  nativeId: number,
): string {
  validateContentControlNode(node);
  const p = node.props.ContentControl as ContentControlProperties;
  const lock = p.LockContentControl
    ? p.LockContents
      ? "sdtContentLocked"
      : "sdtLocked"
    : p.LockContents
      ? "contentLocked"
      : "unlocked";
  let type = "";
  switch (p.Kind) {
    case "RichText":
      type = "<w:richText/>";
      break;
    case "PlainText":
      type = `<w:text w:multiLine="${p.Multiline ? 1 : 0}"/>`;
      break;
    case "CheckBox":
      type = `<w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="${p.Value ? 1 : 0}"/><w14:checkedState w14:val="${(p.CheckedSymbol ?? "☒").codePointAt(0)!.toString(16).toUpperCase()}" w14:font="${esc(p.CheckedFont ?? "MS Gothic")}"/><w14:uncheckedState w14:val="${(p.UncheckedSymbol ?? "☐").codePointAt(0)!.toString(16).toUpperCase()}" w14:font="${esc(p.UncheckedFont ?? "MS Gothic")}"/></w14:checkbox>`;
      break;
    case "Date":
      type = `<w:date${p.Value ? ` w:fullDate="${esc(p.Value)}T00:00:00Z"` : ""}><w:dateFormat w:val="${esc(p.DateFormat ?? "yyyy-MM-dd")}"/><w:lid w:val="${esc(p.DateLocale ?? "en-US")}"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`;
      break;
    case "DropDownList":
    case "ComboBox": {
      const kind = p.Kind === "DropDownList" ? "dropDownList" : "comboBox";
      type = `<w:${kind}${p.Value ? ` w:lastValue="${esc(p.Value)}"` : ""}>${(p.Items ?? []).map((i) => `<w:listItem w:displayText="${esc(i.DisplayText)}" w:value="${esc(i.Value)}"/>`).join("")}</w:${kind}>`;
    }
  }
  return `<w:sdtPr><w:alias w:val="${esc(p.Title ?? "")}"/><w:lock w:val="${lock}"/><w:placeholder><w:docPart w:val="rtwPlaceholder${nativeId}"/></w:placeholder>${p.ShowingPlaceholder ? "<w:showingPlcHdr/>" : ""}<w:id w:val="${nativeId}"/><w:tag w:val="${esc(p.Tag ?? "")}"/>${type}</w:sdtPr>`;
}
/** Returns undefined with a diagnostic for unsupported controls, retaining their body as ordinary rich content. */
export function readContentControlProperties(
  sdt: MarkupNode,
  level: "Inline" | "Block",
  content: DocumentNode[],
  placeholders: Map<string, string>,
  warnings: string[],
): ContentControlProperties | undefined {
  const pr = child(sdt, "w:sdtPr");
  try {
    const supported: [string, ContentControlKind][] = [
      ["w:richText", "RichText"],
      ["w:text", "PlainText"],
      ["w14:checkbox", "CheckBox"],
      ["w:dropDownList", "DropDownList"],
      ["w:comboBox", "ComboBox"],
      ["w:date", "Date"],
    ];
    const known = new Set([
      ...supported.map((x) => x[0]),
      "w:alias",
      "w:tag",
      "w:id",
      "w:lock",
      "w:placeholder",
      "w:showingPlcHdr",
      "w:rPr",
    ]);
    const unknown = pr?.children.filter(
      (c) => c.name !== "#text" && !known.has(c.name),
    );
    if (unknown?.length)
      throw new Error(
        `Unsupported SDT properties: ${unknown.map((n) => n.name).join(", ")}`,
      );
    const types = supported.filter(([name]) => child(pr, name));
    if (types.length > 1) throw new Error("Ambiguous SDT type.");
    const [name, kind] = types[0] ?? ["w:richText", "RichText"],
      subtype = child(pr, name);
    const lock = attr(child(pr, "w:lock")) ?? "unlocked";
    if (
      !["unlocked", "sdtLocked", "contentLocked", "sdtContentLocked"].includes(
        lock,
      )
    )
      throw new Error("Unsupported SDT lock type.");
    const temp = {
      type: level === "Block" ? "Section" : "Span",
      id: uid(),
      props: {},
      children: content,
    };
    const display = contentControlText(temp);
    const placeholder = attr(child(child(pr, "w:placeholder"), "w:docPart"));
    const p: ContentControlProperties = {
      Id: uid(),
      Kind: kind,
      Level: level,
      Title: attr(child(pr, "w:alias")) ?? "",
      Tag: attr(child(pr, "w:tag")) ?? "",
      LockContentControl: ["sdtLocked", "sdtContentLocked"].includes(lock),
      LockContents: ["contentLocked", "sdtContentLocked"].includes(lock),
      ShowingPlaceholder: on(child(pr, "w:showingPlcHdr")),
      ...(placeholder && placeholders.has(placeholder)
        ? { Placeholder: placeholders.get(placeholder) }
        : {}),
    };
    if (p.ShowingPlaceholder && !p.Placeholder) p.Placeholder = display;
    if (kind === "PlainText")
      p.Multiline = ["1", "true", "on"].includes(
        attr(subtype, "multiLine") ?? "0",
      );
    if (kind === "RichText") p.Multiline = true;
    if (kind === "CheckBox") {
      p.ShowingPlaceholder = false;
      p.Value = on(child(subtype, "w14:checked"), "w14");
      for (const [state, symbol, font, defaultSymbol] of [
        ["checkedState", "CheckedSymbol", "CheckedFont", "☒"],
        ["uncheckedState", "UncheckedSymbol", "UncheckedFont", "☐"],
      ] as const) {
        const n = child(subtype, "w14:" + state),
          hex = n?.attrs["w14:val"];
        if (
          hex &&
          (!/^[\da-f]{1,6}$/i.test(hex) || parseInt(hex, 16) > 0x10ffff)
        )
          throw new Error("Invalid checkbox symbol.");
        p[symbol] = hex
          ? String.fromCodePoint(parseInt(hex, 16))
          : defaultSymbol;
        p[font] = n?.attrs["w14:font"] ?? "MS Gothic";
      }
    }
    if (kind === "Date") {
      if (
        child(subtype, "w:calendar") &&
        attr(child(subtype, "w:calendar")) !== "gregorian"
      )
        throw new Error("Only Gregorian SDT dates are editable.");
      p.DateFormat = attr(child(subtype, "w:dateFormat")) ?? "yyyy-MM-dd";
      p.DateLocale = attr(child(subtype, "w:lid")) ?? "en-US";
      p.Value = p.ShowingPlaceholder
        ? ""
        : (attr(subtype, "fullDate") ?? "").slice(0, 10);
    }
    if (kind === "DropDownList" || kind === "ComboBox") {
      p.Items = (subtype?.children ?? [])
        .filter((n) => n.name === "w:listItem")
        .map((n) => ({
          DisplayText: attr(n, "displayText") ?? attr(n, "value") ?? "",
          Value: attr(n, "value") ?? "",
        }));
      const matches = p.Items.filter((i) => i.DisplayText === display);
      const lastValue = attr(subtype, "lastValue");
      p.Value = p.ShowingPlaceholder
        ? ""
        : (p.Items.find(
            (i) => i.Value === lastValue && i.DisplayText === display,
          )?.Value ??
          (matches.length === 1
            ? matches[0].Value
            : kind === "ComboBox"
              ? display
              : ""));
    }
    temp.props = { ContentControl: validateContentControlProperties(p) };
    validateContentControlNode(temp);
    return p;
  } catch (error) {
    if (warnings.length < 1000)
      warnings.push(
        `Content control '${attr(child(pr, "w:tag")) ?? attr(child(pr, "w:alias")) ?? ""}': ${error instanceof Error ? error.message : String(error)}; body retained without editable control semantics.`,
      );
    return undefined;
  }
}
export function readContentControlPlaceholders(
  root: MarkupNode,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of descendants(root, "w:docPart").slice(0, 10000)) {
    const name = attr(child(child(part, "w:docPartPr"), "w:name"));
    if (name)
      values.set(
        name,
        descendants(child(part, "w:docPartBody") ?? part, "w:t")
          .map(textContent)
          .join(""),
      );
  }
  return values;
}
