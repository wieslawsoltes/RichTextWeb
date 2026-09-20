import { parseFieldNumber } from "./field-code.js";

export type MailMergeValue = string | number | boolean | null;
export type MailMergeRecord = Record<string, MailMergeValue>;
export type MailMergeValueType = "Text" | "Number" | "Date";
export type MailMergeOperator =
  | "Equal"
  | "NotEqual"
  | "Less"
  | "LessOrEqual"
  | "Greater"
  | "GreaterOrEqual"
  | "Blank"
  | "NotBlank"
  | "Contains"
  | "NotContains";
export interface MailMergeCondition {
  Field: string;
  Operator: MailMergeOperator;
  Value?: MailMergeValue;
  Type?: MailMergeValueType;
}
export interface MailMergeSort {
  Field: string;
  Type?: MailMergeValueType;
  Descending?: boolean;
}
export interface MailMergeOptions {
  Filters?: MailMergeCondition[];
  Match?: "All" | "Any";
  Sort?: MailMergeSort[];
  Locale?: string;
  CaseSensitive?: boolean;
  /** One-based original source row numbers, unaffected by filtering/sorting. */
  Include?: number[];
  Exclude?: number[];
  /** One-based positions AFTER filtering/sorting, BEFORE inclusion/exclusion. */
  FirstRecord?: number;
  LastRecord?: number;
  /** Generation rejects unresolved fields when enabled; preview always reports them. */
  FailOnUnresolved?: boolean;
}
export interface MailMergeRecipient {
  SourceRecord: number;
  /** Ordinal in the filtered and sorted source, used by MERGEREC. */
  RecordNumber: number;
  /** Consecutive output ordinal, used by MERGESEQ. */
  SequenceNumber: number;
  Data: MailMergeRecord;
}
export interface MailMergePlan {
  Fields: string[];
  TotalRecords: number;
  MatchedRecords: number;
  Recipients: MailMergeRecipient[];
}
export const mailMergeLimits = Object.freeze({
  Records: 10000,
  Fields: 256,
  Cells: 200000,
  Characters: 4000000,
  CellCharacters: 65536,
  Filters: 32,
  SortKeys: 3,
  GeneratedDocuments: 1000,
  GeneratedNodes: 1000000,
  GeneratedCharacters: 8000000,
});
const record = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const scalar = (value: unknown): value is MailMergeValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const blank = (value: MailMergeValue | undefined) =>
  value == null || String(value).trim() === "";
const read = (row: MailMergeRecord, field: string) =>
  Object.hasOwn(row, field) ? row[field] : undefined;
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

/** Copy array data without invoking input iterators or overridden array methods. */
function queryArray<T>(value: unknown, limit: number, label: string): T[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new RangeError(
      `${label} requires an array of at most ${limit} entries.`,
    );
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(`${label} arrays must contain own data entries.`);
    return descriptor.value as T;
  });
}

/** Validate and detach scalar records. Accessors, objects and executable values are rejected. */
export function validateMailMergeRecords(input: unknown): MailMergeRecord[] {
  if (!Array.isArray(input) || input.length > mailMergeLimits.Records)
    throw new RangeError(
      "Mail merge requires an array of at most 10,000 records.",
    );
  let cells = 0,
    characters = 0;
  const fields = new Set<string>();
  return Array.from({ length: input.length }, (_, index) => {
    const item = Object.getOwnPropertyDescriptor(input, String(index));
    if (!item || !Object.hasOwn(item, "value"))
      throw new TypeError(
        "Recipient arrays must contain own data records at every index.",
      );
    const row: unknown = item.value;
    if (!record(row))
      throw new TypeError(`Recipient ${index + 1} must be a plain record.`);
    const result: MailMergeRecord = Object.create(null);
    for (const key of Object.keys(row)) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key)!;
      if (!Object.hasOwn(descriptor, "value"))
        throw new TypeError("Recipient accessors are not supported.");
      const value: unknown = descriptor.value;
      if (!key.trim() || key.length > 255 || /[\u0000-\u001f]/.test(key))
        throw new TypeError(
          "Recipient field names must be 1–255 printable characters.",
        );
      if (!scalar(value))
        throw new TypeError(
          `Recipient ${index + 1}, ${key}: expected a finite scalar or null.`,
        );
      if (
        typeof value === "string" &&
        value.length > mailMergeLimits.CellCharacters
      )
        throw new RangeError("Recipient value exceeds 65,536 characters.");
      fields.add(key);
      characters += key.length + String(value ?? "").length;
      if (
        ++cells > mailMergeLimits.Cells ||
        fields.size > mailMergeLimits.Fields ||
        characters > mailMergeLimits.Characters
      )
        throw new RangeError(
          "Recipient data exceeds its field/cell/text budget.",
        );
      result[key] = value;
    }
    return result;
  });
}

