using Avalonia;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Media.TextFormatting;
using Avalonia.Utilities;
using Wysiwyg.Core;
namespace Wysiwyg.Controls;

internal sealed class DocumentLayout : IDisposable
{
    internal sealed record ParagraphVisual(DocumentIndex.Leaf Leaf,TextLayout Layout,Rect Bounds,Rect? CellBounds,string? CellColor,bool Header,string? Marker);
    internal sealed record ObjectVisual(Block Block,Rect Bounds);
    private sealed record CacheEntry(ParagraphBlock Paragraph,double Width,bool Header,string Font,IBrush Foreground,TextLayout Layout);
    private readonly Dictionary<string,CacheEntry> _cache=new(StringComparer.Ordinal);
    private readonly Dictionary<string,(string Uri,Bitmap? Bitmap)> _images=new(StringComparer.Ordinal);
    public List<ParagraphVisual> Paragraphs {get;}=[];
    public List<ObjectVisual> Objects {get;}=[];
    public double Height {get;private set;}
    public int FormatCount {get;private set;}
    public int CachedParagraphs=>_cache.Count;
    public void Build(WysiwygEditor owner)
    {
        Paragraphs.Clear();Objects.Clear();var live=new HashSet<string>(StringComparer.Ordinal);var imageIds=new HashSet<string>(StringComparer.Ordinal);
        var width=owner.PageWidth;var padding=owner.PagePadding;var left=20+padding;var contentWidth=Math.Max(40,width-2*padding);var y=20+padding;var number=0;
        foreach(var block in owner.Session.Document.Blocks)
        {
            switch(block)
            {
                case ParagraphBlock paragraph:
                {
                    var ps=paragraph.Style;var indent=ps.Indent*24+(ps.List!=ListKind.None?24:0)+(ps.Quote?18:0);
                    if(ps.PageBreakBefore&&y>20+padding)y+=48;
                    y+=ps.SpaceBefore;var layout=Get(paragraph,Math.Max(20,contentWidth-indent),false);var height=Math.Max(20,layout.Height);
                    string? marker=null;if(ps.List==ListKind.Numbered)marker=$"{++number}.";else {number=0;marker=ps.List==ListKind.Bullet?"•":ps.List==ListKind.Check?(ps.Checked?"☑":"☐"):null;}
                    Paragraphs.Add(new(owner.Session.Index.ById(paragraph.Id)!,layout,new(left+indent,y,Math.Max(20,contentWidth-indent),height),null,null,false,marker));
                    y+=height+ps.SpaceAfter;break;
                }
                case TableBlock table:
                {
                    number=0;y+=8;var total=table.ColumnWidths.Sum();
                    for(var r=0;r<table.Rows.Length;r++)
                    {
                        var row=table.Rows[r];var layouts=new TextLayout[table.ColumnCount];var widths=new double[table.ColumnCount];var rowHeight=40d;
                        for(var c=0;c<table.ColumnCount;c++){widths[c]=contentWidth*table.ColumnWidths[c]/total;layouts[c]=Get(row.Cells[c].Content,Math.Max(12,widths[c]-20),table.HasHeader&&r==0);rowHeight=Math.Max(rowHeight,layouts[c].Height+20);}
                        var x=left;
                        for(var c=0;c<table.ColumnCount;c++)
                        {
                            var cell=row.Cells[c];var rect=new Rect(x,y,widths[c],rowHeight);
                            Paragraphs.Add(new(owner.Session.Index.ById(cell.Content.Id)!,layouts[c],new Rect(x+10,y+10,Math.Max(12,widths[c]-20),rowHeight-20),rect,cell.Background,table.HasHeader&&r==0,null));x+=widths[c];
                        }
                        y+=rowHeight;
                    }
                    y+=18;break;
                }
                case ImageBlock image:
                {
                    number=0;imageIds.Add(image.Id);var w=Math.Min(contentWidth,image.Width);var h=image.Height*w/image.Width;
                    var x=left+(image.Alignment==ParagraphAlignment.Center?(contentWidth-w)/2:image.Alignment==ParagraphAlignment.End?contentWidth-w:0);
                    Objects.Add(new(image,new(x,y+10,w,h)));y+=h+30;break;
                }
                case RuleBlock rule:Objects.Add(new(rule,new(left,y+12,contentWidth,1)));y+=30;break;
            }
        }
        Height=Math.Max(1123,y+padding+20);
        foreach(var id in _cache.Keys.Where(k=>!live.Contains(k)).ToArray()){_cache[id].Layout.Dispose();_cache.Remove(id);}
        foreach(var id in _images.Keys.Where(k=>!imageIds.Contains(k)).ToArray()){_images[id].Bitmap?.Dispose();_images.Remove(id);}
        TextLayout Get(ParagraphBlock p,double w,bool header)
        {
            live.Add(p.Id);var font=owner.FontFamily?.Name??"Inter";
            if(_cache.TryGetValue(p.Id,out var cached)&&ReferenceEquals(cached.Paragraph,p)&&cached.Width==w&&cached.Header==header&&cached.Font==font&&ReferenceEquals(cached.Foreground,owner.PaperForeground))return cached.Layout;
            cached?.Layout.Dispose();var layout=CreateText(p,w,font,owner.PaperForeground,header);_cache[p.Id]=new(p,w,header,font,owner.PaperForeground,layout);FormatCount++;return layout;
        }
    }
    private static TextLayout CreateText(ParagraphBlock p,double width,string font,IBrush foreground,bool header)
    {
        var size=p.Style.HeadingLevel switch {1=>34,2=>25,3=>21,4=>19,5=>17,6=>16,_=>p.Style.CodeBlock?14:16};
        var baseFace=new Typeface(new FontFamily(p.Style.CodeBlock?"monospace":font),FontStyle.Normal,p.Style.HeadingLevel>0||header?FontWeight.SemiBold:FontWeight.Normal);
        var overrides=new List<ValueSpan<TextRunProperties>>();var offset=0;
        foreach(var run in p.Runs)
        {
            var s=run.Style;var face=new Typeface(new FontFamily(s.Code||p.Style.CodeBlock?"monospace":s.FontFamily??font),s.Italic?FontStyle.Italic:FontStyle.Normal,s.Bold||p.Style.HeadingLevel>0||header?FontWeight.SemiBold:FontWeight.Normal);
            var decorations=new TextDecorationCollection();if(s.Underline||s.Link is not null)foreach(var d in TextDecorations.Underline)decorations.Add(d);if(s.Strike)foreach(var d in TextDecorations.Strikethrough)decorations.Add(d);
            var fg=s.Foreground is not null?Brush.Parse(s.Foreground):s.Link is not null?Brush.Parse("#4F46E5"):foreground;
            var bg=s.Background is not null?Brush.Parse(s.Background):null;
            var script=s.Script==ScriptKind.Subscript?BaselineAlignment.Subscript:s.Script==ScriptKind.Superscript?BaselineAlignment.Superscript:BaselineAlignment.Baseline;
            if(run.Text.Length>0)overrides.Add(new(offset,run.Text.Length,new GenericTextRunProperties(face,s.FontSize??size,decorations,fg,bg,script)));offset+=run.Text.Length;
        }
        var alignment=p.Style.Alignment switch{ParagraphAlignment.Center=>TextAlignment.Center,ParagraphAlignment.End=>TextAlignment.Right,ParagraphAlignment.Justify=>TextAlignment.Justify,_=>p.Style.RightToLeft?TextAlignment.Right:TextAlignment.Left};
        return new TextLayout(p.Text,baseFace,size,foreground,textAlignment:alignment,textWrapping:TextWrapping.Wrap,flowDirection:p.Style.RightToLeft?FlowDirection.RightToLeft:FlowDirection.LeftToRight,maxWidth:width,lineHeight:Math.Max(size,p.Runs.Max(r=>r.Style.FontSize??size))*p.Style.LineSpacing,textStyleOverrides:overrides);
    }
    public Bitmap? GetImage(ImageBlock image)
    {
        if(_images.TryGetValue(image.Id,out var entry)&&entry.Uri==image.DataUri)return entry.Bitmap;
        entry.Bitmap?.Dispose();Bitmap? bitmap=null;
        try {var bytes=EmbeddedImage.Validate(image.DataUri);RasterImageInfo.Read(bytes);using var stream=new MemoryStream(bytes,false);bitmap=new Bitmap(stream);}catch(Exception ex) when(ex is ArgumentException or InvalidOperationException or OverflowException){ }
        _images[image.Id]=(image.DataUri,bitmap);return bitmap;
    }
    public int FirstVisible(double top)
    {
        var lo=0;var hi=Paragraphs.Count;while(lo<hi){var mid=(lo+hi)/2;if(Paragraphs[mid].Bounds.Bottom<top)lo=mid+1;else hi=mid;}return lo;
    }
    public void ClearCache(){foreach(var e in _cache.Values)e.Layout.Dispose();_cache.Clear();}
    public void Dispose(){ClearCache();foreach(var image in _images.Values)image.Bitmap?.Dispose();_images.Clear();Paragraphs.Clear();Objects.Clear();}
}
