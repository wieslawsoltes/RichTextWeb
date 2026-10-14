using System.Collections.Immutable;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Wysiwyg.Core;
namespace Wysiwyg.Formats;

public sealed record ImportResult(RichDocument Document, ImmutableArray<string> Warnings);
/// <summary>JSON is the lossless native format. HTML and Markdown are portable, deliberately constrained interchange formats.</summary>
public static class DocumentFormats
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, MaxDepth = 48,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter() }
    };
    public static string ToJson(RichDocument document) => JsonSerializer.Serialize(DocumentValidation.Validate(document), JsonOptions);
    public static RichDocument FromJson(string json, DocumentLimits? limits = null)
    {
        limits ??= DocumentLimits.Default; CheckInput(json, limits);
        try { return DocumentValidation.Validate(JsonSerializer.Deserialize<RichDocument>(json, JsonOptions) ?? throw new DocumentValidationException("The document is empty."), limits); }
        catch (JsonException ex) { throw new DocumentValidationException("Invalid native document: " + ex.Message); }
    }
    public static string ToText(RichDocument document) => new DocumentIndex(document).Text;
    public static RichDocument FromText(string text, DocumentLimits? limits = null)
    { limits ??= DocumentLimits.Default; CheckInput(text, limits); return DocumentValidation.Validate(RichDocument.FromText(text), limits); }
    public static ImportResult FromHtml(string html, DocumentLimits? limits = null) => new HtmlDocumentReader(limits ?? DocumentLimits.Default).Read(html);
    public static ImportResult FromMarkdown(string markdown, DocumentLimits? limits = null)
    {
        limits ??= DocumentLimits.Default; CheckInput(markdown, limits);
        var pipeline = new Markdig.MarkdownPipelineBuilder().UseAdvancedExtensions().DisableHtml().Build();
        return FromHtml(Markdig.Markdown.ToHtml(markdown, pipeline), limits);
    }
    internal static void CheckInput(string input, DocumentLimits limits)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.Length > limits.MaxSerializedBytes || Encoding.UTF8.GetByteCount(input) > limits.MaxSerializedBytes) throw new DocumentValidationException("The serialized document exceeds the configured size limit.");
    }
    internal static string E(string text) => WebUtility.HtmlEncode(text);
    internal static string N(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);
    public static string ToHtml(RichDocument document, bool standalone = true)
    {
        DocumentValidation.Validate(document); var b = new StringBuilder();
        if (standalone) b.Append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>").Append(E(document.Title)).Append("</title><style>body{font:16px/1.4 system-ui,sans-serif;color:#243047;background:#fff;max-width:794px;margin:40px auto;padding:0 48px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #cbd5e1;padding:10px;vertical-align:top}th{background:#f1f5f9}p{margin:0 0 10px}blockquote{margin:16px 0;padding:12px 20px;border-left:3px solid #6366f1;background:#f8fafc}img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:#f1f5f9;padding:16px}a{color:#4f46e5}@media print{body{max-width:none;margin:0;padding:0}table,figure{break-inside:avoid}}</style></head><body>");
        foreach (var block in document.Blocks)
        {
            switch (block)
            {
                case ParagraphBlock p: Paragraph(b, p); break;
                case TableBlock t:
                    b.Append("<table><colgroup>"); var total = t.ColumnWidths.Sum();
                    foreach (var width in t.ColumnWidths) b.Append("<col style=\"width:").Append(N(width / total * 100)).Append("%\">");
                    b.Append("</colgroup><tbody>");
                    for (var r = 0; r < t.Rows.Length; r++)
                    {
                        b.Append("<tr>"); var tag = t.HasHeader && r == 0 ? "th" : "td";
                        foreach (var cell in t.Rows[r].Cells)
                        {
                            b.Append('<').Append(tag); if (cell.Background is not null) b.Append(" style=\"background-color:").Append(cell.Background).Append("\"");
                            b.Append('>'); Paragraph(b, cell.Content); b.Append("</").Append(tag).Append('>');
                        }
                        b.Append("</tr>");
                    }
                    b.Append("</tbody></table>\n"); break;
                case ImageBlock image:
                    b.Append("<figure style=\"text-align:").Append(Alignment(image.Alignment)).Append("\"><img src=\"").Append(E(image.DataUri)).Append("\" alt=\"").Append(E(image.AltText)).Append("\" width=\"").Append(N(image.Width)).Append("\" height=\"").Append(N(image.Height)).Append("\"></figure>\n"); break;
                case RuleBlock: b.Append("<hr>\n"); break;
            }
        }
        if (standalone) b.Append("</body></html>"); return b.ToString();
    }
    private static string Alignment(ParagraphAlignment alignment) => alignment switch { ParagraphAlignment.Center => "center", ParagraphAlignment.End => "right", ParagraphAlignment.Justify => "justify", _ => "left" };
    private static void Paragraph(StringBuilder b, ParagraphBlock p)
    {
        var s = p.Style; var tag = s.CodeBlock ? "pre" : s.HeadingLevel > 0 ? "h" + s.HeadingLevel : s.Quote ? "blockquote" : "p";
        if (s.List != ListKind.None) { b.Append(s.List == ListKind.Numbered ? "<ol>" : "<ul>"); tag = "li"; }
        b.Append('<').Append(tag).Append(" style=\"text-align:").Append(Alignment(s.Alignment)).Append(";margin-top:").Append(N(s.SpaceBefore)).Append("px;margin-bottom:").Append(N(s.SpaceAfter)).Append("px;margin-left:").Append(s.Indent * 24).Append("px;line-height:").Append(N(s.LineSpacing));
        if (s.PageBreakBefore) b.Append(";break-before:page"); b.Append('"');
        if (s.RightToLeft) b.Append(" dir=\"rtl\"");
        if (s.List == ListKind.Check) b.Append(" data-check=\"").Append(s.Checked ? "true" : "false").Append('"');
        b.Append('>'); if (s.List == ListKind.Check) b.Append(s.Checked ? "☑ " : "☐ ");
        foreach (var run in p.Runs) Run(b, run);
        if (p.Length == 0) b.Append("<br>"); b.Append("</").Append(tag).Append('>');
        if (s.List != ListKind.None) b.Append(s.List == ListKind.Numbered ? "</ol>" : "</ul>"); b.Append('\n');
    }
    private static void Run(StringBuilder b, TextRun run)
    {
        var s = run.Style; if (s.Link is not null) b.Append("<a href=\"").Append(E(s.Link)).Append("\" rel=\"noopener noreferrer\">");
        b.Append("<span style=\"");
        if (s.Bold) b.Append("font-weight:700;"); if (s.Italic) b.Append("font-style:italic;");
        if (s.Underline || s.Strike) b.Append("text-decoration:").Append(s.Underline ? "underline " : "").Append(s.Strike ? "line-through" : "").Append(';');
        if (s.Foreground is not null) b.Append("color:").Append(s.Foreground).Append(';');
        if (s.Background is not null) b.Append("background-color:").Append(s.Background).Append(';');
        if (s.FontSize is { } size) b.Append("font-size:").Append(N(size)).Append("px;");
        if (s.FontFamily is not null || s.Code) b.Append("font-family:").Append(E(s.Code ? "monospace" : s.FontFamily!)).Append(';');
        if (s.Script != ScriptKind.Normal) b.Append("vertical-align:").Append(s.Script == ScriptKind.Subscript ? "sub" : "super").Append(';');
        b.Append("\">").Append(E(run.Text).Replace("\u2028", "<br>")).Append("</span>"); if (s.Link is not null) b.Append("</a>");
    }
    public static string ToMarkdown(RichDocument document)
    {
        DocumentValidation.Validate(document); var b = new StringBuilder();
        foreach (var block in document.Blocks)
        {
            switch (block)
            {
                case ParagraphBlock p:
                    if (p.Style.CodeBlock) { b.Append("````\n").Append(p.Text.Replace('\u2028','\n')).Append("\n````\n\n"); break; }
                    b.Append(new string(' ', p.Style.Indent * 2));
                    if (p.Style.Quote) b.Append("> "); if (p.Style.HeadingLevel > 0) b.Append(new string('#', p.Style.HeadingLevel)).Append(' ');
                    b.Append(p.Style.List switch { ListKind.Bullet => "- ", ListKind.Numbered => "1. ", ListKind.Check => p.Style.Checked ? "- [x] " : "- [ ] ", _ => "" });
                    b.Append(MarkdownRuns(p.Runs)).Append("\n\n"); break;
                case TableBlock table:
                    for (var r = 0; r < table.Rows.Length; r++)
                    {
                        b.Append("| ").Append(string.Join(" | ", table.Rows[r].Cells.Select(c => MarkdownRuns(c.Content.Runs).Replace("\n", "<br>")))).Append(" |\n");
                        if (r == 0) b.Append('|').Append(string.Concat(Enumerable.Repeat(" --- |", table.ColumnCount))).Append('\n');
                    }
                    b.Append('\n'); break;
                case RuleBlock: b.Append("---\n\n"); break;
                case ImageBlock image: b.Append("![").Append(MdEscape(image.AltText)).Append("](<").Append(image.DataUri).Append(">)\n\n"); break;
            }
        }
        return b.ToString();
    }
    private static string MdEscape(string s) => Regex.Replace(s, @"([\\`*_{}\[\]()#+.!|>~-])", @"\$1");
    private static string MarkdownRuns(IEnumerable<TextRun> runs) => string.Concat(runs.Select(r =>
    {
        var value = MdEscape(r.Text).Replace("\u2028", "  \n"); if (r.Style.Code) value = "`" + r.Text.Replace("`", "\\`") + "`";
        if (r.Style.Bold) value = "**" + value + "**"; if (r.Style.Italic) value = "*" + value + "*"; if (r.Style.Strike) value = "~~" + value + "~~";
        if (r.Style.Link is not null) value = "[" + value + "](<" + r.Style.Link.Replace(">", "%3E").Replace("<", "%3C") + ">)";
        return value;
    }));
}
