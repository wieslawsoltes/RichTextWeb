import type { DocumentNode } from "./model.js";
import { buildTableGrid, type TableGrid } from "./table-grid.js";
import { evaluateFormula } from "./formula.js";
import { parseFieldNumber } from "./field-code.js";
interface Location {
  table: DocumentNode;
  cell: DocumentNode;
}
export class TableFormulaEvaluator {
  private locations = new Map<string, Location>();
  private grids = new Map<string, TableGrid>();
  constructor(
    roots: DocumentNode[],
    private readField: (node: DocumentNode) => string | number | undefined,
    private readName: (name: string) => number | undefined,
  ) {
    const visit = (
      node: DocumentNode,
      table?: DocumentNode,
      cell?: DocumentNode,
    ) => {
      if (node.type === "Table") {
        table = node;
        cell = undefined;
      }
      if (node.type === "TableCell") cell = node;
      if (table && cell) this.locations.set(node.id, { table, cell });
      for (const child of node.children ?? []) visit(child, table, cell);
    };
    for (const root of roots) visit(root);
  }
  Evaluate(field: DocumentNode, expression: string): number {
    const location = this.locations.get(field.id);
    const grid = location
      ? (this.grids.get(location.table.id) ?? buildTableGrid(location.table))
      : undefined;
    if (location && grid) this.grids.set(location.table.id, grid);
    const origin = location && grid?.origins.get(location.cell.id);
    const cellText = (node: DocumentNode): string => {
      if (node.props.Field) {
        const value = this.readField(node);
        if (value === undefined)
          throw new Error("A referenced cell contains an unresolved field.");
        return String(value);
      }
      if (node.type === "Run") return node.text ?? "";
      if (node.type === "LineBreak") return "\n";
      if (
        [
          "Image",
          "Equation",
          "Figure",
          "Floater",
          "InlineUIContainer",
          "BlockUIContainer",
        ].includes(node.type)
      )
        return "\uFFFC";
      return (node.children ?? [])
        .map(cellText)
        .join(node.type === "TableCell" ? "\n" : "");
    };
    const coordinate = (input: string): [number, number] | undefined => {
      let match = /^R([1-9]\d*)C([1-9]\d*)$/i.exec(input);
      if (match) return [Number(match[1]) - 1, Number(match[2]) - 1];
      match = /^([A-Z]+)([1-9]\d*)$/i.exec(input);
      if (!match) return undefined;
      let column = 0;
      for (const c of match[1]!.toUpperCase())
        column = column * 26 + c.charCodeAt(0) - 64;
      return [Number(match[2]) - 1, column - 1];
    };
    return evaluateFormula(expression, {
      ResolveReference: (name, end) => {
        const key = name.toUpperCase(),
          from = coordinate(name),
          to = end ? coordinate(end) : undefined;
        const positional = ["LEFT", "RIGHT", "ABOVE", "BELOW"].includes(key);
        const axis = /^([RC])([1-9]\d*)?$/.exec(key);
        if (!from && !end && !positional && !axis) {
          const value = this.readName(name);
          if (value === undefined)
            throw new Error(`Unresolved formula reference: ${name}`);
          return value;
        }
        if (!grid || !origin || !location)
          throw new Error("Cell references require a formula inside a table.");
        if (end && (!from || !to))
          throw new SyntaxError(
            "Ranges require two A1 or RnCn cell references.",
          );
        let top = 0,
          bottom = grid.rows.length - 1,
          left = 0,
          right = grid.width - 1;
        if (from) {
          top = Math.min(from[0], to?.[0] ?? from[0]);
          bottom = Math.max(from[0], to?.[0] ?? from[0]);
          left = Math.min(from[1], to?.[1] ?? from[1]);
          right = Math.max(from[1], to?.[1] ?? from[1]);
        } else if (key === "LEFT" || key === "RIGHT") {
          top = bottom = origin.row;
          if (key === "LEFT") right = origin.column - 1;
          else left = origin.column + origin.width;
        } else if (key === "ABOVE" || key === "BELOW") {
          left = right = origin.column;
          if (key === "ABOVE") bottom = origin.row - 1;
          else top = origin.row + origin.height;
        } else if (axis) {
          if (axis[1] === "R")
            top = bottom = axis[2] ? Number(axis[2]) - 1 : origin.row;
          else left = right = axis[2] ? Number(axis[2]) - 1 : origin.column;
        }
        if (
          top < 0 ||
          left < 0 ||
          bottom >= grid.rows.length ||
          right >= grid.width
        )
          throw new RangeError(
            `Cell reference is outside the table: ${name}${end ? ":" + end : ""}`,
          );
        const seen = new Set<string>(),
          values: number[] = [];
        for (let y = top; y <= bottom; y++)
          for (let x = left; x <= right; x++) {
            if (positional && grid.headerRows.has(y)) continue;
            const cell = grid.slots[y]![x]!;
            // Word excludes the formula cell from its own ranges; merged cells count once.
            if (cell.id === location.cell.id || seen.has(cell.id)) continue;
            seen.add(cell.id);
            const value = parseFieldNumber(cellText(cell));
            if (value !== undefined) values.push(value);
            else if (from && !end)
              throw new TypeError(`Referenced cell is not numeric: ${name}`);
          }
        return from && !end ? (values[0] ?? 0) : values;
      },
    });
  }
}