/** CSV/TSV import is data-only: no spreadsheet formulas, external files or URLs execute. */
export function parseMailMergeDelimited(
  input: string,
  delimiter: "," | "\t" | ";" = ",",
): MailMergeRecord[] {
  if (
    typeof input !== "string" ||
    input.length > mailMergeLimits.Characters ||
    ![",", "\t", ";"].includes(delimiter)
  )
    throw new RangeError(
      "Invalid delimiter or recipient text exceeds four million characters.",
    );
  const source = input.replace(/^\uFEFF/, "");
  if (!source.length) return [];
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false,
    cells = 0;
  const cell = () => {
    if (rows.length && ++cells > mailMergeLimits.Cells)
      throw new RangeError("Too many recipient cells.");
    row.push(value);
    value = "";
    closed = false;
    if (row.length > mailMergeLimits.Fields)
      throw new RangeError("Too many recipient columns.");
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > mailMergeLimits.Records + 1)
      throw new RangeError("Too many recipient rows.");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === delimiter) cell();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      line();
    } else if (c === '"' && !value && !closed) quoted = true;
    else {
      if (closed || c === '"')
        throw new SyntaxError("Malformed quoted recipient value.");
      value += c;
    }
    if (value.length > mailMergeLimits.CellCharacters)
      throw new RangeError("Recipient value is too long.");
  }
  if (quoted) throw new SyntaxError("Unterminated quoted recipient value.");
  if (value || row.length || closed || !/[\r\n]$/.test(source)) line();
  const header = rows.shift()!.map((name) => name.trim());
  if (new Set(header).size !== header.length || header.some((name) => !name))
    throw new Error("Recipient headers must be unique and nonempty.");
  const data = rows.map((values, index) => {
    if (values.length !== header.length)
      throw new Error(
        `Recipient row ${index + 2} has ${values.length} columns; expected ${header.length}.`,
      );
    return Object.fromEntries(header.map((name, i) => [name, values[i]!]));
  });
  // Validate the header even when the file contains no records.
  validateMailMergeRecords([
    Object.fromEntries(header.map((name) => [name, ""])),
  ]);
  return validateMailMergeRecords(data);
}

function comparable(
  value: MailMergeValue | undefined,
  type: MailMergeValueType,
): string | number | null {
  if (blank(value)) return null;
  if (type === "Text") return String(value);
  if (type === "Number") {
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseFieldNumber(value)
          : undefined;
    if (number === undefined)
      throw new TypeError(
        `Invalid numeric recipient value: ${String(value).slice(0, 80)}`,
      );
    return number;
  }
  const text = String(value);
  if (
    !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.test(
      text,
    )
  )
    throw new TypeError(
      "Date comparisons require ISO dates or timezone-qualified timestamps.",
    );
  if (
    text.length > 10 &&
    (Number(text.slice(11, 13)) > 23 ||
      Number(text.slice(14, 16)) > 59 ||
      (text[16] === ":" && Number(text.slice(17, 19)) > 59))
  )
    throw new TypeError("Invalid clock time in recipient data.");
  const date = Date.parse(text),
    day = text.slice(0, 10);
  if (
    !Number.isFinite(date) ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day
  )
    throw new TypeError("Invalid calendar date in recipient data.");
  return date;
}

