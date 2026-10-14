using System.Collections.Immutable;
using System.Diagnostics;
using System.Text.RegularExpressions;
namespace Wysiwyg.Core;
public sealed record SearchOptions(bool MatchCase = false, bool WholeWord = false, bool UseRegex = false, int MaxResults = 10000);
public sealed record SearchResult(TextRange Range, string Text, string ParagraphId);
public sealed partial class EditorSession
{
    public ImmutableArray<SearchResult> Find(string query, SearchOptions? options = null)
    {
        options ??= new(); if (string.IsNullOrEmpty(query)) return [];
        if (query.Length > 512) throw new ArgumentException("Search expressions are limited to 512 characters.", nameof(query));
        if (options.MaxResults is < 1 or > 10000) throw new ArgumentOutOfRangeException(nameof(options));
        var pattern = options.UseRegex ? query : Regex.Escape(query);
        if (options.WholeWord) pattern = @"(?<![\p{L}\p{N}_])(?:" + pattern + @")(?![\p{L}\p{N}_])";
        var regex = new Regex(pattern, RegexOptions.CultureInvariant | (options.MatchCase ? RegexOptions.None : RegexOptions.IgnoreCase), TimeSpan.FromMilliseconds(100));
        var result = ImmutableArray.CreateBuilder<SearchResult>(); var watch = Stopwatch.StartNew();
        foreach (Match m in regex.Matches(Index.Text))
        {
            if (watch.ElapsedMilliseconds > 500) throw new TimeoutException("Search exceeded its time budget. Use a simpler expression.");
            if (m.Length == 0 || Snap(m.Index) != m.Index || Snap(m.Index + m.Length) != m.Index + m.Length) continue;
            result.Add(new(new(m.Index, m.Length), m.Value, Index.At(m.Index).Paragraph.Id)); if (result.Count >= options.MaxResults) break;
        }
        return result.ToImmutable();
    }
    public SearchResult? FindNext(string query, SearchOptions? options = null, bool backward = false)
    {
        var matches = Find(query, options); if (matches.IsEmpty) return null;
        var m = backward ? matches.LastOrDefault(m => m.Range.End <= Selection.Start) ?? matches[^1]
            : matches.FirstOrDefault(m => m.Range.Start >= Selection.End && (Selection.IsEmpty || m.Range.Start != Selection.Start)) ?? matches[0];
        SetSelection(m.Range.Start, m.Range.End); return m;
    }
    /// <summary>Replacement is literal, also in regex mode. The whole batch is one undo step.</summary>
    public int ReplaceAll(string query, string replacement, SearchOptions? options = null)
    {
        if (IsReadOnly) return 0; replacement = TextUtilities.CleanInput(replacement); var matches = Find(query, options); if (matches.IsEmpty) return 0;
        if ((long)Index.Length + matches.Sum(m => (long)replacement.Length - m.Range.Length) > Limits.MaxCharacters) throw new DocumentValidationException("Replacement exceeds the configured text limit.");
        var next = Document; var selection = Selection;
        for (var i = matches.Length - 1; i >= 0; i--)
        {
            var m = matches[i]; var leaf = new DocumentIndex(next).At(m.Range.Start); var style = TextUtilities.StyleAt(leaf.Paragraph, m.Range.Start - leaf.Start);
            (next, selection) = DocumentEditing.Replace(next, new(m.Range.Start, m.Range.End), replacement, style);
        }
        Apply("Replace all", (next, selection)); return matches.Length;
    }
}
