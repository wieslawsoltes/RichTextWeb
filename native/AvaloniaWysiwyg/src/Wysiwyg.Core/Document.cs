using System.Collections.Immutable;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace Wysiwyg.Core;

public enum ParagraphAlignment { Start, Center, End, Justify }
public enum ListKind { None, Bullet, Numbered, Check }
public enum ScriptKind { Normal, Subscript, Superscript }

/// <summary>Null values inherit paragraph/editor defaults. Dimensions are device-independent pixels.</summary>
public sealed record TextStyle
{
    public bool Bold { get; init; }
    public bool Italic { get; init; }
    public bool Underline { get; init; }
    public bool Strike { get; init; }
    public bool Code { get; init; }
    public string? FontFamily { get; init; }
    public double? FontSize { get; init; }
    public string? Foreground { get; init; }
    public string? Background { get; init; }
    public string? Link { get; init; }
    public ScriptKind Script { get; init; }
    public static TextStyle Default { get; } = new();
}
public sealed record ParagraphStyle
{
    public int HeadingLevel { get; init; }
    public ParagraphAlignment Alignment { get; init; }
    public ListKind List { get; init; }
    public int Indent { get; init; }
    public bool Checked { get; init; }
    public bool Quote { get; init; }
    public bool CodeBlock { get; init; }
    public bool RightToLeft { get; init; }
    public bool PageBreakBefore { get; init; }
    public double SpaceBefore { get; init; }
    public double SpaceAfter { get; init; } = 10;
    public double LineSpacing { get; init; } = 1.4;
    public static ParagraphStyle Default { get; } = new();
}
public sealed record TextRun(string Text, TextStyle Style)
{
    public TextRun(string text) : this(text, TextStyle.Default) { }
}
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(ParagraphBlock), "paragraph")]
[JsonDerivedType(typeof(TableBlock), "table")]
[JsonDerivedType(typeof(ImageBlock), "image")]
[JsonDerivedType(typeof(RuleBlock), "rule")]
public abstract record Block(string Id);
public sealed record ParagraphBlock(string Id, ImmutableArray<TextRun> Runs, ParagraphStyle Style) : Block(Id)
{
    [JsonIgnore] public string Text => ParagraphMetrics.Get(this).Text;
    [JsonIgnore] public int Length => Text.Length;
    public static ParagraphBlock Create(string text = "", ParagraphStyle? style = null, TextStyle? textStyle = null) =>
        new(Ids.New(), [new TextRun(text, textStyle ?? TextStyle.Default)], style ?? ParagraphStyle.Default);
}
public sealed record TableCell(string Id, ParagraphBlock Content, string? Background = null);
public sealed record TableRow(ImmutableArray<TableCell> Cells);
public sealed record TableBlock(string Id, ImmutableArray<TableRow> Rows, ImmutableArray<double> ColumnWidths, bool HasHeader = true) : Block(Id)
{
    [JsonIgnore] public int ColumnCount => Rows.IsDefaultOrEmpty || Rows[0] is null || Rows[0].Cells.IsDefault ? 0 : Rows[0].Cells.Length;
    public static TableBlock Create(int rows, int columns)
    {
        if (rows is < 1 or > 100 || columns is < 1 or > 20) throw new ArgumentOutOfRangeException(nameof(rows), "Tables support 1–100 rows and 1–20 columns.");
        return new(Ids.New(), Enumerable.Range(0, rows).Select(_ => new TableRow(Enumerable.Range(0, columns)
            .Select(_ => new TableCell(Ids.New(), ParagraphBlock.Create())).ToImmutableArray())).ToImmutableArray(), Enumerable.Repeat(1d, columns).ToImmutableArray());
    }
}
/// <summary>Embedded raster data only; opening documents never performs network requests.</summary>
public sealed record ImageBlock(string Id, string DataUri, string AltText, double Width, double Height, ParagraphAlignment Alignment = ParagraphAlignment.Center) : Block(Id);
public sealed record RuleBlock(string Id) : Block(Id);
public readonly record struct TextRange(int Start, int Length)
{
    [JsonIgnore] public int End => checked(Start + Length);
}
public readonly record struct EditorSelection(int Anchor, int Focus)
{
    [JsonIgnore] public int Start => Math.Min(Anchor, Focus);
    [JsonIgnore] public int End => Math.Max(Anchor, Focus);
    [JsonIgnore] public int Length => End - Start;
    [JsonIgnore] public bool IsEmpty => Anchor == Focus;
    [JsonIgnore] public TextRange Range => new(Start, Length);
}
public sealed record CommentThread(string Id, string Author, string Text, TextRange Range, DateTimeOffset CreatedAt, bool Resolved = false, bool Orphaned = false);
public sealed record RichDocument
{
    public const int CurrentSchemaVersion = 1;
    public int SchemaVersion { get; init; } = CurrentSchemaVersion;
    public string Title { get; init; } = "Untitled document";
    public ImmutableArray<Block> Blocks { get; init; } = [ParagraphBlock.Create()];
    public ImmutableArray<CommentThread> Comments { get; init; } = [];
    public static RichDocument Empty(string title = "Untitled document") => new() { Title = title };
    public static RichDocument FromText(string text, string title = "Untitled document") => new()
    { Title = title, Blocks = TextUtilities.CleanInput(text).Split('\n').Select(s => (Block)ParagraphBlock.Create(s)).ToImmutableArray() };
}
internal static class Ids { public static string New() => Guid.NewGuid().ToString("N"); }
internal sealed class ParagraphMetrics
{
    private static readonly ConditionalWeakTable<ParagraphBlock, ParagraphMetrics> Cache = new();
    public string Text { get; }
    public int Words { get; }
    private ParagraphMetrics(ParagraphBlock paragraph) { Text = string.Concat(paragraph.Runs.Select(r => r.Text)); Words = TextUtilities.WordCount(Text); }
    public static ParagraphMetrics Get(ParagraphBlock paragraph) => Cache.GetValue(paragraph, p => new(p));
}
/// <summary>One LF separates every editable leaf, including table cells. Offsets are UTF-16.</summary>
public sealed class DocumentIndex
{
    public sealed record Leaf(ParagraphBlock Paragraph, int BlockIndex, int Row, int Column, int Start)
    { public int End => Start + Paragraph.Length; public bool IsCell => Row >= 0; }
    private readonly Dictionary<string, int> _byId = new(StringComparer.Ordinal);
    public ImmutableArray<Leaf> Leaves { get; }
    public int Length { get; }
    private string? _text;
    public string Text => _text ??= string.Join("\n", Leaves.Select(l => l.Paragraph.Text));
    public DocumentIndex(RichDocument document)
    {
        var leaves = ImmutableArray.CreateBuilder<Leaf>();
        var offset = 0;
        for (var b = 0; b < document.Blocks.Length; b++)
        {
            if (document.Blocks[b] is ParagraphBlock p) Add(p, b, -1, -1);
            else if (document.Blocks[b] is TableBlock t)
                for (var r = 0; r < t.Rows.Length; r++) for (var c = 0; c < t.Rows[r].Cells.Length; c++) Add(t.Rows[r].Cells[c].Content, b, r, c);
        }
        Leaves = leaves.ToImmutable(); Length = Math.Max(0, offset - 1);
        void Add(ParagraphBlock p, int block, int row, int col) { _byId[p.Id] = leaves.Count; leaves.Add(new(p, block, row, col, offset)); offset = checked(offset + p.Length + 1); }
    }
    public Leaf At(int position)
    {
        if (Leaves.IsEmpty) throw new InvalidOperationException("A document requires an editable paragraph.");
        position = Math.Clamp(position, 0, Length);
        var lo = 0; var hi = Leaves.Length - 1;
        while (lo < hi) { var mid = (lo + hi + 1) / 2; if (Leaves[mid].Start <= position) lo = mid; else hi = mid - 1; }
        return Leaves[lo];
    }
    public Leaf? ById(string id) => _byId.TryGetValue(id, out var i) ? Leaves[i] : null;
    public int Ordinal(string id) => _byId.TryGetValue(id, out var i) ? i : -1;
    public IEnumerable<Leaf> Intersecting(EditorSelection selection)
    {
        var first = Ordinal(At(selection.Start).Paragraph.Id);
        var last = Ordinal(At(selection.IsEmpty ? selection.End : Math.Max(selection.Start, selection.End - 1)).Paragraph.Id);
        for (var i = first; i <= last; i++) yield return Leaves[i];
    }
}
internal static class ImmutableArrayExtensions
{
    public static int FindIndex<T>(this ImmutableArray<T> array, Func<T, bool> predicate) { for (var i = 0; i < array.Length; i++) if (predicate(array[i])) return i; return -1; }
}
