import { nodeStyleProperties } from "./document-styles.js";
import type { DocumentNode } from "./model.js";

/** Internal immutable-tree helpers. Public offsets count UTF-16 code units. */
export interface TextBlock {
  node: DocumentNode;
  parent: DocumentNode;
  index: number;
  start: number;
  end: number;
  text: string;
}
export interface TextLeaf {
  node: DocumentNode;
  start: number;
  end: number;
  props: Record<string, unknown>;
}
let sequence = 0;
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `rtw-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
export const clone = <T>(value: T): T => structuredClone(value);
export const makeNode = (
  type: string,
  children: DocumentNode[] = [],
  props: Record<string, any> = {},
): DocumentNode => ({ type, id: uid(), props, children });
export const run = (
  text: string,
  props: Record<string, any> = {},
): DocumentNode => ({ type: "Run", id: uid(), props: { ...props }, text });
export function newIds(node: DocumentNode): DocumentNode {
  const copy = clone(node);
  const visit = (n: DocumentNode) => {
    n.id = uid();
    n.children?.forEach(visit);
  };
  visit(copy);
  return copy;
}
export function inlineText(node: DocumentNode): string {
  if (node.type === "Run") return node.text ?? "";
  if (node.type === "LineBreak") return "\n";
  if (
    [
      "Equation",
      "Image",
      "InlineUIContainer",
      "BlockUIContainer",
      "Figure",
      "Floater",
    ].includes(node.type)
  )
    return "\uFFFC";
  return (node.children ?? []).map(inlineText).join("");
}
export function textBlocks(root: DocumentNode): TextBlock[] {
  const result: TextBlock[] = [];
  let offset = 0;
  const visit = (node: DocumentNode) =>
    (node.children ?? []).forEach((child, index) => {
      if (child.type === "Paragraph" || child.type === "BlockUIContainer") {
        if (result.length) offset++;
        const text = inlineText(child);
        result.push({
          node: child,
          parent: node,
          index,
          start: offset,
          end: offset + text.length,
          text,
        });
        offset += text.length;
      } else visit(child);
    });
  visit(root);
  return result;
}
export const plainText = (root: DocumentNode): string =>
  textBlocks(root)
    .map((block) => block.text)
    .join("\n");
export function effectiveProps(
  node: DocumentNode,
  inherited: Record<string, unknown> = {},
): Record<string, unknown> {
  const semantic: Record<string, unknown> =
    node.type === "Bold"
      ? { FontWeight: "Bold" }
      : node.type === "Italic"
        ? { FontStyle: "Italic" }
        : node.type === "Underline"
          ? { TextDecorations: "Underline" }
          : {};
  return {
    ...inherited,
    ...nodeStyleProperties(
      node.type,
      node.props,
      inherited.DocumentStyles ?? node.props.DocumentStyles,
    ),
    ...semantic,
    ...node.props,
  };
}
export function leaves(root: DocumentNode): TextLeaf[] {
  const result: TextLeaf[] = [];
  let offset = 0;
  let hasBlock = false;
  const visit = (node: DocumentNode, inherited: Record<string, unknown>) => {
    const props = effectiveProps(node, inherited);
    if (node.type === "Paragraph" || node.type === "BlockUIContainer") {
      if (hasBlock) offset++;
      hasBlock = true;
    }
    if (
      [
        "Run",
        "LineBreak",
        "Equation",
        "Image",
        "InlineUIContainer",
        "BlockUIContainer",
        "Figure",
        "Floater",
      ].includes(node.type)
    ) {
      const length = inlineText(node).length;
      result.push({ node, start: offset, end: offset + length, props });
      offset += length;
    } else (node.children ?? []).forEach((child) => visit(child, props));
  };
  visit(root, {});
  return result;
}
/** Slice inline nodes without flattening spans, hyperlinks, or object atoms. */
export function sliceInlines(
  nodes: DocumentNode[],
  start: number,
  end: number,
  fresh = false,
): DocumentNode[] {
  const result: DocumentNode[] = [];
  let offset = 0;
  for (const node of nodes) {
    const length = inlineText(node).length;
    const from = Math.max(0, start - offset),
      to = Math.min(length, end - offset);
    if (to > from) {
      let copy = clone(node);
      if (copy.type === "Run") copy.text = (copy.text ?? "").slice(from, to);
      else if (
        copy.children &&
        ![
          "InlineUIContainer",
          "Equation",
          "Image",
          "Figure",
          "Floater",
        ].includes(copy.type)
      )
        copy.children = sliceInlines(copy.children, from, to);
      if (fresh) copy = newIds(copy);
      result.push(copy);
    }
    offset += length;
  }
  return result;
}
export function pointBlock(root: DocumentNode, offset: number): TextBlock {
  let blocks = textBlocks(root);
  if (!blocks.length) {
    (root.children ??= []).push(makeNode("Paragraph"));
    blocks = textBlocks(root);
  }
  return (
    blocks.find((block) => offset >= block.start && offset <= block.end) ??
    blocks[blocks.length - 1]
  );
}
export function deleteRange(
  root: DocumentNode,
  start: number,
  end: number,
): void {
  if (end <= start) return;
  const control = inlineControlAt(root, start, end);
  if (control && (start > control.start || end < control.end)) {
    const nested = makeNode("FlowDocument", [
      makeNode("Paragraph", control.node.children ?? []),
    ]);
    deleteRange(nested, start - control.start, end - control.start);
    control.node.children = nested.children![0].children;
    return;
  }
  const single = leaves(root).find(
    (leaf) =>
      leaf.node.type === "Run" && start >= leaf.start && end <= leaf.end,
  );
  if (single && !single.props.ContentControl) {
    const value = single.node.text ?? "";
    single.node.text =
      value.slice(0, start - single.start) + value.slice(end - single.start);
    return;
  }
  const blocks = textBlocks(root),
    first =
      blocks.find((block) => start >= block.start && start <= block.end) ??
      blocks[0];
  const last =
    blocks.find((block) => end >= block.start && end <= block.end) ??
    blocks[blocks.length - 1];
  if (!first || !last) return;
  for (const block of blocks) {
    if (block.end < start || block.start > end) continue;
    const from = Math.max(0, start - block.start),
      to = Math.min(block.text.length, end - block.start);
    if (block.node.type === "BlockUIContainer") {
      if (from === 0 && to >= 1) {
        block.node.type = "Paragraph";
        block.node.children = [];
        block.node.props = {};
      }
    } else if (to > from)
      block.node.children = [
        ...sliceInlines(block.node.children ?? [], 0, from),
        ...sliceInlines(block.node.children ?? [], to, block.text.length, true),
      ];
  }
  // Join paragraph boundaries only inside the same block collection. Table cells
  // and list-item containers remain valid and retain their independent identity.
  if (
    first !== last &&
    first.parent === last.parent &&
    first.node.type === "Paragraph" &&
    last.node.type === "Paragraph"
  ) {
    const siblings = first.parent.children!;
    const from = siblings.indexOf(first.node),
      to = siblings.indexOf(last.node);
    if (
      to > from &&
      siblings.slice(from, to + 1).every((node) => node.type === "Paragraph")
    ) {
      first.node.children = [
        ...(first.node.children ?? []),
        ...(last.node.children ?? []),
      ];
      siblings.splice(from + 1, to - from);
    }
  }
}
function inlineControlAt(
  root: DocumentNode,
  from: number,
  to = from,
): { node: DocumentNode; start: number; end: number } | undefined {
  const block = pointBlock(root, from);
  let found: { node: DocumentNode; start: number; end: number } | undefined;
  const visit = (node: DocumentNode, start: number) => {
    const end = start + inlineText(node).length;
    if (from < start || to > end) return;
    if (
      node.type === "Span" &&
      node.props.ContentControl &&
      (from !== to || (from > start && from < end))
    )
      found = { node, start, end };
    if (
      ["Figure", "Floater", "InlineUIContainer", "Equation", "Image"].includes(
        node.type,
      )
    )
      return;
    for (const child of node.children ?? []) {
      visit(child, start);
      start += inlineText(child).length;
    }
  };
  visit(block.node, block.start);
  return found;
}
export function replaceInlineControlText(
  root: DocumentNode,
  start: number,
  end: number,
  text: string,
  props: Record<string, any>,
): boolean {
  const control = inlineControlAt(root, start, end);
  if (!control || (start === control.start && end === control.end))
    return false;
  if (text.includes("\n") || text.includes("\r"))
    throw new Error("Use a block rich-text control for paragraph breaks.");
  const nested = makeNode("FlowDocument", [
    makeNode("Paragraph", control.node.children ?? []),
  ]);
  deleteRange(nested, start - control.start, end - control.start);
  if (text) insertText(nested, start - control.start, text, props);
  control.node.children = nested.children![0].children;
  return true;
}
/** A field/control edge belongs to surrounding text, not to the managed result. */
function isFieldBoundary(root: DocumentNode, offset: number): boolean {
  const block = pointBlock(root, offset);
  const visit = (node: DocumentNode, start: number): boolean => {
    const end = start + inlineText(node).length;
    if (offset < start || offset > end) return false;
    if (
      (node.props.Field || node.props.ContentControl) &&
      (offset === start || offset === end)
    )
      return true;
    if (
      ["Equation", "Image", "InlineUIContainer", "Figure", "Floater"].includes(
        node.type,
      )
    )
      return false;
    let next = start;
    for (const child of node.children ?? []) {
      if (visit(child, next)) return true;
      next += inlineText(child).length;
    }
    return false;
  };
  return visit(block.node, block.start);
}
function continuationParagraphProps(
  props: Record<string, any>,
): Record<string, any> {
  const result: Record<string, any> = {
    ...props,
    BreakPageBefore: false,
    BreakColumnBefore: false,
  };
  // These identify one authored caption/index entry; they are not paragraph formatting.
  delete result.Caption;
  delete result.CaptionInstance;
  delete result.TocTargetId;
  if (result.StyleName === "Caption") delete result.StyleName;
  return result;
}
export function insertText(
  root: DocumentNode,
  offset: number,
  text: string,
  props: Record<string, any>,
): number {
  const control = inlineControlAt(root, offset);
  if (control) {
    if (text.includes("\n") || text.includes("\r"))
      throw new Error("Use a block rich-text control for paragraph breaks.");
    const nested = makeNode("FlowDocument", [
      makeNode("Paragraph", control.node.children ?? []),
    ]);
    insertText(nested, offset - control.start, text, props);
    control.node.children = nested.children![0].children;
    return offset + text.length;
  }
  if (!text.includes("\n") && !text.includes("\r")) {
    const list = leaves(root),
      leaf =
        list.find(
          (item) =>
            item.node.type === "Run" &&
            item.start < offset &&
            item.end >= offset,
        ) ??
        list.find((item) => item.node.type === "Run" && item.start === offset);
    if (
      leaf &&
      !(
        (leaf.props.Field || leaf.props.ContentControl) &&
        isFieldBoundary(root, offset)
      ) &&
      Object.entries(props).every(
        ([name, value]) =>
          JSON.stringify(leaf.props[name]) === JSON.stringify(value),
      )
    ) {
      const local = offset - leaf.start,
        value = leaf.node.text ?? "";
      leaf.node.text = value.slice(0, local) + text + value.slice(local);
      return offset + text.length;
    }
  }
  const block = pointBlock(root, offset);
  if (block.node.type !== "Paragraph") {
    const paragraph = makeNode("Paragraph");
    block.parent.children!.splice(
      block.index + (offset > block.start ? 1 : 0),
      0,
      paragraph,
    );
    return insertText(
      root,
      textBlocks(root).find((item) => item.node === paragraph)!.start,
      text,
      props,
    );
  }
  const local = Math.min(block.text.length, Math.max(0, offset - block.start));
  const wrappers: DocumentNode[] = [];
  const findWrapper = (nodes: DocumentNode[], at: number) => {
    let position = 0;
    for (const node of nodes) {
      const length = inlineText(node).length;
      if (
        (at > position && at <= position + length) ||
        (at === 0 && position === 0)
      ) {
        if (node.type === "Hyperlink") wrappers.push(node);
        if (
          node.children &&
          !["Equation", "Image", "InlineUIContainer"].includes(node.type)
        )
          findWrapper(node.children, at - position);
        break;
      }
      position += length;
    }
  };
  findWrapper(block.node.children ?? [], local);
  const insertion = (value: string): DocumentNode =>
    wrappers.reduceRight(
      (child, wrapper) => makeNode(wrapper.type, [child], clone(wrapper.props)),
      run(value, props),
    );
  const before = sliceInlines(block.node.children ?? [], 0, local),
    after = sliceInlines(
      block.node.children ?? [],
      local,
      block.text.length,
      true,
    );
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 1)
    block.node.children = [
      ...before,
      ...(text ? [insertion(text)] : []),
      ...after,
    ];
  else {
    block.node.children = [
      ...before,
      ...(lines[0] ? [insertion(lines[0])] : []),
    ];
    const created = lines
      .slice(1)
      .map((line, index) =>
        makeNode(
          "Paragraph",
          [
            ...(line ? [insertion(line)] : []),
            ...(index === lines.length - 2 ? after : []),
          ],
          continuationParagraphProps(block.node.props),
        ),
      );
    block.parent.children!.splice(block.index + 1, 0, ...created);
  }
  return offset + lines.join("\n").length;
}
export function formatRange(
  root: DocumentNode,
  start: number,
  end: number,
  property: string,
  value: unknown,
): void {
  const walk = (node: DocumentNode, base: number): DocumentNode[] => {
    const length = inlineText(node).length;
    if (base >= end || base + length <= start) return [node];
    if (
      node.type === "Run" ||
      [
        "Equation",
        "Image",
        "InlineUIContainer",
        "LineBreak",
        "Figure",
        "Floater",
      ].includes(node.type)
    ) {
      const from = Math.max(0, start - base),
        to = Math.min(length, end - base);
      const before = sliceInlines([node], 0, from),
        middle = sliceInlines([node], from, to, from > 0),
        after = sliceInlines([node], to, length, true);
      for (const item of middle) {
        if (value === undefined) delete item.props[property];
        else item.props[property] = clone(value);
      }
      return [...before, ...middle, ...after];
    }
    let offset = base;
    node.children = (node.children ?? []).flatMap((child) => {
      const at = offset;
      offset += inlineText(child).length;
      return walk(child, at);
    });
    return [node];
  };
  for (const block of textBlocks(root)) {
    if (block.node.type !== "Paragraph") continue;
    let offset = block.start;
    block.node.children = (block.node.children ?? []).flatMap((child) => {
      const at = offset;
      offset += inlineText(child).length;
      return walk(child, at);
    });
  }
}
export function mapMetadata(
  root: DocumentNode,
  start: number,
  end: number,
  insertedLength: number,
): void {
  const shift = insertedLength - (end - start);
  const move = (value: number, trailing: boolean) =>
    value < start
      ? value
      : value > end
        ? value + shift
        : start + (trailing ? insertedLength : 0);
  const items = root.props.Annotations;
  if (Array.isArray(items))
    for (const item of items) {
      if (item.Kind === "Formatting")
        for (const change of item.Data?.PropertyChanges ?? [])
          if (change.Scope === "Inline") {
            change.Start = move(change.Start, false);
            change.End = Math.max(change.Start, move(change.End, true));
          }
      if (item.Kind === "Move" && Number.isInteger(item.Data?.SourceStart))
        item.Data.SourceStart = move(item.Data.SourceStart, false);
      item.Start = move(item.Start, false);
      item.End =
        item.Kind === "Deletion"
          ? item.Start
          : Math.max(item.Start, move(item.End, true));
    }
  // Auto-caption targets belong to their paragraph. A following paragraph break
  // must not grow the whole-caption bookmark into subsequent text/references.
  if (Array.isArray(items)) {
    const captions = new Map<string, TextBlock>();
    for (const block of textBlocks(root)) {
      const caption = block.node.props.Caption;
      if (caption?.Id !== block.node.id) continue;
      for (const key of ["Bookmark", "NumberBookmark", "LabelNumberBookmark"])
        if (typeof caption[key] === "string") captions.set(caption[key], block);
    }
    for (const item of items) {
      const caption = item.Kind === "Bookmark" && captions.get(item.Data?.Name);
      if (!caption) continue;
      item.Start = Math.max(caption.start, Math.min(item.Start, caption.end));
      item.End = Math.max(item.Start, Math.min(item.End, caption.end));
    }
  }
}
