import {
  child,
  descendants,
  escapeMarkup as esc,
  type MarkupNode,
} from "./formats-markup.js";
import {
  createDocumentTheme,
  validateDocumentTheme,
  themeColorSlots,
  themeColorRoles,
  themeColor,
  themeFont,
  parseThemeColor,
  parseThemeFont,
  resolveThemeValue,
  type DocumentTheme,
  type ThemeColorRole,
  type ThemeColorSlot,
} from "./document-theme.js";
const drawingNames: Record<ThemeColorSlot, string> = {
  dark1: "dk1",
  light1: "lt1",
  dark2: "dk2",
  light2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};
const mappingNames: Record<ThemeColorRole, string> = {
  background1: "bg1",
  text1: "t1",
  background2: "bg2",
  text2: "t2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hyperlink",
  followedHyperlink: "followedHyperlink",
};
const rgb = (v?: string) => /^[0-9a-f]{6}$/i.test(v ?? "");
const modifier = (n: number | undefined, name: string) =>
  n === undefined
    ? ""
    : ` w:${name}="${n.toString(16).padStart(2, "0").toUpperCase()}"`;
/** Native text color/font theme references with an explicitly resolved fallback. */
export function themeFontXML(
  value: string,
  theme?: DocumentTheme | null,
): string {
  const ref = parseThemeFont(value),
    font = esc(resolveThemeValue("FontFamily", value, theme));
  return `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"${ref ? ` w:asciiTheme="${ref.Font.toLowerCase()}Ascii" w:hAnsiTheme="${ref.Font.toLowerCase()}HAnsi"` : ` w:eastAsia="${font}"`}/>`;
}
export function themeColorXML(
  name: "Foreground" | "Background",
  value: string,
  theme?: DocumentTheme | null,
): string | null {
  const ref = parseThemeColor(value);
  if (!ref) return null;
  const color = resolveThemeValue(name, value, theme).slice(1);
  return name === "Foreground"
    ? `<w:color w:val="${color}" w:themeColor="${ref.Color}"${modifier(ref.Tint, "themeTint")}${modifier(ref.Shade, "themeShade")}/>`
    : `<w:shd w:val="clear" w:fill="${color}" w:themeFill="${ref.Color}"${modifier(ref.Tint, "themeFillTint")}${modifier(ref.Shade, "themeFillShade")}/>`;
}
export function themeColorMappingXML(theme: DocumentTheme | null): string {
  if (!theme?.ColorMap || !Object.keys(theme.ColorMap).length) return "";
  return `<w:clrSchemeMapping${Object.entries(theme.ColorMap)
    .map(
      ([role, slot]) => ` w:${mappingNames[role as ThemeColorRole]}="${slot}"`,
    )
    .join("")}/>`;
}
const neutralFormatScheme = () => {
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return `<a:fmtScheme name="RichTextWeb neutral"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>`;
};
export function documentThemeXML(value: DocumentTheme): string {
  const theme = validateDocumentTheme(value);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(theme.Name)}"><a:themeElements><a:clrScheme name="${esc(theme.Name)}">${themeColorSlots.map((k) => `<a:${drawingNames[k]}><a:srgbClr val="${theme.Colors[k].slice(1)}"/></a:${drawingNames[k]}>`).join("")}</a:clrScheme><a:fontScheme name="${esc(theme.Name)}">${(["Major", "Minor"] as const).map((role) => `<a:${role.toLowerCase()}Font><a:latin typeface="${esc(theme.Fonts[role])}"/><a:ea typeface=""/><a:cs typeface=""/></a:${role.toLowerCase()}Font>`).join("")}</a:fontScheme>${neutralFormatScheme()}</a:themeElements></a:theme>`;
}
export function readDocumentTheme(
  root: MarkupNode,
  settings: MarkupNode,
): { Theme: DocumentTheme | null; Warnings: string[] } {
  const warnings: string[] = [],
    native = descendants(root, "a:theme")[0];
  const warn = (s: string) => {
    if (warnings.length < 100) warnings.push(s);
  };
  if (!native) return { Theme: null, Warnings: warnings };
  const colors = child(child(native, "a:themeElements"), "a:clrScheme"),
    fonts = child(child(native, "a:themeElements"), "a:fontScheme"),
    theme = createDocumentTheme();
  theme.Name = (native.attrs.name || "Imported theme").slice(0, 128);
  // A partial malformed theme must not silently replace native run fallback colors with preset colors.
  for (const slot of themeColorSlots) {
    const element = child(colors, "a:" + drawingNames[slot]),
      direct = child(element, "a:srgbClr"),
      system = child(element, "a:sysClr"),
      color = direct?.attrs.val ?? system?.attrs.lastClr;
    if (
      !rgb(color) ||
      (direct ?? system)?.children.some((n) => n.name !== "#text")
    ) {
      warn(
        `Unsupported or missing theme color ${slot}; native text fallback formatting retained.`,
      );
      return { Theme: null, Warnings: warnings };
    }
    theme.Colors[slot] = "#" + color!.toUpperCase();
    if (system)
      warn(
        `Theme ${slot} uses its system-color lastClr fallback, not a live operating-system color.`,
      );
  }
  for (const role of ["Major", "Minor"] as const) {
    const font = child(fonts, `a:${role.toLowerCase()}Font`),
      latin = child(font, "a:latin")?.attrs.typeface;
    if (!latin) {
      warn(
        `Missing ${role} Latin theme font; native fallback formatting retained.`,
      );
      return { Theme: null, Warnings: warnings };
    }
    theme.Fonts[role] = latin;
    if (
      child(font, "a:ea")?.attrs.typeface ||
      child(font, "a:cs")?.attrs.typeface ||
      child(font, "a:font")
    )
      warn(
        `${role} script-specific theme font selection is not interpreted by the single-family text model.`,
      );
  }
  const mapping = descendants(settings, "w:clrSchemeMapping")[0];
  if (mapping) {
    theme.ColorMap = {};
    for (const role of themeColorRoles) {
      const value = mapping.attrs["w:" + mappingNames[role]];
      if (value === undefined) continue;
      if (themeColorSlots.includes(value as ThemeColorSlot))
        theme.ColorMap[role] = value as ThemeColorSlot;
      else
        warn(
          `Unsupported theme color mapping for ${role}; standard mapping retained.`,
        );
    }
  }
  const format = child(child(native, "a:themeElements"), "a:fmtScheme");
  if (format && format.attrs.name !== "RichTextWeb neutral")
    warn(
      "Theme drawing/effect style matrices are not interpreted; export uses neutral shape styles.",
    );
  try {
    return { Theme: validateDocumentTheme(theme), Warnings: warnings };
  } catch {
    warn("Invalid document theme; native fallback formatting retained.");
    return { Theme: null, Warnings: warnings };
  }
}
/** Mutates only the parsed property bag; malformed indirections never erase valid literal fallbacks. */
export function readThemeRunProperties(
  pr: MarkupNode,
  props: Record<string, any>,
  theme: DocumentTheme | null,
  warnings: string[],
): void {
  const warn = (s: string) => {
    if (warnings.length < 100 && !warnings.includes(s)) warnings.push(s);
  };
  const fonts = child(pr, "w:rFonts"),
    ascii = fonts?.attrs["w:asciiTheme"],
    ansi = fonts?.attrs["w:hAnsiTheme"];
  const font = ascii ?? ansi;
  if (font) {
    const match = /^(major|minor)(Ascii|HAnsi)$/.exec(font);
    if (
      match &&
      (!ascii || !ansi || ascii.replace(/Ascii$/, "HAnsi") === ansi)
    ) {
      try {
        props.FontFamily = themeFont(
          match[1] === "major" ? "Major" : "Minor",
          props.FontFamily || "Arial",
        );
      } catch {
        warn("Invalid theme font fallback; literal font retained.");
      }
    } else
      warn(
        "Mixed or unsupported ASCII/High ANSI theme fonts; literal font fallback retained.",
      );
  }
  if (fonts?.attrs["w:eastAsiaTheme"] || fonts?.attrs["w:cstheme"])
    warn("Complex-script/East Asian theme font selection is not interpreted.");
  for (const [property, tag, attr, tint, shade] of [
    ["Foreground", "w:color", "themeColor", "themeTint", "themeShade"],
    ["Background", "w:shd", "themeFill", "themeFillTint", "themeFillShade"],
  ]) {
    const element = child(pr, tag!);
    const color = element?.attrs["w:" + attr];
    if (!color) continue;
    const options: { Tint?: number; Shade?: number; Fallback?: string } = {
      Fallback: /^#[0-9a-f]{6}$/i.test(props[property!] ?? "")
        ? props[property!]
        : "#000000",
    };
    try {
      for (const [key, native] of [
        ["Tint", tint],
        ["Shade", shade],
      ] as const) {
        const value = element?.attrs["w:" + native];
        if (value === undefined) continue;
        if (!/^[0-9a-f]{2}$/i.test(value))
          throw new Error("Invalid theme modifier.");
        options[key] = parseInt(value, 16);
      }
      props[property!] = themeColor(color as ThemeColorSlot, options);
    } catch {
      warn(
        `Unsupported ${property} theme reference/modifiers; literal fallback retained.`,
      );
    }
  }
  if (
    !theme &&
    Object.values(props).some(
      (v) => typeof v === "string" && v.startsWith("theme:"),
    )
  )
    warn(
      "Theme part is missing or unsupported; native cached text colors/fonts are used until a theme is assigned.",
    );
}
