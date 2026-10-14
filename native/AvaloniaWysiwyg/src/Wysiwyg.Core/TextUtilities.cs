using System.Collections.Immutable;
using System.Globalization;
using System.Text;
namespace Wysiwyg.Core;
public static class TextUtilities
{
    public static string NormalizeNewlines(string text) => (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
    public static string CleanInput(string text)
    {
        var b = new StringBuilder(text.Length);
        foreach (var rune in NormalizeNewlines(text).EnumerateRunes()) if (!Rune.IsControl(rune) || rune.Value is '\n' or '\t') b.Append(rune);
        return b.ToString();
    }
    public static int Snap(string text, int position, bool forward = false)
    {
        position = Math.Clamp(position, 0, text.Length);
        if (position == 0 || position == text.Length) return position;
        var boundaries = StringInfo.ParseCombiningCharacters(text);
        var i = Array.BinarySearch(boundaries, position);
        if (i >= 0) return position;
        i = ~i;
        return forward ? (i < boundaries.Length ? boundaries[i] : text.Length) : boundaries[Math.Max(0, i - 1)];
    }
    public static int Previous(string text, int position) => position <= 0 ? 0 : Snap(text, Math.Min(position, text.Length) - 1);
    public static int Next(string text, int position) => position >= text.Length ? text.Length : Snap(text, Math.Max(0, position) + 1, true);
    private static int Category(string text, int p)
    {
        if (p < 0 || p >= text.Length) return -1;
        var r = Rune.GetRuneAt(text, p);
        return Rune.IsWhiteSpace(r) ? 0 : Rune.IsLetterOrDigit(r) || r.Value == '_' ? 1 : 2;
    }
    public static int PreviousWord(string text, int position)
    {
        var p = Previous(text, position);
        while (p > 0 && Category(text, p) == 0) p = Previous(text, p);
        var category = Category(text, p);
        while (p > 0) { var prev = Previous(text, p); if (Category(text, prev) != category) break; p = prev; }
        return p;
    }
    public static int NextWord(string text, int position)
    {
        var p = Snap(text, position); var category = Category(text, p);
        while (p < text.Length && Category(text, p) == category) p = Next(text, p);
        while (p < text.Length && Category(text, p) == 0) p = Next(text, p);
        return p;
    }
    public static TextRange WordAt(string text, int position)
    {
        if (text.Length == 0) return new(0, 0);
        var p = Snap(text, Math.Min(position, text.Length - 1)); var category = Category(text, p); var start = p; var end = Next(text, p);
        while (start > 0 && Category(text, Previous(text, start)) == category) start = Previous(text, start);
        while (end < text.Length && Category(text, end) == category) end = Next(text, end);
        return new(start, end - start);
    }
    public static int WordCount(string text)
    {
        var count = 0; var inWord = false;
        foreach (var rune in text.EnumerateRunes()) { var word = Rune.IsLetterOrDigit(rune); if (word && !inWord) count++; inWord = word; }
        return count;
    }
    public static ImmutableArray<TextRun> NormalizeRuns(IEnumerable<TextRun> runs)
    {
        var result = new List<TextRun>();
        foreach (var run in runs)
        {
            if (string.IsNullOrEmpty(run.Text)) continue;
            if (result.Count != 0 && result[^1].Style == run.Style) result[^1] = result[^1] with { Text = result[^1].Text + run.Text };
            else result.Add(run);
        }
        if (result.Count == 0) result.Add(new("", TextStyle.Default));
        return result.ToImmutableArray();
    }
    public static ImmutableArray<TextRun> SliceRuns(ParagraphBlock p, int start, int length)
    {
        var result = ImmutableArray.CreateBuilder<TextRun>(); var end = checked(start + length); var offset = 0;
        foreach (var run in p.Runs)
        {
            var a = Math.Max(start, offset); var b = Math.Min(end, offset + run.Text.Length);
            if (b > a) result.Add(run with { Text = run.Text.Substring(a - offset, b - a) });
            offset += run.Text.Length;
        }
        return result.ToImmutable();
    }
    public static TextStyle StyleAt(ParagraphBlock p, int offset)
    {
        offset = Math.Clamp(offset == 0 ? 0 : offset - 1, 0, Math.Max(0, p.Length - 1)); var x = 0;
        foreach (var run in p.Runs) { x += run.Text.Length; if (offset < x) return run.Style; }
        return p.Runs.Length > 0 ? p.Runs[^1].Style : TextStyle.Default;
    }
    public static ImmutableArray<TextRun> FormatRuns(ParagraphBlock p, int start, int length, Func<TextStyle, TextStyle> format) => NormalizeRuns(
        SliceRuns(p, 0, start).Concat(SliceRuns(p, start, length).Select(r => r with { Style = format(r.Style) })).Concat(SliceRuns(p, start + length, p.Length - start - length)));
}
