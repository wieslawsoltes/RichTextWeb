using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.TextInput;
using Avalonia.Media;
using Avalonia.Media.TextFormatting;
using Avalonia.Threading;
using Wysiwyg.Core;
namespace Wysiwyg.Controls;

/// <summary>Native text-layout rendering and hit testing. Hosts may replace this template part with a derived surface.</summary>
public partial class DocumentSurface : Control
{
    private readonly DocumentLayout _layout=new();
    private readonly DispatcherTimer _blink=new(){Interval=TimeSpan.FromMilliseconds(530)};
    private readonly SurfaceInputMethod _ime;
    private WysiwygEditor? _owner;
    private bool _dirty=true,_caretOn=true;
    private Rect _viewport;
    private string _preedit="";
    public int FormattedParagraphCount=>_layout.FormatCount;
    public int CachedParagraphCount=>_layout.CachedParagraphs;
    internal WysiwygEditor? Editor=>_owner;
    public DocumentSurface()
    {
        Focusable=true;Cursor=new Cursor(StandardCursorType.Ibeam);_ime=new(this);AutomationProperties.SetName(this,"Document editor");
        TextInputMethodClientRequested+=(_,e)=>{if(_owner is not null){e.Client=_ime;e.Handled=true;}};
        GotFocus+=(_,_)=>{_caretOn=true;_blink.Start();_ime.Notify();InvalidateVisual();};
        LostFocus+=(_,_)=>{_blink.Stop();_caretOn=false;_preedit="";InvalidateVisual();};
        _blink.Tick+=(_,_)=>{if(IsFocused){_caretOn=!_caretOn;InvalidateVisual();}};
        EffectiveViewportChanged+=(_,e)=>{_viewport=e.EffectiveViewport;InvalidateVisual();};
        AttachedToVisualTree+=(_,_)=>{_dirty=true;InvalidateMeasure();};
        DetachedFromVisualTree+=(_,_)=>{_blink.Stop();_dragging=false;_layout.Dispose();_dirty=true;};
    }
    internal void Connect(WysiwygEditor owner)
    {
        _owner=owner;_dirty=true;
        ContextMenu=new ContextMenu {ItemsSource=new object[]
        {
            Menu("Undo","Undo"),Menu("Redo","Redo"),new Separator(),Menu("Cut","Cut"),Menu("Copy","Copy"),Menu("Paste","Paste"),new Separator(),
            Menu("Select all","SelectAll"),Menu("Find and replace","Search"),new Separator(),Menu("Insert table","Table"),Menu("Insert row","AddRow"),Menu("Delete row","DeleteRow"),Menu("Delete selected object","DeleteBlock")
        }};
        InvalidateMeasure();InvalidateVisual();
        MenuItem Menu(string title,string command)=>new(){Header=title,Command=owner.Command,CommandParameter=command};
    }
    internal void Disconnect(){_blink.Stop();_owner=null;ContextMenu=null;_layout.Dispose();_dirty=true;}
    internal void DocumentInvalidated(bool clearCache=false){if(clearCache)_layout.ClearCache();_dirty=true;InvalidateMeasure();InvalidateVisual();}
    internal void SelectionInvalidated(){_caretOn=true;_ime.Notify();InvalidateVisual();if(IsFocused)Dispatcher.UIThread.Post(EnsureCaretVisible,DispatcherPriority.Background);}
    private void EnsureLayout(){if(_dirty&&_owner is not null){_layout.Build(_owner);_dirty=false;}}
    protected override Size MeasureOverride(Size availableSize)
    {EnsureLayout();return _owner is null?new(0,0):new((_owner.PageWidth+40)*_owner.Zoom,_layout.Height*_owner.Zoom);}
    public override void Render(DrawingContext context)
    {
        base.Render(context);if(_owner is not { } owner)return;EnsureLayout();context.DrawRectangle(Brushes.Transparent,null,new Rect(Bounds.Size));
        var zoom=owner.Zoom;using var transform=context.PushTransform(Matrix.CreateScale(zoom,zoom));
        var viewport=_viewport.Width>0&&_viewport.Height>0?new Rect(_viewport.X/zoom,_viewport.Y/zoom,_viewport.Width/zoom,_viewport.Height/zoom):new Rect(0,0,Bounds.Width/zoom,Bounds.Height/zoom);
        context.DrawRectangle(Brush.Parse("#100F172A"),null,new Rect(23,24,owner.PageWidth,_layout.Height-40),3,3);
        context.DrawRectangle(owner.PaperBrush,new Pen(Brush.Parse("#DDE3ED"),1),new Rect(20,20,owner.PageWidth,_layout.Height-40),2,2);
        for(var i=_layout.FirstVisible(viewport.Top-80);i<_layout.Paragraphs.Count;i++)
        {
            var p=_layout.Paragraphs[i];if(p.Bounds.Top>viewport.Bottom+80)break;
            if(p.CellBounds is { } cell)context.DrawRectangle(p.CellColor is not null?Brush.Parse(p.CellColor):p.Header?Brush.Parse("#F1F4F9"):owner.PaperBrush,new Pen(Brush.Parse("#D4DCE8"),1),cell);
            else if(p.Leaf.Paragraph.Style.Quote){context.DrawRectangle(Brush.Parse("#F6F6FD"),null,p.Bounds.Inflate(10));context.DrawLine(new Pen(Brush.Parse("#818CF8"),3),new(p.Bounds.Left-12,p.Bounds.Top-6),new(p.Bounds.Left-12,p.Bounds.Bottom+6));}
            else if(p.Leaf.Paragraph.Style.CodeBlock)context.DrawRectangle(Brush.Parse("#F1F4F9"),null,p.Bounds.Inflate(9),4,4);
            foreach(var match in owner.SearchMatches)DrawRange(context,p,match.Range,Brush.Parse("#80FCD34D"));
            foreach(var comment in owner.Session.Document.Comments.Where(c=>!c.Resolved&&!c.Orphaned))DrawRange(context,p,comment.Range,Brush.Parse("#28F59E0B"));
            DrawRange(context,p,owner.Session.Selection.Range,owner.SelectionBrush);
            p.Layout.Draw(context,p.Bounds.Position);
            if(p.Marker is not null)
            {
                using var marker=new TextLayout(p.Marker,new Typeface(owner.FontFamily??FontFamily.Default),16,owner.PaperForeground,maxWidth:24);
                marker.Draw(context,new(p.Bounds.Left-24,p.Bounds.Top));
            }
        }
        foreach(var item in _layout.Objects)
        {
            if(!item.Bounds.Intersects(viewport))continue;
            if(item.Block is RuleBlock)context.DrawLine(new Pen(Brush.Parse("#CCD5E3"),1),item.Bounds.TopLeft,item.Bounds.TopRight);
            else if(item.Block is ImageBlock image)
            {
                if(_layout.GetImage(image) is { } bitmap)context.DrawImage(bitmap,new Rect(bitmap.Size),item.Bounds);
                else {context.DrawRectangle(Brush.Parse("#F1F4F9"),new Pen(Brush.Parse("#CBD5E1"),1),item.Bounds);using var alt=new TextLayout("Image unavailable: "+image.AltText,new Typeface(owner.FontFamily??FontFamily.Default),14,owner.PaperForeground,maxWidth:Math.Max(10,item.Bounds.Width-20),textWrapping:TextWrapping.Wrap);alt.Draw(context,item.Bounds.Position+new Vector(10,10));}
            }
            if(owner.SelectedBlockId==item.Block.Id){context.DrawRectangle(null,new Pen(Brush.Parse("#6366F1"),2),item.Bounds.Inflate(3));context.DrawRectangle(Brushes.White,new Pen(Brush.Parse("#6366F1"),1),new Rect(item.Bounds.BottomRight-new Vector(4,4),new Size(8,8)));}
        }
        if(IsFocused&&owner.Session.Selection.IsEmpty&&owner.SelectedBlockId is null&&!owner.IsReadOnly)
        {
            var caret=GetCaretRectUnscaled();if(_caretOn)context.DrawRectangle(owner.PaperForeground,null,caret);
            if(_preedit.Length>0)
            {
                using var composition=new TextLayout(_preedit,new Typeface(owner.FontFamily??FontFamily.Default),owner.Session.TypingStyle.FontSize??16,owner.PaperForeground,textDecorations:TextDecorations.Underline,maxWidth:owner.PageWidth-owner.PagePadding*2,textWrapping:TextWrapping.Wrap);
                context.DrawRectangle(owner.PaperBrush,null,new Rect(caret.Position,new Size(Math.Max(2,composition.Width),composition.Height)));composition.Draw(context,caret.Position);
            }
        }
    }
    private static void DrawRange(DrawingContext context,DocumentLayout.ParagraphVisual p,TextRange range,IBrush brush)
    {
        if(range.Length==0)return;var start=Math.Max(range.Start,p.Leaf.Start);var end=Math.Min(range.End,p.Leaf.End);
        if(end>start)foreach(var rect in p.Layout.HitTestTextRange(start-p.Leaf.Start,end-start))context.DrawRectangle(brush,null,rect.Translate(p.Bounds.Position));
        if(range.Start<=p.Leaf.End&&range.End>p.Leaf.End){var r=p.Layout.HitTestTextPosition(p.Leaf.Paragraph.Length);context.DrawRectangle(brush,null,new Rect(p.Bounds.X+r.X,p.Bounds.Y+r.Y,5,Math.Max(18,r.Height)));}
    }
    private Rect GetCaretRectUnscaled(int? position=null)
    {
        EnsureLayout();if(_owner is null||_layout.Paragraphs.Count==0)return new(84,84,1.5,22);
        var offset=position??_owner.Session.Selection.Focus;var leaf=_owner.Session.Index.At(offset);var p=_layout.Paragraphs.FirstOrDefault(p=>p.Leaf.Paragraph.Id==leaf.Paragraph.Id);
        if(p is null)return new(84,84,1.5,22);var r=p.Layout.HitTestTextPosition(Math.Clamp(offset-leaf.Start,0,leaf.Paragraph.Length));
        return new(p.Bounds.X+r.X,p.Bounds.Y+r.Y,1.5,Math.Max(18,r.Height));
    }
    public Rect GetCaretRectangle(int? position=null)
    {var r=GetCaretRectUnscaled(position);var z=_owner?.Zoom??1;return new(r.X*z,r.Y*z,r.Width*z,r.Height*z);}
    public Rect? GetObjectRectangle(string id)
    {EnsureLayout();var item=_layout.Objects.FirstOrDefault(o=>o.Block.Id==id);if(item is null)return null;var z=_owner?.Zoom??1;return new(item.Bounds.X*z,item.Bounds.Y*z,item.Bounds.Width*z,item.Bounds.Height*z);}
    public int PositionFromPoint(Point point)
    {
        EnsureLayout();if(_owner is null||_layout.Paragraphs.Count==0)return 0;point=new(point.X/_owner.Zoom,point.Y/_owner.Zoom);
        var first=Math.Max(0,_layout.FirstVisible(point.Y)-1);DocumentLayout.ParagraphVisual? best=null;var distance=double.PositiveInfinity;
        for(var i=first;i<_layout.Paragraphs.Count;i++)
        {
            var p=_layout.Paragraphs[i];var bounds=p.CellBounds??p.Bounds;var dy=point.Y<bounds.Top?bounds.Top-point.Y:point.Y>bounds.Bottom?point.Y-bounds.Bottom:0;
            var dx=point.X<bounds.Left?bounds.Left-point.X:point.X>bounds.Right?point.X-bounds.Right:0;var d=dy*dy*4+dx*dx;
            if(d<distance){distance=d;best=p;}if(p.Bounds.Top>point.Y+100&&best is not null)break;
        }
        best??=_layout.Paragraphs[^1];var local=point-best.Bounds.Position;var hit=best.Layout.HitTestPoint(new Point(local.X,local.Y));return best.Leaf.Start+Math.Clamp(hit.TextPosition,0,best.Leaf.Paragraph.Length);
    }
    public void EnsureCaretVisible(){if(_owner is null||TopLevel.GetTopLevel(this) is null)return;var caret=GetCaretRectangle();this.BringIntoView(caret.Inflate(12));}
    private sealed class SurfaceInputMethod(DocumentSurface surface):TextInputMethodClient
    {
        public override Visual TextViewVisual=>surface;
        public override bool SupportsPreedit=>true;
        public override bool SupportsSurroundingText=>true;
        public override string SurroundingText=>surface._owner?.Session.Index.At(surface._owner.Session.Selection.Focus).Paragraph.Text??"";
        public override Rect CursorRectangle=>surface.GetCaretRectangle();
        public override TextSelection Selection
        {
            get{if(surface._owner is not { } o)return default;var leaf=o.Session.Index.At(o.Session.Selection.Focus);return new(Math.Clamp(o.Session.Selection.Start-leaf.Start,0,leaf.Paragraph.Length),Math.Clamp(o.Session.Selection.End-leaf.Start,0,leaf.Paragraph.Length));}
            set{if(surface._owner is not { } o)return;var leaf=o.Session.Index.At(o.Session.Selection.Focus);o.Session.SetSelection(leaf.Start+Math.Clamp(value.Start,0,leaf.Paragraph.Length),leaf.Start+Math.Clamp(value.End,0,leaf.Paragraph.Length));}
        }
        public override void SetPreeditText(string? preeditText){surface._preedit=preeditText??"";surface.InvalidateVisual();}
        public override void ExecuteContextMenuAction(ContextMenuAction action)=>surface._owner?.Execute(action.ToString());
        public void Notify(){RaiseCursorRectangleChanged();RaiseSurroundingTextChanged();RaiseSelectionChanged();}
    }
}
