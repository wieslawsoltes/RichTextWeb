import type { DocumentNode } from "./model.js";
import { plainText, makeNode, clone } from "./engine-tree.js";
import { parseFieldNumber } from "./field-code.js";
export interface TableCellOrigin {
  node: DocumentNode;
  row: number;
  column: number;
  width: number;
  height: number;
}
export interface TableGrid {
  rows: DocumentNode[];
  slots: DocumentNode[][];
  origins: Map<string, TableCellOrigin>;
  width: number;
  headerRows: Set<number>;
}
/** A bounded logical grid shared by structural editing, sorting and formula resolution. */
export function buildTableGrid(table: DocumentNode): TableGrid {
  if (table.type !== "Table") throw new TypeError("Expected a Table node.");
  const rows: DocumentNode[] = [],
    headerRows = new Set<number>();
  for (const group of table.children ?? [])
    for (const row of group.children ?? []) {
      if (row.type !== "TableRow") throw new TypeError("Invalid table row.");
      if (
        group.props.IsHeader ||
        row.props.IsHeader ||
        (row.children?.length &&
          row.children.every((cell) => cell.props.IsHeader))
      )
        headerRows.add(rows.length);
      rows.push(row);
    }
  if (rows.length > 10000)
    throw new RangeError("Table limit is 10,000 grid cells.");
  const slots: DocumentNode[][] = [],
    origins = new Map<string, TableCellOrigin>();
  let width = 0;
  rows.forEach((row, y) => {
    const occupied = (slots[y] ??= []);
    let x = 0;
    for (const cell of row.children ?? []) {
      if (cell.type !== "TableCell") throw new TypeError("Invalid table cell.");
      while (occupied[x]) x++;
      const w = cell.props.ColumnSpan ?? 1,
        h = cell.props.RowSpan ?? 1;
      if (
        !Number.isInteger(w) ||
        !Number.isInteger(h) ||
        w < 1 ||
        h < 1 ||
        y + h > rows.length
      )
        throw new Error("Table spans exceed the available grid.");
      if ((x + w) * rows.length > 10000)
        throw new RangeError("Table limit is 10,000 grid cells.");
      origins.set(cell.id, {
        node: cell,
        row: y,
        column: x,
        width: w,
        height: h,
      });
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const target = (slots[y + dy] ??= []);
          if (target[x + dx]) throw new Error("Table spans overlap.");
          target[x + dx] = cell;
        }
      x += w;
      width = Math.max(width, x);
    }
  });
  if (
    !rows.length ||
    !width ||
    slots.some(
      (row) =>
        row.length !== width ||
        Array.from({ length: width }, (_, x) => row[x]).some((cell) => !cell),
    )
  )
    throw new Error("Table editing requires a complete rectangular grid.");
  return { rows, slots, origins, width, headerRows };
}
export interface TableSortKey {
  /** Zero-based logical column. */
  Column: number;
  Type?: "Text" | "Number" | "Date";
  Descending?: boolean;
}
export interface TableSortOptions {
  Keys: TableSortKey[];
  /** Defaults to the leading rows explicitly marked as headers. */
  HeaderRows?: number;
  Locale?: string;
  CaseSensitive?: boolean;
}
function dateValue(text: string): number {
  const input = text.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      input,
    )
  )
    throw new TypeError(
      "Date sorting requires ISO dates or timestamps with an explicit timezone.",
    );
  const value = Date.parse(input);
  const day = new Date(input.slice(0, 10) + "T00:00:00Z");
  if (
    !Number.isFinite(value) ||
    day.toISOString().slice(0, 10) !== input.slice(0, 10)
  )
    throw new TypeError("Invalid ISO date in sort column.");
  return value;
}
/** Sort a detached table, retaining rich row/cell IDs. Invalid data fails before any mutation. */
export function sortTableRows(
  table: DocumentNode,
  options: TableSortOptions,
): void {
  const grid = buildTableGrid(table);
  if (
    !options ||
    !Array.isArray(options.Keys) ||
    options.Keys.length < 1 ||
    options.Keys.length > 3
  )
    throw new TypeError("Table sorting requires one to three keys.");
  for (const key of options.Keys)
    if (
      !Number.isInteger(key.Column) ||
      key.Column < 0 ||
      key.Column >= grid.width ||
      !["Text", "Number", "Date"].includes(key.Type ?? "Text")
    )
      throw new RangeError("Invalid table sort key.");
  if (Array.from(grid.origins.values()).some((origin) => origin.height > 1))
    throw new Error("Split vertically merged cells before sorting a table.");
  let leadingHeaders = 0;
  while (grid.headerRows.has(leadingHeaders)) leadingHeaders++;
  const headers = options.HeaderRows ?? leadingHeaders;
  if (!Number.isInteger(headers) || headers < 0 || headers > grid.rows.length)
    throw new RangeError("Invalid header row count.");
  if (Array.from(grid.headerRows).some((row) => row >= headers))
    throw new Error("Header rows must precede all sorted data rows.");
  // Row-group formatting remains in place; rows are sorted within each body group.
  const collator = new Intl.Collator(options.Locale ?? "en", {
    sensitivity: options.CaseSensitive ? "variant" : "base",
  });
  let offset = 0;
  const replacements: { group: DocumentNode; rows: DocumentNode[] }[] = [];
  for (const group of table.children ?? []) {
    const rows = group.children ?? [],
      fixed = Math.min(rows.length, Math.max(0, headers - offset));
    const records = rows.slice(fixed).map((row, i) => ({
      row,
      index: i,
      keys: options.Keys.map((key) => {
        const text = plainText(grid.slots[offset + fixed + i]![key.Column]!);
        if (key.Type === "Number") {
          const value = parseFieldNumber(text);
          if (value === undefined)
            throw new TypeError(
              "Number sorting requires numeric cells in every selected sort column.",
            );
          return value;
        }
        return key.Type === "Date" ? dateValue(text) : text;
      }),
    }));
    records.sort((a, b) => {
      for (let k = 0; k < options.Keys.length; k++) {
        const left = a.keys[k]!,
          right = b.keys[k]!;
        const result =
          typeof left === "number" && typeof right === "number"
            ? Math.sign(left - right)
            : collator.compare(String(left), String(right));
        if (result) return result * (options.Keys[k]!.Descending ? -1 : 1);
      }
      return a.index - b.index;
    });
    replacements.push({
      group,
      rows: [...rows.slice(0, fixed), ...records.map((r) => r.row)],
    });
    offset += rows.length;
  }
  for (const replacement of replacements)
    replacement.group.children = replacement.rows;
}

/** Split mixed row groups at header boundaries so renderers produce real thead/tbody groups.
 * Row/cell identities and inherited group formatting are preserved. */
export function normalizeTableHeaderGroups(table: DocumentNode): void {
  const groups: DocumentNode[] = [];
  for (const group of table.children ?? []) {
    let current: DocumentNode | undefined;
    for (const row of group.children ?? []) {
      const header = !!(group.props.IsHeader || row.props.IsHeader);
      if (!current || !!current.props.IsHeader !== header) {
        current = current
          ? makeNode("TableRowGroup", [], clone(group.props))
          : { ...group, props: clone(group.props), children: [] };
        current.props.IsHeader = header;
        groups.push(current);
      }
      current.children!.push(row);
    }
  }
  table.children = groups;
}
