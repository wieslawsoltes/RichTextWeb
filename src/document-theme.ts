/** Document-level text themes. Tokens remain strings so existing property APIs stay compatible. */
export const themeColorSlots = [
  "dark1",
  "light1",
  "dark2",
  "light2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hyperlink",
  "followedHyperlink",
] as const;
export type ThemeColorSlot = (typeof themeColorSlots)[number];
export const themeColorRoles = [
  "background1",
  "text1",
  "background2",
  "text2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hyperlink",
  "followedHyperlink",
] as const;
export type ThemeColorRole = (typeof themeColorRoles)[number];
export type ThemeColorName = ThemeColorSlot | ThemeColorRole;
export type ThemeFontRole = "Major" | "Minor";
export interface DocumentTheme {
  Name: string;
  Colors: Record<ThemeColorSlot, string>;
  /** Latin font families; complex-script/East Asian font selection is not inferred. */
  Fonts: { Major: string; Minor: string };
  ColorMap?: Partial<Record<ThemeColorRole, ThemeColorSlot>>;
}
export interface ThemeColorOptions {
  Tint?: number;
  Shade?: number;
  Fallback?: string;
}
export interface ThemeColorReference {
  Color: ThemeColorName;
  Tint?: number;
  Shade?: number;
  Fallback: string;
}
export interface ThemeFontReference {
  Font: ThemeFontRole;
  Fallback: string;
}
const own = (o: object, key: string) =>
  Object.prototype.hasOwnProperty.call(o, key);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const colorName = (v: unknown): v is ThemeColorName =>
  [...themeColorSlots, ...themeColorRoles].includes(v as ThemeColorName);
const rgb = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const fontName = (v: unknown): v is string =>
  typeof v === "string" &&
  !!v.trim() &&
  v.length <= 128 &&
  !/[\x00-\x1f;{}<>]/.test(v) &&
  !v.startsWith("theme:");
