import type { DocumentNode, FlowDocument } from "./model.js";
import { plainText, textBlocks } from "./engine-tree.js";
export interface DocumentStatisticsOptions {
  Locale?: string;
  /** Main-story UTF-16 selection; notes are not added to a selection. */
  Start?: number;
  End?: number;
  IncludeNotes?: boolean;
}
export interface DocumentStatistics {
  Words: number;
  Characters: number;
  CharactersWithoutSpaces: number;
  Paragraphs: number;
  /** Logical line separators, not typeset lines. */
  Lines: number;
}
/** Unicode word segmentation; character counts use code points and exclude object placeholders. */
export function getDocumentStatistics(
  document: FlowDocument | DocumentNode,
  options: DocumentStatisticsOptions = {},
): DocumentStatistics {
  const root = "ToJSON" in document ? document.ToJSON() : document;
  const source = plainText(root),
    start = options.Start ?? 0,
    end = options.End ?? source.length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length
  )
    throw new RangeError("Statistics selection is outside the document.");
  const selected = options.Start !== undefined || options.End !== undefined;
  let text = source.slice(start, end),
    paragraphs = textBlocks(root).filter((b) =>
      selected ? b.end >= start && b.start < end : true,
    ).length;
  if (!selected && options.IncludeNotes)
    for (const kind of ["Footnotes", "Endnotes"])
      for (const note of root.props[kind] ?? []) {
        const story: DocumentNode = {
          type: "FlowDocument",
          id: "statistics",
          props: {},
          children: note.Blocks,
        };
        const value = plainText(story);
        if (value) text += (text ? "\n" : "") + value;
        paragraphs += textBlocks(story).length;
      }
  const wordText = text.replaceAll("\uFFFC", " ");
  text = text.replaceAll("\uFFFC", "");
  const segmenter = new Intl.Segmenter(options.Locale ?? "en", {
    granularity: "word",
  });
  const chars = Array.from(text.replace(/\r?\n/g, ""));
  return {
    Words: Array.from(segmenter.segment(wordText)).filter((s) => s.isWordLike)
      .length,
    Characters: chars.length,
    CharactersWithoutSpaces: chars.filter((c) => !/\s/u.test(c)).length,
    Paragraphs: selected && start === end ? 0 : paragraphs,
    Lines: text ? text.split("\n").length : 0,
  };
}
