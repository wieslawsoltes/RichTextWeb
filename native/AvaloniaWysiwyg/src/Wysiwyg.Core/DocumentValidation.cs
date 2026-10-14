using System.Text.RegularExpressions;
namespace Wysiwyg.Core;
public sealed record DocumentLimits
{
    public int MaxBlocks { get; init; } = 10000;
    public int MaxCharacters { get; init; } = 2000000;
    public int MaxParagraphCharacters { get; init; } = 100000;
    public int MaxRuns { get; init; } = 200000;
    public int MaxTableRows { get; init; } = 100;
    public int MaxTableColumns { get; init; } = 20;
    public int MaxImageBytes { get; init; } = 8 * 1024 * 1024;
    public int MaxTotalImageBytes { get; init; } = 24 * 1024 * 1024;
    public int MaxSerializedBytes { get; init; } = 40 * 1024 * 1024;
    public int MaxComments { get; init; } = 2000;
    public static DocumentLimits Default { get; } = new();
}
public sealed class DocumentValidationException(string message) : ArgumentException(message);
public static partial class DocumentValidation
{
    [GeneratedRegex("^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant)] private static partial Regex ColorPattern();
    [GeneratedRegex("^[\\p{L}\\p{N} _,.-]{1,100}$", RegexOptions.CultureInvariant)] private static partial Regex FontPattern();
    public static bool IsColor(string? color) => color is null || ColorPattern().IsMatch(color);
    public static bool IsSafeLink(string? value) => value is null || value.Length <= 2048 && Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme is "http" or "https" or "mailto") && !value.Any(char.IsControl);
    public static TextStyle ValidateStyle(TextStyle style)
    {
        if (style is null) throw new DocumentValidationException("A text style cannot be null.");
        if (style.FontSize is { } size && (!double.IsFinite(size) || size is < 6 or > 144)) throw new DocumentValidationException("Font size must be 6–144 pixels.");
        if (style.FontFamily is { } family && !FontPattern().IsMatch(family)) throw new DocumentValidationException("Invalid font family.");
        if (!IsColor(style.Foreground) || !IsColor(style.Background)) throw new DocumentValidationException("Colors must use #RRGGBB.");
        if (!IsSafeLink(style.Link)) throw new DocumentValidationException("Links must use http, https or mailto.");
        if (!Enum.IsDefined(style.Script)) throw new DocumentValidationException("Unknown script style.");
        return style;
    }
    public static ParagraphStyle ValidateParagraphStyle(ParagraphStyle s)
    {
        if (s is null || s.HeadingLevel is < 0 or > 6 || s.Indent is < 0 or > 8 || !Enum.IsDefined(s.Alignment) || !Enum.IsDefined(s.List) ||
            !double.IsFinite(s.LineSpacing) || s.LineSpacing is < 1 or > 3 || !double.IsFinite(s.SpaceBefore) || s.SpaceBefore is < 0 or > 200 ||
            !double.IsFinite(s.SpaceAfter) || s.SpaceAfter is < 0 or > 200) throw new DocumentValidationException("Invalid paragraph properties.");
        return s;
    }
    public static RichDocument Validate(RichDocument document, DocumentLimits? limits = null)
    {
        limits ??= DocumentLimits.Default;
        if (document is null || document.SchemaVersion != 1) throw new DocumentValidationException("Unsupported document schema version.");
        if (document.Title is null || document.Title.Length > 512) throw new DocumentValidationException("Invalid document title.");
        if (document.Blocks.IsDefaultOrEmpty || document.Blocks.Length > limits.MaxBlocks) throw new DocumentValidationException("Block count exceeds the configured limit.");
        var ids = new HashSet<string>(StringComparer.Ordinal); var characters = 0; var runs = 0; var editable = 0; long imageBytes = 0;
        foreach (var block in document.Blocks)
        {
            if (block is null) throw new DocumentValidationException("Null document block.");
            Id(block.Id);
            switch (block)
            {
                case ParagraphBlock p: Paragraph(p, true); break;
                case TableBlock t:
                    if (t.Rows.IsDefaultOrEmpty || t.Rows.Length > limits.MaxTableRows || t.ColumnCount < 1 || t.ColumnCount > limits.MaxTableColumns) throw new DocumentValidationException("Invalid table dimensions.");
                    if (t.ColumnWidths.IsDefault || t.ColumnWidths.Length != t.ColumnCount || t.ColumnWidths.Any(w => !double.IsFinite(w) || w is <= 0 or > 10000)) throw new DocumentValidationException("Invalid table column widths.");
                    foreach (var row in t.Rows)
                    {
                        if (row is null || row.Cells.IsDefault || row.Cells.Length != t.ColumnCount) throw new DocumentValidationException("Tables must be rectangular.");
                        foreach (var cell in row.Cells)
                        {
                            if (cell is null) throw new DocumentValidationException("Null table cell.");
                            Id(cell.Id); if (!IsColor(cell.Background)) throw new DocumentValidationException("Invalid cell color."); Paragraph(cell.Content, false);
                        }
                    }
                    break;
                case ImageBlock image:
                    if (!double.IsFinite(image.Width) || !double.IsFinite(image.Height) || image.Width is < 1 or > 4096 || image.Height is < 1 or > 4096 || !Enum.IsDefined(image.Alignment) || image.AltText is null || image.AltText.Length > 2048) throw new DocumentValidationException("Invalid image properties.");
                    imageBytes += EmbeddedImage.Validate(image.DataUri, limits.MaxImageBytes).Length;
                    if (imageBytes > limits.MaxTotalImageBytes) throw new DocumentValidationException("Total image size exceeds the configured limit.");
                    break;
                case RuleBlock: break;
                default: throw new DocumentValidationException("Unknown block type.");
            }
        }
        if (editable == 0) throw new DocumentValidationException("At least one editable paragraph is required.");
        if (document.Comments.IsDefault || document.Comments.Length > limits.MaxComments) throw new DocumentValidationException("Invalid comment count.");
        var length = Math.Max(0, characters + editable - 1);
        foreach (var c in document.Comments)
        {
            if (c is null) throw new DocumentValidationException("Null comment.");
            Id(c.Id);
            if (string.IsNullOrWhiteSpace(c.Author) || c.Author.Length > 128 || string.IsNullOrWhiteSpace(c.Text) || c.Text.Length > 8000 || c.Range.Start < 0 || c.Range.Length < 0 || (long)c.Range.Start + c.Range.Length > length) throw new DocumentValidationException("Invalid annotation range or content.");
        }
        return document;
        void Id(string id) { if (string.IsNullOrEmpty(id) || id.Length > 128 || !ids.Add(id)) throw new DocumentValidationException("Document IDs must be present and unique."); }
        void Paragraph(ParagraphBlock p, bool idAdded)
        {
            if (p is null) throw new DocumentValidationException("Null paragraph.");
            if (!idAdded) Id(p.Id); ValidateParagraphStyle(p.Style);
            if (p.Runs.IsDefaultOrEmpty) throw new DocumentValidationException("A paragraph needs a run, even when empty.");
            var n = 0;
            foreach (var run in p.Runs)
            {
                if (run is null || run.Text is null || run.Text.Contains('\n') || run.Text.Contains('\r') || run.Text.Contains('\0')) throw new DocumentValidationException("Runs cannot contain LF, CR or NUL. Use paragraph breaks or U+2028.");
                for (var i = 0; i < run.Text.Length; i++) if (char.IsSurrogate(run.Text[i]))
                    if (!char.IsHighSurrogate(run.Text[i]) || i + 1 >= run.Text.Length || !char.IsLowSurrogate(run.Text[++i])) throw new DocumentValidationException("Invalid Unicode surrogate sequence.");
                ValidateStyle(run.Style); n = checked(n + run.Text.Length);
                if (++runs > limits.MaxRuns) throw new DocumentValidationException("Run count exceeds the configured limit.");
            }
            if (n > limits.MaxParagraphCharacters) throw new DocumentValidationException("Paragraph length exceeds the configured limit.");
            characters = checked(characters + n); if (characters > limits.MaxCharacters) throw new DocumentValidationException("Document length exceeds the configured limit."); editable++;
        }
    }
}
public static class EmbeddedImage
{
    public static byte[] Validate(string uri, int maxBytes = 8 * 1024 * 1024)
    {
        if (string.IsNullOrEmpty(uri) || uri.Length > (long)maxBytes * 4 / 3 + 100) throw new DocumentValidationException("Image size exceeds the configured limit.");
        var comma = uri.IndexOf(','); if (comma < 0) throw new DocumentValidationException("Embedded raster data URI required.");
        var media = uri[..comma].ToLowerInvariant();
        if (media is not ("data:image/png;base64" or "data:image/jpeg;base64" or "data:image/gif;base64" or "data:image/webp;base64")) throw new DocumentValidationException("Only embedded PNG, JPEG, GIF and WebP are supported. SVG and remote URLs are not loaded.");
        byte[] bytes; try { bytes = Convert.FromBase64String(uri[(comma + 1)..]); } catch (FormatException) { throw new DocumentValidationException("Invalid image base64."); }
        if (bytes.Length > maxBytes || bytes.Length < 12) throw new DocumentValidationException("Invalid image size.");
        var valid = media switch
        {
            "data:image/png;base64" => bytes.AsSpan(0, 8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10}),
            "data:image/jpeg;base64" => bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255,
            "data:image/gif;base64" => bytes.AsSpan(0, 6).SequenceEqual("GIF87a"u8) || bytes.AsSpan(0, 6).SequenceEqual("GIF89a"u8),
            "data:image/webp;base64" => bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8), _ => false
        };
        if (!valid) throw new DocumentValidationException("Image signature does not match its MIME type."); return bytes;
    }
}
