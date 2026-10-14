using System.Collections.Immutable;
namespace Wysiwyg.Core;
internal static class DocumentEditing
{
    public static RichDocument SetParagraph(RichDocument doc, DocumentIndex.Leaf leaf, ParagraphBlock paragraph)
    {
        if (!leaf.IsCell) return doc with { Blocks = doc.Blocks.SetItem(leaf.BlockIndex, paragraph) };
        var table = (TableBlock)doc.Blocks[leaf.BlockIndex]; var row = table.Rows[leaf.Row];
        row = row with { Cells = row.Cells.SetItem(leaf.Column, row.Cells[leaf.Column] with { Content = paragraph }) };
        return doc with { Blocks = doc.Blocks.SetItem(leaf.BlockIndex, table with { Rows = table.Rows.SetItem(leaf.Row, row) }) };
    }
    public static (RichDocument Document, EditorSelection Selection) Replace(RichDocument doc, EditorSelection selection, string input, TextStyle style)
    {
        var index = new DocumentIndex(doc); var first = index.At(selection.Start); var last = index.At(selection.End);
        var from = Math.Clamp(selection.Start - first.Start, 0, first.Paragraph.Length); var to = Math.Clamp(selection.End - last.Start, 0, last.Paragraph.Length);
        var text = TextUtilities.CleanInput(input); RichDocument next; string targetId; int targetOffset;
        if (!first.IsCell && !last.IsCell && doc.Blocks.Skip(first.BlockIndex).Take(last.BlockIndex - first.BlockIndex + 1).All(b => b is ParagraphBlock))
        {
            var lines = text.Split('\n'); var paragraphs = new List<Block>();
            var prefix = TextUtilities.SliceRuns(first.Paragraph, 0, from); var suffix = TextUtilities.SliceRuns(last.Paragraph, to, last.Paragraph.Length - to);
            for (var i = 0; i < lines.Length; i++)
            {
                var runs = (i == 0 ? prefix : ImmutableArray<TextRun>.Empty).Concat(new[] { new TextRun(lines[i], style) }).Concat(i == lines.Length - 1 ? suffix : ImmutableArray<TextRun>.Empty);
                var ps = first.Paragraph.Style;
                if (i > 0) ps = ps with { PageBreakBefore = false, Checked = false, HeadingLevel = 0 };
                paragraphs.Add(new ParagraphBlock(i == 0 ? first.Paragraph.Id : Ids.New(), TextUtilities.NormalizeRuns(runs), ps));
            }
            var blocks = doc.Blocks.ToBuilder(); blocks.RemoveRange(first.BlockIndex, last.BlockIndex - first.BlockIndex + 1); blocks.InsertRange(first.BlockIndex, paragraphs);
            next = doc with { Blocks = blocks.ToImmutable() }; targetId = paragraphs[^1].Id; targetOffset = (lines.Length == 1 ? from : 0) + lines[^1].Length;
            next = MapComments(next, selection.Start, selection.Length, text.Length);
        }
        else
        {
            // Crossing cell/table boundaries clears selected text, never silently destroys a table grid.
            text = text.Replace('\n', '\u2028'); next = doc;
            var aIndex = index.Ordinal(first.Paragraph.Id); var bIndex = index.Ordinal(last.Paragraph.Id);
            for (var i = aIndex; i <= bIndex; i++)
            {
                var leaf = index.Leaves[i]; var a = i == aIndex ? from : 0; var b = i == bIndex ? to : leaf.Paragraph.Length;
                var replacement = i == aIndex ? text : "";
                var runs = TextUtilities.SliceRuns(leaf.Paragraph, 0, a).Concat(new[] { new TextRun(replacement, style) }).Concat(TextUtilities.SliceRuns(leaf.Paragraph, b, leaf.Paragraph.Length - b));
                next = SetParagraph(next, leaf, leaf.Paragraph with { Runs = TextUtilities.NormalizeRuns(runs) });
            }
            targetId = first.Paragraph.Id; targetOffset = from + text.Length;
            for (var i = bIndex; i >= aIndex; i--)
            {
                var leaf = index.Leaves[i]; var a = i == aIndex ? from : 0; var b = i == bIndex ? to : leaf.Paragraph.Length;
                next = MapComments(next, leaf.Start + a, b - a, i == aIndex ? text.Length : 0);
            }
        }
        var caret = new DocumentIndex(next).ById(targetId)!.Start + targetOffset;
        return (next, new(caret, caret));
    }
    public static RichDocument MapComments(RichDocument doc, int start, int removed, int inserted)
    {
        if (doc.Comments.IsEmpty || removed == 0 && inserted == 0) return doc;
        var end = start + removed;
        return doc with { Comments = doc.Comments.Select(c =>
        {
            var a = Map(c.Range.Start, true); var b = Math.Max(a, Map(c.Range.End, false));
            return c with { Range = new(a, b - a), Orphaned = c.Orphaned || c.Range.Length > 0 && b == a && removed > 0 };
        }).ToImmutableArray() };
        int Map(int p, bool isStart)
        {
            if (removed == 0) return p < start || p == start && !isStart ? p : p + inserted;
            if (p <= start) return p; if (p >= end) return p + inserted - removed; return isStart ? start : start + inserted;
        }
    }
    public static RichDocument MapStructuralChange(RichDocument before, RichDocument after)
    {
        if (before.Comments.IsEmpty || !before.Comments.Equals(after.Comments)) return after;
        var a = new DocumentIndex(before).Text; var b = new DocumentIndex(after).Text; if (a == b) return after;
        var prefix = 0; while (prefix < Math.Min(a.Length, b.Length) && a[prefix] == b[prefix]) prefix++;
        prefix = Math.Min(TextUtilities.Snap(a, prefix), TextUtilities.Snap(b, prefix));
        var suffix = 0; while (suffix < Math.Min(a.Length, b.Length) - prefix && a[^(suffix + 1)] == b[^(suffix + 1)]) suffix++;
        return MapComments(after, prefix, TextUtilities.Snap(a, a.Length - suffix, true) - prefix, TextUtilities.Snap(b, b.Length - suffix, true) - prefix);
    }
}
