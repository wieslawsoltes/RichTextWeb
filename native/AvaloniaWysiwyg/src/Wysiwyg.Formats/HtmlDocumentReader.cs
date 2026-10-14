using System.Collections.Immutable;
using System.Globalization;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using Wysiwyg.Core;
namespace Wysiwyg.Formats;

internal sealed class HtmlDocumentReader(DocumentLimits limits)
{
    private readonly List<Block> _blocks = [];
    private readonly HashSet<string> _warnings = new(StringComparer.Ordinal);
    private int _characters;
    private static readonly HashSet<string> Skip = new(StringComparer.OrdinalIgnoreCase) { "script", "style", "iframe", "object", "embed", "form", "input", "button", "video", "audio", "canvas", "svg", "math", "template", "noscript", "head" };
    private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase) { "p", "div", "section", "article", "header", "footer", "main", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "li", "table", "figure", "hr" };
    public ImportResult Read(string html)
    {
        DocumentFormats.CheckInput(html, limits);
        var dom = new HtmlParser(new HtmlParserOptions { IsScripting = false }).ParseDocument(html);
        var root = dom.Body; if (root is not null) ReadContainer(root, ParagraphStyle.Default, 0);
        if (!_blocks.OfType<ParagraphBlock>().Any()) _blocks.Add(ParagraphBlock.Create());
        var doc = new RichDocument { Title = string.IsNullOrWhiteSpace(dom.Title) ? "Imported document" : dom.Title[..Math.Min(512,dom.Title.Length)], Blocks = _blocks.ToImmutableArray() };
        return new(DocumentValidation.Validate(doc, limits), _warnings.ToImmutableArray());
    }
    private void ReadContainer(INode node, ParagraphStyle inherited, int depth)
    {
        if (depth > 40) throw new DocumentValidationException("HTML nesting is too deep.");
        var pending = new List<INode>();
        foreach (var child in node.ChildNodes)
        {
            if (child is IElement e && Skip.Contains(e.LocalName)) { _warnings.Add("Active or unsupported HTML elements were removed."); continue; }
            if (child is IElement element && BlockTags.Contains(element.LocalName)) { Flush(); ReadBlock(element, inherited, depth + 1); }
            else if (child is IElement image && image.LocalName == "img") { Flush(); Image(image); }
            else pending.Add(child);
        }
        Flush();
        void Flush()
        {
            if (pending.Count == 0) return;
            var p = MakeParagraph(pending, inherited); pending.Clear(); if (p.Text.Trim().Length > 0) Add(p);
        }
    }
    private void ReadBlock(IElement e, ParagraphStyle inherited, int depth)
    {
        var tag = e.LocalName; var ps = ParagraphProperties(e, inherited);
        if (tag is "ul" or "ol")
        {
            var list = tag == "ol" ? ListKind.Numbered : ListKind.Bullet;
            foreach (var li in e.Children.Where(c => c.LocalName == "li"))
            {
                var style = ParagraphProperties(li, ps with { List = list, HeadingLevel = 0 });
                if (li.HasAttribute("data-check")) style = style with { List = ListKind.Check, Checked = li.GetAttribute("data-check") == "true" };
                var nodes = li.ChildNodes.Where(n => n is not IElement x || x.LocalName is not ("ul" or "ol")).ToArray();
                Add(MakeParagraph(nodes, style));
                foreach (var nested in li.Children.Where(c => c.LocalName is "ul" or "ol")) ReadBlock(nested, style with { Indent = Math.Min(8, style.Indent + 1) }, depth + 1);
            }
            return;
        }
        if (tag == "table") { Table(e); return; }
        if (tag == "hr") { Add(new RuleBlock(Guid.NewGuid().ToString("N"))); return; }
        if (tag == "figure") { foreach (var image in e.QuerySelectorAll("img")) Image(image); return; }
        if (tag is "div" or "section" or "article" or "header" or "footer" or "main") { ReadContainer(e, ps, depth + 1); return; }
        if (tag.Length == 2 && tag[0] == 'h' && tag[1] is >= '1' and <= '6') ps = ps with { HeadingLevel = tag[1] - '0' };
        if (tag == "blockquote") ps = ps with { Quote = true };
        if (tag == "pre") ps = ps with { CodeBlock = true };
        Add(MakeParagraph(e.ChildNodes, ps));
    }
    private ParagraphBlock MakeParagraph(IEnumerable<INode> nodes, ParagraphStyle style)
    {
        var runs = new List<TextRun>(); foreach (var node in nodes) Inline(node, TextStyle.Default, runs, style.CodeBlock, 0);
        var normalized = TextUtilities.NormalizeRuns(runs);
        if (!style.CodeBlock && normalized.Length > 0)
        {
            var list = normalized.ToList(); list[0] = list[0] with { Text = list[0].Text.TrimStart(' ') }; list[^1] = list[^1] with { Text = list[^1].Text.TrimEnd(' ') }; normalized = TextUtilities.NormalizeRuns(list);
        }
        var paragraph = new ParagraphBlock(Guid.NewGuid().ToString("N"), normalized, style);
        _characters += paragraph.Length; if (_characters > limits.MaxCharacters || paragraph.Length > limits.MaxParagraphCharacters) throw new DocumentValidationException("Imported text exceeds the configured limits.");
        return paragraph;
    }
    private void Inline(INode node, TextStyle style, List<TextRun> runs, bool preserve, int depth)
    {
        if (depth > 40) throw new DocumentValidationException("HTML nesting is too deep.");
        if (node is IText text)
        {
            var value = preserve ? TextUtilities.NormalizeNewlines(text.Data).Replace('\n','\u2028') : Regex.Replace(text.Data, @"[\t\r\n ]+", " ");
            if (value.Length > 0) runs.Add(new(value.Replace('\0','\uFFFD'), style)); return;
        }
        if (node is not IElement e) return;
        if (Skip.Contains(e.LocalName)) { _warnings.Add("Active or unsupported HTML elements were removed."); return; }
        if (e.LocalName == "br") { runs.Add(new("\u2028",style)); return; }
        if (e.LocalName == "img") { _warnings.Add("Inline images are not supported; insert an image block instead."); return; }
        if (e.LocalName == "table") { _warnings.Add("Nested tables were flattened to text."); runs.Add(new(e.TextContent,style)); return; }
        style = TextProperties(e, style);
        if (e.LocalName is "p" or "div" && runs.Count > 0) runs.Add(new("\u2028",style));
        foreach (var child in e.ChildNodes) Inline(child,style,runs,preserve,depth+1);
    }
    private TextStyle TextProperties(IElement e, TextStyle s)
    {
        s = e.LocalName switch
        {
            "b" or "strong" => s with { Bold = true }, "i" or "em" => s with { Italic = true }, "u" => s with { Underline = true },
            "s" or "strike" or "del" => s with { Strike = true }, "code" => s with { Code = true },
            "sub" => s with { Script = ScriptKind.Subscript }, "sup" => s with { Script = ScriptKind.Superscript }, _ => s
        };
        if (e.LocalName == "a" && e.GetAttribute("href") is { } href)
        {
            if (DocumentValidation.IsSafeLink(href)) s = s with { Link = href, Underline = true }; else _warnings.Add("Unsafe or relative links were removed.");
        }
        foreach (var (key,value) in Css(e))
        {
            switch(key)
            {
                case "font-weight": s = s with { Bold = value is "bold" or "bolder" || int.TryParse(value,out var weight) && weight >= 600 }; break;
                case "font-style": s = s with { Italic = value is "italic" or "oblique" }; break;
                case "text-decoration": case "text-decoration-line": s = s with { Underline = value.Contains("underline"), Strike = value.Contains("line-through") }; break;
                case "color": if (Color(value) is { } color) s = s with { Foreground = color }; break;
                case "background": case "background-color": if (Color(value) is { } background) s = s with { Background = background }; break;
                case "font-size": if (Number(value) is { } size && size is >= 6 and <= 144) s = s with { FontSize = size }; break;
                case "font-family":
                    var family = value.Trim('\'', '"'); try { s = DocumentValidation.ValidateStyle(s with { FontFamily = family }); } catch (DocumentValidationException) { _warnings.Add("An unsupported font family was removed."); } break;
                case "vertical-align": s = s with { Script = value == "sub" ? ScriptKind.Subscript : value == "super" ? ScriptKind.Superscript : ScriptKind.Normal }; break;
            }
        }
        return s;
    }
    private static ParagraphStyle ParagraphProperties(IElement e, ParagraphStyle s)
    {
        s = s with { RightToLeft = e.GetAttribute("dir") == "rtl" || s.RightToLeft };
        foreach (var (key,value) in Css(e)) switch(key)
        {
            case "text-align": s = s with { Alignment = value switch { "center" => ParagraphAlignment.Center, "right" or "end" => ParagraphAlignment.End, "justify" => ParagraphAlignment.Justify, _ => ParagraphAlignment.Start } }; break;
            case "margin-left": if (Number(value) is { } indent) s = s with { Indent = Math.Clamp((int)(indent / 24),0,8) }; break;
            case "margin-top": if (Number(value) is { } top) s = s with { SpaceBefore = Math.Clamp(top,0,200) }; break;
            case "margin-bottom": if (Number(value) is { } bottom) s = s with { SpaceAfter = Math.Clamp(bottom,0,200) }; break;
            case "line-height": if (double.TryParse(value,NumberStyles.Float,CultureInfo.InvariantCulture,out var spacing) && double.IsFinite(spacing)) s = s with { LineSpacing = Math.Clamp(spacing,1,3) }; break;
            case "break-before": case "page-break-before": if (value is "page" or "always") s = s with { PageBreakBefore = true }; break;
        }
        return s;
    }
    private void Table(IElement element)
    {
        var rows = element.QuerySelectorAll("tr").Where(r => r.ParentElement == element || r.ParentElement?.ParentElement == element).ToArray();
        if (rows.Length == 0) return;
        if (rows.Length > limits.MaxTableRows) throw new DocumentValidationException("Imported table has too many rows.");
        var cells = rows.Select(r => r.Children.Where(c => c.LocalName is "td" or "th").ToArray()).ToArray(); var count = cells.Max(r => r.Length);
        if (count == 0) return; if (count > limits.MaxTableColumns) throw new DocumentValidationException("Imported table has too many columns.");
        if (cells.SelectMany(c => c).Any(c => c.HasAttribute("colspan") || c.HasAttribute("rowspan"))) _warnings.Add("Merged table cells were flattened; the native model uses a rectangular grid.");
        var result = cells.Select(row => new TableRow(Enumerable.Range(0,count).Select(c =>
        {
            var cell = c < row.Length ? row[c] : null; string? background = null;
            if (cell is not null) foreach (var (key,value) in Css(cell)) if (key is "background" or "background-color") background = Color(value);
            return new TableCell(Guid.NewGuid().ToString("N"),cell is null ? ParagraphBlock.Create() : MakeParagraph(cell.ChildNodes, ParagraphStyle.Default),background);
        }).ToImmutableArray())).ToImmutableArray();
        Add(new TableBlock(Guid.NewGuid().ToString("N"),result,Enumerable.Repeat(1d,count).ToImmutableArray(),cells[0].Any(c => c.LocalName == "th")));
    }
    private void Image(IElement e)
    {
        var src = e.GetAttribute("src"); if (src is null) return;
        try
        {
            EmbeddedImage.Validate(src,limits.MaxImageBytes);
            var width = Math.Clamp(Number(e.GetAttribute("width") ?? "480") ?? 480,1,4096);
            var height = Math.Clamp(Number(e.GetAttribute("height") ?? "240") ?? 240,1,4096);
            Add(new ImageBlock(Guid.NewGuid().ToString("N"),src,(e.GetAttribute("alt") ?? "")[..Math.Min(2048,(e.GetAttribute("alt") ?? "").Length)],width,height));
        }
        catch(DocumentValidationException) { _warnings.Add("A remote, unsafe or invalid image was removed. Only embedded raster images are accepted."); }
    }
    private void Add(Block block) { if (_blocks.Count >= limits.MaxBlocks) throw new DocumentValidationException("Imported block count exceeds the configured limit."); _blocks.Add(block); }
    private static IEnumerable<(string Key,string Value)> Css(IElement e)
    {
        foreach (var part in (e.GetAttribute("style") ?? "").Split(';')) { var colon=part.IndexOf(':'); if(colon>0) yield return (part[..colon].Trim().ToLowerInvariant(),part[(colon+1)..].Trim()); }
    }
    private static double? Number(string value)
    {
        value=value.Trim(); if(value.EndsWith("px",StringComparison.OrdinalIgnoreCase))value=value[..^2];
        return double.TryParse(value,NumberStyles.Float,CultureInfo.InvariantCulture,out var n) && double.IsFinite(n) ? n : null;
    }
    private static string? Color(string value)
    {
        value=value.Trim().ToLowerInvariant();
        if(value.Length==4 && value[0]=='#' && value[1..].All(Uri.IsHexDigit)) value="#"+string.Concat(value[1..].Select(c=>new string(c,2)));
        value=value switch { "black"=>"#000000", "white"=>"#ffffff", "red"=>"#ff0000", "blue"=>"#0000ff", "green"=>"#008000", "yellow"=>"#ffff00", "gray" or "grey"=>"#808080", _=>value };
        return DocumentValidation.IsColor(value)?value:null;
    }
}
