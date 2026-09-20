import type { DocumentNode } from "./model.js";
import { inlineText, textBlocks } from "./engine-tree.js";

interface Range {
  Start: number;
  End: number;
}
interface Entry extends Range {
  Node: DocumentNode;
}
const atomic = new Set([
  "Run",
  "LineBreak",
  "Image",
  "Equation",
  "Figure",
  "Floater",
  "InlineUIContainer",
  "BlockUIContainer",
]);
const containers = new Set([
  "FlowDocument",
  "Section",
  "List",
  "ListItem",
  "Table",
  "TableRowGroup",
  "TableRow",
  "TableCell",
]);

/** Internal reader of pending field results in original, not already shifted, coordinates. */
export class FieldReferenceReader {
  private readonly entries: Entry[];
  private readonly owners = new WeakMap<
    DocumentNode,
    { Field: DocumentNode; Start: number; End: number; Length: number }
  >();
  private work = 0;
  private characters = 0;

  constructor(
    private readonly source: string,
    fields: DocumentNode[],
    ranges: WeakMap<DocumentNode, Range>,
    private readonly resolve: (node: DocumentNode) => string | undefined,
  ) {
    this.entries = fields
      .flatMap((Node) => {
        const range = ranges.get(Node);
        return range ? [{ ...range, Node }] : [];
      })
      .sort((a, b) => a.Start - b.Start || a.End - b.End);
    for (const Field of fields) {
      let offset = 0;
      const Length = inlineText(Field).length;
      const visit = (node: DocumentNode) => {
        this.tick();
        const Start = offset;
        if (atomic.has(node.type)) offset += inlineText(node).length;
        else for (const child of node.children ?? []) visit(child);
        this.owners.set(node, { Field, Start, End: offset, Length });
      };
      for (const child of Field.children ?? []) visit(child);
    }
  }

  private tick(): void {
    if (++this.work > 100_000)
      throw new RangeError("Field reference traversal exceeds 100,000 steps.");
  }
  private checked(value: string): string {
    this.characters += value.length;
    if (value.length > 1_000_000 || this.characters > 8_000_000)
      throw new RangeError(
        "Field reference text exceeds its expansion budget.",
      );
    return value;
  }
  private field(node: DocumentNode): string {
    this.tick();
    const value = this.resolve(node);
    if (value === undefined)
      throw new Error(`Unresolved field reference dependency: ${node.id}`);
    return this.checked(value);
  }
  private join(values: Iterable<string>, separator = ""): string {
    const parts: string[] = [];
    let size = 0;
    for (const value of values) {
      this.tick();
      size += value.length + (parts.length ? separator.length : 0);
      if (size > 1_000_000)
        throw new RangeError(
          "Field reference text exceeds its expansion budget.",
        );
      parts.push(value);
    }
    return this.checked(parts.join(separator));
  }

  /** Read an explicit node target, including fields in independent stories. */
  Node(node: DocumentNode): string {
    this.tick();
    const owner = this.owners.get(node);
    if (owner) {
      if (node.props.Field || owner.Start !== 0 || owner.End !== owner.Length)
        throw new Error(
          "Reference targets a partial or nested field-result node; cached reference retained.",
        );
      return this.field(owner.Field);
    }
    if (node.props.Field) return this.field(node);
    if (atomic.has(node.type)) return this.checked(inlineText(node));
    const reader = this;
    if (containers.has(node.type)) {
      const blocks = textBlocks(node);
      return this.join(
        (function* () {
          for (const block of blocks) yield reader.Node(block.node);
        })(),
        "\n",
      );
    }
    return this.join(
      (function* () {
        for (const child of node.children ?? []) yield reader.Node(child);
      })(),
    );
  }

  /** A bookmark may include whole fields, never an ambiguous fraction of a replaced cache. */
  Bookmark(start: number, end: number): string {
    this.tick();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.source.length
    )
      throw new RangeError("Invalid bookmark reference range.");
    if (start === end) return "";
    // Match bookmark affinity: empty caches at either bookmark edge are outside.
    // Lower bound by end position; all fields ending at start do not overlap.
    let low = 0,
      high = this.entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1,
        entry = this.entries[mid]!;
      if (entry.End <= start) low = mid + 1;
      else high = mid;
    }
    const reader = this;
    return this.join(
      (function* () {
        let cursor = start;
        for (let index = low; index < reader.entries.length; index++) {
          reader.tick();
          const entry = reader.entries[index]!;
          if (entry.Start >= end) break;
          if (entry.Start < start || entry.End > end)
            throw new Error(
              "Bookmark partly overlaps a field result; cached reference retained.",
            );
          yield reader.source.slice(cursor, entry.Start);
          yield reader.field(entry.Node);
          cursor = entry.End;
        }
        yield reader.source.slice(cursor, end);
      })(),
    );
  }
}
