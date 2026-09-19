/** Bounded, data-only Word field instruction parsing. No expression is evaluated here. */
export interface ParsedFieldCode {
  Type: string;
  Arguments: string[];
  Quoted: boolean[];
  Switches: Record<string, string[]>;
  Expression?: string;
}
export function parseFieldCode(instruction: string): ParsedFieldCode {
  if (typeof instruction !== "string" || instruction.length > 16384)
    throw new RangeError(
      "Field instructions must contain at most 16,384 characters.",
    );
  const tokens: { value: string; quoted: boolean; start: number }[] = [];
  let i = 0;
  while (i < instruction.length) {
    if (/\s/.test(instruction[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let value = "",
      quoted = false;
    if (instruction[i] === '"') {
      quoted = true;
      i++;
      let closed = false;
      while (i < instruction.length) {
        const c = instruction[i++]!;
        if (c === '"') {
          if (instruction[i] === '"') {
            value += '"';
            i++;
          } else {
            closed = true;
            break;
          }
        } else if (c === "\\" && ['"', "\\"].includes(instruction[i] ?? ""))
          value += instruction[i++];
        else value += c;
      }
      if (!closed) throw new SyntaxError("Unterminated quoted field argument.");
    } else {
      while (i < instruction.length && !/\s/.test(instruction[i]!))
        value += instruction[i++];
    }
    tokens.push({ value, quoted, start });
    if (tokens.length > 2048)
      throw new RangeError("Field instruction has too many tokens.");
  }
  const first = tokens.shift();
  const formula = first?.value.startsWith("=") && !first.quoted;
  const result: ParsedFieldCode = {
    Type: formula ? "=" : (first?.value ?? "").toUpperCase(),
    Arguments: [],
    Quoted: [],
    Switches: Object.create(null),
  };
  let current: string | undefined;
  let expressionEnd = instruction.length;
  for (const token of tokens) {
    if (!token.quoted && /^\\[a-z*#@]$/i.test(token.value)) {
      current = token.value.slice(1).toLowerCase();
      result.Switches[current] ??= [];
      expressionEnd = Math.min(expressionEnd, token.start);
    } else if (current) result.Switches[current]!.push(token.value);
    else {
      result.Arguments.push(token.value);
      result.Quoted.push(token.quoted);
    }
  }
  if (formula)
    result.Expression = instruction
      .slice((first?.start ?? 0) + 1, expressionEnd)
      .trim();
  return result;
}

/** Strict invariant numeric cell text. Grouped thousands and trailing percent are accepted. */
export function parseFieldNumber(text: string): number | undefined {
  const value = text.trim();
  if (
    !/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(
      value,
    )
  )
    return undefined;
  const result =
    Number(value.replaceAll(",", "").replace(/%$/, "")) /
    (value.endsWith("%") ? 100 : 1);
  return Number.isFinite(result) ? result : undefined;
}

export function formatFieldNumber(
  value: number,
  picture: string,
  locale = "en-US",
): string {
  if (!Number.isFinite(value) || picture.length > 256)
    throw new RangeError("Invalid number or numeric field picture.");
  // Quoted literals may contain semicolons. The supported subset deliberately rejects unknown tokens.
  const sections = [""];
  let quote = "";
  for (const c of picture) {
    if (c === quote) quote = "";
    else if (!quote && (c === "'" || c === '"')) quote = c;
    if (c === ";" && !quote) sections.push("");
    else sections[sections.length - 1] += c;
  }
  if (quote || /[\uE000-\uE0FF]/.test(picture))
    throw new SyntaxError("Invalid quoted numeric picture.");
  if (!sections.length || sections.length > 3)
    throw new SyntaxError("Invalid numeric field picture.");
  const explicit = value < 0 && sections.length > 1;
  const section =
    value === 0 && sections.length > 2
      ? sections[2]!
      : explicit
        ? sections[1]!
        : sections[0]!;
  const quoted: string[] = [];
  const mask = section.replace(/'([^']*)'|"([^"]*)"/g, (_m, a, b) => {
    quoted.push(a ?? b);
    return String.fromCharCode(0xe000 + quoted.length - 1);
  });
  const match = /[0#][0#,]*(?:\.[0#]+)?/.exec(mask);
  const unquote = (s: string) =>
    s.replace(/[\uE000-\uE0FF]/g, (c) => quoted[c.charCodeAt(0) - 0xe000]!);
  if (!match) {
    if (/[^\s\-()\uE000-\uE0FF]/.test(mask))
      throw new SyntaxError("Unsupported numeric field picture.");
    return unquote(mask);
  }
  const before = mask.slice(0, match.index),
    after = mask.slice(match.index + match[0].length);
  const literals = (before + after).replace(/[\uE000-\uE0FF]/g, "");
  if (
    /[^\s$€£¥%()+\-]/.test(literals) ||
    (literals.match(/%/g)?.length ?? 0) > 1
  )
    throw new SyntaxError("Unsupported numeric field picture.");
  const [integer, decimals = ""] = match[0].split(".");
  if (decimals.length > 12 || !/^0*#*$/.test(decimals))
    throw new SyntaxError(
      "Numeric pictures support at most 12 decimal places.",
    );
  const result = new Intl.NumberFormat(locale, {
    useGrouping: integer!.includes(","),
    minimumIntegerDigits: Math.min(
      21,
      Math.max(1, (integer!.match(/0/g) ?? []).length),
    ),
    minimumFractionDigits: (decimals.match(/0/g) ?? []).length,
    maximumFractionDigits: decimals.length,
  }).format(Math.abs(value) * (literals.includes("%") ? 100 : 1));
  return (
    (!explicit && value < 0 ? "-" : "") +
    unquote(before) +
    result +
    unquote(after)
  );
}

/** Supported Word date picture tokens use UTC, independently of host timezone. */
export function formatFieldDate(
  date: Date,
  picture: string,
  locale = "en-US",
): string {
  if (!Number.isFinite(date.getTime()) || picture.length > 256)
    throw new RangeError("Invalid date or date field picture.");
  const pad = (n: number) => String(n).padStart(2, "0");
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
      date,
    );
  const h = date.getUTCHours();
  const values: Record<string, string> = {
    yyyy: String(date.getUTCFullYear()).padStart(4, "0"),
    yy: pad(date.getUTCFullYear() % 100),
    MMMM: part({ month: "long" }),
    MMM: part({ month: "short" }),
    MM: pad(date.getUTCMonth() + 1),
    M: String(date.getUTCMonth() + 1),
    dddd: part({ weekday: "long" }),
    ddd: part({ weekday: "short" }),
    dd: pad(date.getUTCDate()),
    d: String(date.getUTCDate()),
    HH: pad(h),
    H: String(h),
    hh: pad(h % 12 || 12),
    h: String(h % 12 || 12),
    mm: pad(date.getUTCMinutes()),
    m: String(date.getUTCMinutes()),
    ss: pad(date.getUTCSeconds()),
    s: String(date.getUTCSeconds()),
    "AM/PM": h < 12 ? "AM" : "PM",
    "am/pm": h < 12 ? "am" : "pm",
  };
  return picture.replace(
    /'[^']*'|"[^"]*"|AM\/PM|am\/pm|yyyy|MMMM|dddd|MMM|ddd|yy|MM|dd|HH|hh|mm|ss|[MdHhms]|[A-Za-z]+/g,
    (token) => {
      if (token.startsWith("'") || token.startsWith('"'))
        return token.slice(1, -1);
      if (!Object.hasOwn(values, token))
        throw new SyntaxError(`Unsupported date picture token: ${token}`);
      return values[token]!;
    },
  );
}

export function formatFieldText(
  value: string,
  formats: string[],
  locale = "en-US",
): string {
  for (const format of formats) {
    if (format.toUpperCase() === "UPPER")
      value = value.toLocaleUpperCase(locale);
    else if (format.toUpperCase() === "LOWER")
      value = value.toLocaleLowerCase(locale);
    else if (format.toUpperCase() === "FIRSTCAP")
      value = value.replace(/\p{L}/u, (c) => c.toLocaleUpperCase(locale));
    else if (format.toUpperCase() === "CAPS")
      value = value.replace(/\p{L}[\p{L}\p{M}\p{N}'’]*/gu, (w) => {
        const [first, ...rest] = Array.from(w);
        return (
          first!.toLocaleUpperCase(locale) +
          rest.join("").toLocaleLowerCase(locale)
        );
      });
  }
  return value;
}