/** Stable, deterministic query plan. No input data or query object is mutated. */
export function createMailMergePlan(
  input: unknown,
  options: MailMergeOptions = {},
): MailMergePlan {
  const rows = validateMailMergeRecords(input);
  if (!record(options as unknown))
    throw new TypeError("Mail merge options must be a plain object.");
  const validKeys = new Set([
    "Filters",
    "Match",
    "Sort",
    "Locale",
    "CaseSensitive",
    "Include",
    "Exclude",
    "FirstRecord",
    "LastRecord",
    "FailOnUnresolved",
  ]);
  for (const key of Object.getOwnPropertyNames(options)) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value"))
      throw new TypeError("Query accessors are not supported.");
    if (!validKeys.has(key))
      throw new TypeError(`Unknown mail merge option: ${key}`);
  }
  for (const key of ["CaseSensitive", "FailOnUnresolved"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      throw new TypeError(`${key} must be boolean.`);
  if (
    options.Locale !== undefined &&
    (typeof options.Locale !== "string" || !options.Locale.trim())
  )
    throw new TypeError("Locale must be nonempty.");
  if (options.Match !== undefined && !["All", "Any"].includes(options.Match))
    throw new TypeError("Match must be All or Any.");
  const filters = queryArray<MailMergeCondition>(
      options.Filters ?? [],
      mailMergeLimits.Filters,
      "Filter query",
    ),
    sorts = queryArray<MailMergeSort>(
      options.Sort ?? [],
      mailMergeLimits.SortKeys,
      "Sort query",
    );
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const collator = new Intl.Collator(options.Locale ?? "en", {
    sensitivity: options.CaseSensitive ? "variant" : "accent",
  });
  const compare = (a: string | number | null, b: string | number | null) =>
    a === null || b === null
      ? a === b
        ? 0
        : a === null
          ? 1
          : -1
      : typeof a === "number" && typeof b === "number"
        ? Math.sign(a - b)
        : collator.compare(String(a), String(b));
  const validateKey = (
    key: MailMergeSort | MailMergeCondition,
    names: string[],
  ) => {
    if (!record(key as unknown))
      throw new TypeError("Query keys must be plain objects.");
    for (const name of Object.getOwnPropertyNames(key)) {
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(key, name)!, "value"))
        throw new TypeError("Query accessors are not supported.");
      if (!names.includes(name))
        throw new TypeError(`Unknown query key: ${name}`);
    }
    if (
      !record(key as unknown) ||
      typeof key.Field !== "string" ||
      !fields.includes(key.Field)
    )
      throw new TypeError(
        "A query field is not present in the recipient data.",
      );
    if (
      key.Type !== undefined &&
      !["Text", "Number", "Date"].includes(key.Type)
    )
      throw new TypeError("Comparison type must be Text, Number or Date.");
  };
  const operations = [
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
  ];
  const compiled = filters.map((filter) => {
    validateKey(filter, ["Field", "Operator", "Type", "Value"]);
    if (!operations.includes(filter.Operator))
      throw new TypeError("Unsupported recipient comparison.");
    const isBlank = ["Blank", "NotBlank"].includes(filter.Operator),
      type = filter.Type ?? "Text";
    if (!isBlank && !scalar(filter.Value))
      throw new TypeError("A scalar comparison value is required.");
    if (
      ["Contains", "NotContains"].includes(filter.Operator) &&
      type !== "Text"
    )
      throw new TypeError("Contains requires a text comparison.");
    const right = isBlank ? null : comparable(filter.Value, type);
    return (row: MailMergeRecord) => {
      const value = read(row, filter.Field);
      if (isBlank)
        return filter.Operator === "Blank" ? blank(value) : !blank(value);
      const left = comparable(value, type);
      if (["Contains", "NotContains"].includes(filter.Operator)) {
        const normalize = (s: string) =>
          options.CaseSensitive
            ? s
            : s.toLocaleLowerCase(options.Locale ?? "en");
        const contains = normalize(String(value ?? "")).includes(
          normalize(String(filter.Value ?? "")),
        );
        return filter.Operator === "Contains" ? contains : !contains;
      }
      const order = compare(left, right);
      if (filter.Operator === "Equal") return order === 0;
      if (filter.Operator === "NotEqual") return order !== 0;
      if (left === null || right === null) return false;
      return filter.Operator === "Less"
        ? order < 0
        : filter.Operator === "LessOrEqual"
          ? order <= 0
          : filter.Operator === "Greater"
            ? order > 0
            : order >= 0;
    };
  });
  for (const sort of sorts) {
    validateKey(sort, ["Field", "Type", "Descending"]);
    if (sort.Descending !== undefined && typeof sort.Descending !== "boolean")
      throw new TypeError("Descending must be boolean.");
  }
  const selection = (numbers: number[] | undefined) => {
    if (numbers === undefined) return undefined;
    const values = queryArray<number>(
      numbers,
      rows.length,
      "Recipient selection",
    );
    if (values.some((n) => !positive(n) || n > rows.length))
      throw new RangeError(
        "Recipient selection requires valid one-based source row numbers.",
      );
    if (new Set(values).size !== values.length)
      throw new RangeError("Duplicate recipient selection number.");
    return new Set(values);
  };
  const include = selection(options.Include),
    exclude = selection(options.Exclude);
  const first = options.FirstRecord ?? 1,
    last = options.LastRecord ?? Number.MAX_SAFE_INTEGER;
  if (!positive(first) || !positive(last) || last < first)
    throw new RangeError("Invalid mail merge record range.");
  let entries = rows
    .map((Data, index) => ({ Data, SourceRecord: index + 1 }))
    .filter(({ Data }) => {
      // Evaluate every condition so malformed values are not hidden by short circuiting.
      const matched = compiled.map((filter) => filter(Data));
      return (
        !matched.length ||
        (options.Match === "Any"
          ? matched.some(Boolean)
          : matched.every(Boolean))
      );
    })
    .map((entry) => ({
      ...entry,
      keys: sorts.map((sort) =>
        comparable(read(entry.Data, sort.Field), sort.Type ?? "Text"),
      ),
    }));
  entries.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const left = a.keys[i]!,
        right = b.keys[i]!;
      const order =
        compare(left, right) *
        (left !== null && right !== null && sorts[i]!.Descending ? -1 : 1);
      if (order) return order;
    }
    return a.SourceRecord - b.SourceRecord;
  });
  const recipients: MailMergeRecipient[] = [];
  entries.forEach((entry, index) => {
    if (
      index + 1 < first ||
      index + 1 > last ||
      (include && !include.has(entry.SourceRecord)) ||
      exclude?.has(entry.SourceRecord)
    )
      return;
    recipients.push({
      Data: entry.Data,
      SourceRecord: entry.SourceRecord,
      RecordNumber: index + 1,
      SequenceNumber: recipients.length + 1,
    });
  });
  return {
    Fields: fields,
    TotalRecords: rows.length,
    MatchedRecords: entries.length,
    Recipients: recipients,
  };
}