const byte = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;
const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
export function validateDocumentTheme(value: unknown): DocumentTheme {
  if (
    !object(value) ||
    !["Name", "Colors", "Fonts"].every((k) => own(value, k)) ||
    Object.keys(value).some(
      (k) => !["Name", "Colors", "Fonts", "ColorMap"].includes(k),
    ) ||
    typeof value.Name !== "string" ||
    !value.Name.trim() ||
    value.Name.length > 128 ||
    /[\x00-\x1f]/.test(value.Name)
  )
    throw new Error(
      "A document theme requires a name of at most 128 characters and supported properties.",
    );
  if (
    !object(value.Colors) ||
    Object.keys(value.Colors).length !== themeColorSlots.length ||
    themeColorSlots.some((k) => !own(value.Colors, k) || !rgb(value.Colors[k]))
  )
    throw new Error("A theme requires all twelve RGB color slots (#RRGGBB).");
  if (
    !object(value.Fonts) ||
    Object.keys(value.Fonts).length !== 2 ||
    !own(value.Fonts, "Major") ||
    !own(value.Fonts, "Minor") ||
    !fontName(value.Fonts.Major) ||
    !fontName(value.Fonts.Minor)
  )
    throw new Error(
      "A theme requires valid Major and Minor Latin font families.",
    );
  if (
    value.ColorMap !== undefined &&
    (!object(value.ColorMap) ||
      Object.entries(value.ColorMap).some(
        ([k, v]) =>
          !themeColorRoles.includes(k as ThemeColorRole) ||
          !themeColorSlots.includes(v as ThemeColorSlot),
      ))
  )
    throw new Error(
      "Theme color mapping must map semantic roles directly to physical theme slots.",
    );
  const theme = structuredClone(value) as DocumentTheme;
  for (const key of themeColorSlots)
    theme.Colors[key] = theme.Colors[key].toUpperCase();
  return theme;
}
/** Tint and Shade use Word's 0..255 luminance bytes, not percentages. Tint takes precedence. */
export function themeColor(
  color: ThemeColorName,
  options: ThemeColorOptions = {},
): string {
  if (
    !colorName(color) ||
    !object(options) ||
    Object.keys(options).some(
      (k) => !["Tint", "Shade", "Fallback"].includes(k),
    ) ||
    (options.Tint !== undefined && !byte(options.Tint)) ||
    (options.Shade !== undefined && !byte(options.Shade)) ||
    (options.Fallback !== undefined && !rgb(options.Fallback))
  )
    throw new Error(
      "Invalid theme color reference, RGB fallback or tint/shade byte.",
    );
  return `theme:color:${color}:${options.Tint === undefined ? "-" : hex(options.Tint)}:${options.Shade === undefined ? "-" : hex(options.Shade)}:${(options.Fallback ?? "#000000").slice(1).toUpperCase()}`;
}
export function themeFont(font: ThemeFontRole, fallback = "Arial"): string {
  if (!["Major", "Minor"].includes(font) || !fontName(fallback))
    throw new Error("Invalid theme font reference or fallback.");
  const token = `theme:font:${font}:${encodeURIComponent(fallback)}`;
  if (token.length > 256)
    throw new Error("Encoded theme font reference exceeds 256 characters.");
  return token;
}
export function parseThemeColor(value: unknown): ThemeColorReference | null {
  if (typeof value !== "string" || !value.startsWith("theme:color:"))
    return null;
  const m =
    /^theme:color:([A-Za-z0-9]+):(-|[0-9A-Fa-f]{2}):(-|[0-9A-Fa-f]{2}):([0-9A-Fa-f]{6})$/.exec(
      value,
    );
  if (!m || !colorName(m[1])) throw new Error("Invalid theme color token.");
  return {
    Color: m[1],
    ...(m[2] === "-" ? {} : { Tint: parseInt(m[2]!, 16) }),
    ...(m[3] === "-" ? {} : { Shade: parseInt(m[3]!, 16) }),
    Fallback: "#" + m[4]!.toUpperCase(),
  };
}
export function parseThemeFont(value: unknown): ThemeFontReference | null {
  if (typeof value !== "string" || !value.startsWith("theme:font:"))
    return null;
  const m = /^theme:font:(Major|Minor):(.{1,230})$/.exec(value);
  if (!m || value.length > 256) throw new Error("Invalid theme font token.");
  let fallback: string;
  try {
    fallback = decodeURIComponent(m[2]!);
  } catch {
    throw new Error("Invalid theme font escape.");
  }
  if (!fontName(fallback)) throw new Error("Invalid theme font fallback.");
  return { Font: m[1] as ThemeFontRole, Fallback: fallback };
}
export function validateThemeProperty(name: string, value: unknown): void {
  if (typeof value !== "string" || !value.startsWith("theme:")) return;
  if (name === "FontFamily" && parseThemeFont(value)) return;
  if (
    ["Foreground", "Background", "BorderBrush"].includes(name) &&
    parseThemeColor(value)
  )
    return;
  throw new Error(`Invalid theme token for ${name}.`);
}
const defaultMap: Record<ThemeColorRole, ThemeColorSlot> = {
  background1: "light1",
  text1: "dark1",
  background2: "light2",
  text2: "dark2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hyperlink",
  followedHyperlink: "followedHyperlink",
};
/** HSL luminance transform used by Word, not an RGB white/black blend. */
export function transformThemeColor(
  color: string,
  tint?: number,
  shade?: number,
): string {
  if (
    !rgb(color) ||
    (tint !== undefined && !byte(tint)) ||
    (shade !== undefined && !byte(shade))
  )
    throw new Error("Invalid theme color transform.");
  if (
    (tint === undefined && shade === undefined) ||
    tint === 255 ||
    (tint === undefined && shade === 255)
  )
    return color.toUpperCase();
  const channels = [1, 3, 5].map(
      (i) => parseInt(color.slice(i, i + 2), 16) / 255,
    ),
    max = Math.max(...channels),
    min = Math.min(...channels),
    delta = max - min,
    light = (max + min) / 2,
    saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (delta) {
    if (max === channels[0])
      hue = ((channels[1]! - channels[2]!) / delta + 6) % 6;
    else if (max === channels[1])
      hue = (channels[2]! - channels[0]!) / delta + 2;
    else hue = (channels[0]! - channels[1]!) / delta + 4;
  }
  const l =
      tint !== undefined
        ? 1 - ((1 - light) * tint) / 255
        : (light * shade!) / 255,
    c = (1 - Math.abs(2 * l - 1)) * saturation,
    x = c * (1 - Math.abs((hue % 2) - 1)),
    m = l - c / 2,
    result =
      hue < 1
        ? [c, x, 0]
        : hue < 2
          ? [x, c, 0]
          : hue < 3
            ? [0, c, x]
            : hue < 4
              ? [0, x, c]
              : hue < 5
                ? [x, 0, c]
                : [c, 0, x];
  // Truncate channels; epsilon corrects floating-point noise at exact integer boundaries.
  return (
    "#" +
    result
      .map((v) =>
        hex(Math.max(0, Math.min(255, Math.floor((v + m) * 255 + 1e-9)))),
      )
      .join("")
  );
}
/** @internal The theme is already validated by document loading/SetDocumentTheme. */
export function resolveThemeValue(
  name: string,
  value: any,
  theme?: DocumentTheme | null,
): any {
  if (typeof value !== "string" || !value.startsWith("theme:")) return value;
  validateThemeProperty(name, value);
  const font = parseThemeFont(value);
  if (font) return theme?.Fonts[font.Font] ?? font.Fallback;
  const ref = parseThemeColor(value)!;
  if (!theme) return ref.Fallback; // Native fallback is already transformed.
  const slot = own(defaultMap, ref.Color)
    ? (theme.ColorMap?.[ref.Color as ThemeColorRole] ??
      defaultMap[ref.Color as ThemeColorRole])
    : (ref.Color as ThemeColorSlot);
  return transformThemeColor(theme.Colors[slot], ref.Tint, ref.Shade);
}
export function resolveDocumentThemeValue(
  theme: DocumentTheme | null,
  name: string,
  value: string,
): string {
  return resolveThemeValue(
    name,
    value,
    theme === null ? null : validateDocumentTheme(theme),
  );
}
/** Returns a detached baseline; no installed or downloadable font files are included. */
export function createDocumentTheme(
  preset: "Studio" | "Editorial" | "Forest" = "Studio",
): DocumentTheme {
  if (!["Studio", "Editorial", "Forest"].includes(preset))
    throw new Error("Unknown document theme preset.");
  const palettes = {
    Studio: ["#174B75", "#9B3C27", "#48775B", "#72558A", "#307F8B", "#AA7424"],
    Editorial: [
      "#7B3149",
      "#967025",
      "#336E73",
      "#545D83",
      "#82643A",
      "#667452",
    ],
    Forest: ["#286044", "#A45C30", "#4C7185", "#73628A", "#8A793D", "#487F7B"],
  };
  const colors: DocumentTheme["Colors"] = {
    dark1: "#202B38",
    light1: "#FFFFFF",
    dark2: "#4D596A",
    light2: "#EEF2F6",
    accent1: palettes[preset][0]!,
    accent2: palettes[preset][1]!,
    accent3: palettes[preset][2]!,
    accent4: palettes[preset][3]!,
    accent5: palettes[preset][4]!,
    accent6: palettes[preset][5]!,
    hyperlink: "#005A9C",
    followedHyperlink: "#72558A",
  };
  return {
    Name: preset,
    Colors: colors,
    Fonts: {
      Major: preset === "Editorial" ? "Georgia" : "Arial",
      Minor: "Arial",
    },
  };
}
