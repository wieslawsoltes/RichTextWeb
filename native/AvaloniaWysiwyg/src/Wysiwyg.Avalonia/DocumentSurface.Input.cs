using Avalonia;
using Avalonia.Input;
using Avalonia.Media;
using Wysiwyg.Core;
namespace Wysiwyg.Controls;
public partial class DocumentSurface
{
    private bool _dragging;
    private int _dragAnchor;
    private double? _preferredX;
    private string? _resizingImage;
    private Point _resizeStart;
    private Size _resizeOriginal;
    protected override void OnTextInput(TextInputEventArgs e)
    {
        base.OnTextInput(e);if(_owner is null||_owner.IsReadOnly||string.IsNullOrEmpty(e.Text))return;
        _preedit="";_owner.SelectedBlockId=null;_owner.TryEdit(()=>_owner.Session.InsertText(e.Text));_preferredX=null;e.Handled=true;EnsureCaretVisible();
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);if(e.Handled||_owner is not { } owner)return;var s=owner.Session;
        var primary=(e.KeyModifiers&(KeyModifiers.Control|KeyModifiers.Meta))!=0;
        var word=primary||OperatingSystem.IsMacOS()&&e.KeyModifiers.HasFlag(KeyModifiers.Alt);
        var shift=e.KeyModifiers.HasFlag(KeyModifiers.Shift);string? command=null;
        if(primary)
        {
            command=e.Key switch {Key.B=>"Bold",Key.I=>"Italic",Key.U=>"Underline",Key.A=>"SelectAll",Key.C=>"Copy",Key.X=>"Cut",Key.V=>"Paste",Key.Z=>shift?"Redo":"Undo",Key.Y=>"Redo",Key.F or Key.H=>"Search",Key.Add or Key.OemPlus=>"ZoomIn",Key.Subtract or Key.OemMinus=>"ZoomOut",_=>null};
            if(command is not null){if(command=="Paste"&&shift)_=owner.PasteAsync(true);else owner.Execute(command);e.Handled=true;return;}
        }
        owner.TryEdit(()=>
        {
            switch(e.Key)
            {
                case Key.Left: owner.SelectedBlockId=null;s.MoveCaret(!shift&&!s.Selection.IsEmpty?s.Selection.Start:s.PreviousPosition(word),shift);_preferredX=null;break;
                case Key.Right:owner.SelectedBlockId=null;s.MoveCaret(!shift&&!s.Selection.IsEmpty?s.Selection.End:s.NextPosition(word),shift);_preferredX=null;break;
                case Key.Up:MoveVertical(-1,shift);break;case Key.Down:MoveVertical(1,shift);break;
                case Key.Home:MoveLineBoundary(false,primary,shift);break;case Key.End:MoveLineBoundary(true,primary,shift);break;
                case Key.PageUp:case Key.PageDown:
                    var caret=GetCaretRectangle();var delta=(owner.Scroller?.Viewport.Height??500)*(e.Key==Key.PageUp?-1:1);s.MoveCaret(PositionFromPoint(new(caret.X,caret.Y+delta)),shift);break;
                case Key.Enter:if(!owner.IsReadOnly){owner.SelectedBlockId=null;s.Enter(shift);}break;
                case Key.Back:if(!owner.IsReadOnly){if(owner.SelectedBlockId is { } backId)s.RemoveBlock(backId);else s.DeleteBackward(word);}break;
                case Key.Delete:if(!owner.IsReadOnly){if(owner.SelectedBlockId is { } deleteId)s.RemoveBlock(deleteId);else s.DeleteForward(word);}break;
                case Key.Tab:
                    if(primary)return;
                    if(!s.NavigateTable(shift)){if(shift)s.Indent(-1);else s.Indent(1);}break;
                case Key.Escape:owner.SelectedBlockId=null;owner.SearchVisible=false;_preedit="";break;
                default:return;
            }
            e.Handled=true;
        });
        if(e.Handled){_caretOn=true;EnsureCaretVisible();}
    }
    private void MoveVertical(int direction,bool extend)
    {
        if(_owner is not { } owner)return;EnsureLayout();var s=owner.Session;var leaf=s.Index.At(s.Selection.Focus);var p=_layout.Paragraphs.FirstOrDefault(p=>p.Leaf.Paragraph.Id==leaf.Paragraph.Id);if(p is null)return;
        var index=p.Layout.GetLineIndexFromCharacterIndex(s.Selection.Focus-leaf.Start,false);var lines=p.Layout.TextLines;
        var caret=GetCaretRectUnscaled();_preferredX??=caret.X;var x=_preferredX.Value;
        var next=index+direction;
        if(next>=0&&next<lines.Count){var y=lines.Take(next).Sum(l=>l.Height)+lines[next].Height/2;var hit=p.Layout.HitTestPoint(new Point(x-p.Bounds.X,y));s.MoveCaret(leaf.Start+hit.TextPosition,extend);}
        else
        {
            var current=_layout.Paragraphs.IndexOf(p);var target=Math.Clamp(current+direction,0,_layout.Paragraphs.Count-1);var other=_layout.Paragraphs[target];
            var y=direction<0?Math.Max(0,other.Layout.Height-other.Layout.TextLines[^1].Height/2):other.Layout.TextLines[0].Height/2;
            var hit=other.Layout.HitTestPoint(new Point(x-other.Bounds.X,y));s.MoveCaret(other.Leaf.Start+hit.TextPosition,extend);
        }
    }
    private void MoveLineBoundary(bool end,bool document,bool extend)
    {
        if(_owner is not { } owner)return;var s=owner.Session;_preferredX=null;
        if(document){s.MoveCaret(end?s.Index.Length:0,extend);return;}EnsureLayout();var leaf=s.Index.At(s.Selection.Focus);var p=_layout.Paragraphs.FirstOrDefault(p=>p.Leaf.Paragraph.Id==leaf.Paragraph.Id);if(p is null)return;
        var i=p.Layout.GetLineIndexFromCharacterIndex(s.Selection.Focus-leaf.Start,false);var line=p.Layout.TextLines[Math.Clamp(i,0,p.Layout.TextLines.Count-1)];
        var offset=line.FirstTextSourceIndex+(end?line.Length-line.NewLineLength:0);s.MoveCaret(leaf.Start+Math.Min(offset,leaf.Paragraph.Length),extend);
    }
    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);if(_owner is not { } owner)return;var properties=e.GetCurrentPoint(this).Properties;
        if(properties.IsRightButtonPressed){Focus();return;}if(!properties.IsLeftButtonPressed&&e.Pointer.Type!=PointerType.Touch)return;
        Focus();EnsureLayout();var point=e.GetPosition(this);var logical=new Point(point.X/owner.Zoom,point.Y/owner.Zoom);_preferredX=null;
        var obj=_layout.Objects.LastOrDefault(o=>o.Bounds.Inflate(7).Contains(logical));
        if(obj is not null)
        {
            owner.SelectedBlockId=obj.Block.Id;
            if(obj.Block is ImageBlock image&&!owner.IsReadOnly&&new Rect(obj.Bounds.BottomRight-new Vector(10,10),new Size(20,20)).Contains(logical))
            {_resizingImage=image.Id;_resizeStart=point;_resizeOriginal=new(image.Width,image.Height);e.Pointer.Capture(this);}
            e.Handled=true;InvalidateVisual();return;
        }
        owner.SelectedBlockId=null;var position=PositionFromPoint(point);
        if(e.ClickCount>=3)owner.Session.SelectParagraph(position);else if(e.ClickCount==2)owner.Session.SelectWord(position);else owner.Session.MoveCaret(position,e.KeyModifiers.HasFlag(KeyModifiers.Shift));
        var leaf=owner.Session.Index.At(position);var visual=_layout.Paragraphs.FirstOrDefault(p=>p.Leaf.Paragraph.Id==leaf.Paragraph.Id);
        if(leaf.Paragraph.Style.List==ListKind.Check&&visual is not null&&logical.X<visual.Bounds.X&&logical.X>=visual.Bounds.X-26&&!owner.IsReadOnly)
        {var value=!leaf.Paragraph.Style.Checked;owner.TryEdit(()=>owner.Session.FormatParagraph(p=>p with {Checked=value}));}
        _dragAnchor=owner.Session.Selection.Anchor;_dragging=e.ClickCount==1;e.Pointer.Capture(this);e.Handled=true;EnsureCaretVisible();
    }
    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);if(_owner is not { } owner)return;
        if(_resizingImage is not null){Cursor=new Cursor(StandardCursorType.BottomRightCorner);return;}
        if(_dragging){owner.Session.SetSelection(_dragAnchor,PositionFromPoint(e.GetPosition(this)));EnsureCaretVisible();e.Handled=true;}
        else
        {
            var p=e.GetPosition(this);var logical=new Point(p.X/owner.Zoom,p.Y/owner.Zoom);var image=_layout.Objects.LastOrDefault(o=>o.Block is ImageBlock&&o.Bounds.Inflate(8).Contains(logical));
            Cursor=new Cursor(image is null?StandardCursorType.Ibeam:new Rect(image.Bounds.BottomRight-new Vector(10,10),new Size(20,20)).Contains(logical)?StandardCursorType.BottomRightCorner:StandardCursorType.Arrow);
        }
    }
    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if(_resizingImage is { } id&&_owner is { } owner)
        {
            var delta=(e.GetPosition(this).X-_resizeStart.X)/owner.Zoom;var width=Math.Clamp(_resizeOriginal.Width+delta,24,Math.Min(4096,owner.PageWidth-owner.PagePadding*2));var height=Math.Clamp(_resizeOriginal.Height*width/_resizeOriginal.Width,1,4096);
            owner.TryEdit(()=>owner.Session.ResizeImage(id,width,height));_resizingImage=null;e.Handled=true;
        }
        _dragging=false;e.Pointer.Capture(null);Cursor=new Cursor(StandardCursorType.Ibeam);
    }
    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e){base.OnPointerCaptureLost(e);_dragging=false;_resizingImage=null;}
    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {if(_owner is { } owner&&(e.KeyModifiers&(KeyModifiers.Control|KeyModifiers.Meta))!=0){owner.Zoom=Math.Clamp(Math.Round(owner.Zoom+e.Delta.Y*0.1,2),0.25,3);e.Handled=true;}else base.OnPointerWheelChanged(e);}
}
