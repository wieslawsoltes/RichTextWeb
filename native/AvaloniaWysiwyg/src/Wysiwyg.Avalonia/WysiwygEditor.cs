using System.Collections.Immutable;
using System.Windows.Input;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Metadata;
using Avalonia.Controls.Primitives;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Media;
using Avalonia.Threading;
using Wysiwyg.Core;
using Wysiwyg.Formats;
namespace Wysiwyg.Controls;

[TemplatePart("PART_Surface",typeof(DocumentSurface))]
[TemplatePart("PART_ScrollViewer",typeof(ScrollViewer))]
[TemplatePart("PART_SearchBox",typeof(TextBox))]
[PseudoClasses(":readonly",":dirty",":selection")]
public class WysiwygEditor : TemplatedControl
{
    public static readonly StyledProperty<RichDocument?> DocumentProperty = AvaloniaProperty.Register<WysiwygEditor,RichDocument?>(nameof(Document),defaultBindingMode:BindingMode.TwoWay);
    public static readonly StyledProperty<bool> IsReadOnlyProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(IsReadOnly));
    public static readonly StyledProperty<bool> ShowToolbarProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(ShowToolbar),true);
    public static readonly StyledProperty<bool> ShowStatusBarProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(ShowStatusBar),true);
    public static readonly StyledProperty<double> ZoomProperty = AvaloniaProperty.Register<WysiwygEditor,double>(nameof(Zoom),1,validate:v=>double.IsFinite(v)&&v is >=0.25 and <=3);
    public static readonly StyledProperty<double> PageWidthProperty = AvaloniaProperty.Register<WysiwygEditor,double>(nameof(PageWidth),794,validate:v=>double.IsFinite(v)&&v is >=320 and <=1600);
    public static readonly StyledProperty<double> PagePaddingProperty = AvaloniaProperty.Register<WysiwygEditor,double>(nameof(PagePadding),64,validate:v=>double.IsFinite(v)&&v is >=0 and <=140);
    public static readonly StyledProperty<IBrush> PaperBrushProperty = AvaloniaProperty.Register<WysiwygEditor,IBrush>(nameof(PaperBrush),Brushes.White);
    public static readonly StyledProperty<IBrush> PaperForegroundProperty = AvaloniaProperty.Register<WysiwygEditor,IBrush>(nameof(PaperForeground),Brush.Parse("#243047"));
    public static readonly StyledProperty<IBrush> SelectionBrushProperty = AvaloniaProperty.Register<WysiwygEditor,IBrush>(nameof(SelectionBrush),Brush.Parse("#506366F1"));
    public static readonly StyledProperty<string> StatusTextProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(StatusText),"Ready");
    public static readonly StyledProperty<string> ZoomTextProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(ZoomText),"100%");
    public static readonly StyledProperty<string> MessageProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(Message),"");
    public static readonly StyledProperty<bool?> IsBoldProperty = AvaloniaProperty.Register<WysiwygEditor,bool?>(nameof(IsBold),false);
    public static readonly StyledProperty<bool?> IsItalicProperty = AvaloniaProperty.Register<WysiwygEditor,bool?>(nameof(IsItalic),false);
    public static readonly StyledProperty<bool?> IsUnderlineProperty = AvaloniaProperty.Register<WysiwygEditor,bool?>(nameof(IsUnderline),false);
    public static readonly StyledProperty<bool?> IsStrikeProperty = AvaloniaProperty.Register<WysiwygEditor,bool?>(nameof(IsStrike),false);
    public static readonly StyledProperty<bool> SearchVisibleProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(SearchVisible));
    public static readonly StyledProperty<string> SearchTextProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(SearchText),"",defaultBindingMode:BindingMode.TwoWay);
    public static readonly StyledProperty<string> ReplacementTextProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(ReplacementText),"",defaultBindingMode:BindingMode.TwoWay);
    public static readonly StyledProperty<bool> MatchCaseProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(MatchCase));
    public static readonly StyledProperty<bool> WholeWordProperty = AvaloniaProperty.Register<WysiwygEditor,bool>(nameof(WholeWord));
    public static readonly StyledProperty<string> SearchStatusProperty = AvaloniaProperty.Register<WysiwygEditor,string>(nameof(SearchStatus),"");
    public static readonly StyledProperty<string?> SelectedBlockIdProperty = AvaloniaProperty.Register<WysiwygEditor,string?>(nameof(SelectedBlockId));
    private bool _sync; private DocumentSurface? _surface; private TextBox? _searchBox;
    private readonly EditorCommand _command;
    private ImmutableArray<SearchResult> _matches=[];
    internal ScrollViewer? Scroller { get; private set; }
    internal IReadOnlyList<SearchResult> SearchMatches => _matches;
    public EditorSession Session { get; } = new();
    public ICommand Command => _command;
    public DocumentSurface? Surface => _surface;
    public RichDocument? Document { get=>GetValue(DocumentProperty); set=>SetValue(DocumentProperty,value); }
    public bool IsReadOnly { get=>GetValue(IsReadOnlyProperty); set=>SetValue(IsReadOnlyProperty,value); }
    public bool ShowToolbar { get=>GetValue(ShowToolbarProperty); set=>SetValue(ShowToolbarProperty,value); }
    public bool ShowStatusBar { get=>GetValue(ShowStatusBarProperty); set=>SetValue(ShowStatusBarProperty,value); }
    public double Zoom { get=>GetValue(ZoomProperty); set=>SetValue(ZoomProperty,value); }
    public double PageWidth { get=>GetValue(PageWidthProperty); set=>SetValue(PageWidthProperty,value); }
    public double PagePadding { get=>GetValue(PagePaddingProperty); set=>SetValue(PagePaddingProperty,value); }
    public IBrush PaperBrush { get=>GetValue(PaperBrushProperty); set=>SetValue(PaperBrushProperty,value); }
    public IBrush PaperForeground { get=>GetValue(PaperForegroundProperty); set=>SetValue(PaperForegroundProperty,value); }
    public IBrush SelectionBrush { get=>GetValue(SelectionBrushProperty); set=>SetValue(SelectionBrushProperty,value); }
    public string StatusText { get=>GetValue(StatusTextProperty); private set=>SetValue(StatusTextProperty,value); }
    public string ZoomText { get=>GetValue(ZoomTextProperty); private set=>SetValue(ZoomTextProperty,value); }
    public string Message { get=>GetValue(MessageProperty); set=>SetValue(MessageProperty,value); }
    public bool? IsBold { get=>GetValue(IsBoldProperty); private set=>SetValue(IsBoldProperty,value); }
    public bool? IsItalic { get=>GetValue(IsItalicProperty); private set=>SetValue(IsItalicProperty,value); }
    public bool? IsUnderline { get=>GetValue(IsUnderlineProperty); private set=>SetValue(IsUnderlineProperty,value); }
    public bool? IsStrike { get=>GetValue(IsStrikeProperty); private set=>SetValue(IsStrikeProperty,value); }
    public bool SearchVisible { get=>GetValue(SearchVisibleProperty); set=>SetValue(SearchVisibleProperty,value); }
    public string SearchText { get=>GetValue(SearchTextProperty); set=>SetValue(SearchTextProperty,value); }
    public string ReplacementText { get=>GetValue(ReplacementTextProperty); set=>SetValue(ReplacementTextProperty,value); }
    public bool MatchCase { get=>GetValue(MatchCaseProperty); set=>SetValue(MatchCaseProperty,value); }
    public bool WholeWord { get=>GetValue(WholeWordProperty); set=>SetValue(WholeWordProperty,value); }
    public string SearchStatus { get=>GetValue(SearchStatusProperty); private set=>SetValue(SearchStatusProperty,value); }
    public string? SelectedBlockId { get=>GetValue(SelectedBlockIdProperty); set=>SetValue(SelectedBlockIdProperty,value); }
    public event EventHandler<DocumentChangedEventArgs>? DocumentChanged;
    public event EventHandler? SelectionChanged;
    public event EventHandler<string>? OperationFailed;
    public WysiwygEditor()
    {
        _command=new(Execute,CanExecute); Focusable=true;
        Session.DocumentChanged+=(_,e)=>
        {
            _sync=true; SetCurrentValue(DocumentProperty,e.After); _sync=false;
            if(SelectedBlockId is { } id && !e.After.Blocks.Any(b=>b.Id==id)) SelectedBlockId=null;
            RefreshSearch(); _surface?.DocumentInvalidated(); DocumentChanged?.Invoke(this,e);
        };
        Session.SelectionChanged+=(_,_)=>{RefreshState();_surface?.SelectionInvalidated();SelectionChanged?.Invoke(this,EventArgs.Empty);};
        Session.StateChanged+=(_,_)=>RefreshState();
        _sync=true; SetCurrentValue(DocumentProperty,Session.Document); _sync=false;
        RefreshState();
    }
    protected override void OnApplyTemplate(TemplateAppliedEventArgs e)
    {
        _surface?.Disconnect(); base.OnApplyTemplate(e);
        _surface=e.NameScope.Find<DocumentSurface>("PART_Surface"); Scroller=e.NameScope.Find<ScrollViewer>("PART_ScrollViewer"); _searchBox=e.NameScope.Find<TextBox>("PART_SearchBox");
        _surface?.Connect(this);
        if(_surface is null) Message="The template has no PART_Surface; document commands remain available.";
    }
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if(Session is null) return;
        if(change.Property==DocumentProperty && !_sync && !ReferenceEquals(Document,Session.Document)) Session.Load(Document??RichDocument.Empty());
        if(change.Property==IsReadOnlyProperty) {Session.IsReadOnly=IsReadOnly;_surface?.SelectionInvalidated();}
        if(change.Property==ZoomProperty || change.Property==PageWidthProperty || change.Property==PagePaddingProperty || change.Property==FontFamilyProperty || change.Property==PaperForegroundProperty) { _surface?.DocumentInvalidated(true); ZoomText=$"{Zoom:P0}"; }
        if(change.Property==PaperBrushProperty || change.Property==SelectionBrushProperty || change.Property==SelectedBlockIdProperty) _surface?.InvalidateVisual();
        if(change.Property==SearchTextProperty || change.Property==MatchCaseProperty || change.Property==WholeWordProperty) RefreshSearch();
    }
    private void RefreshState()
    {
        var f=Session.GetFormatting();IsBold=f.Bold;IsItalic=f.Italic;IsUnderline=f.Underline;IsStrike=f.Strike;
        StatusText=$"{Session.WordCount:N0} words  ·  {Session.CharacterCount:N0} characters"+(Session.Selection.IsEmpty?"":$"  ·  {Session.Selection.Length:N0} selected")+(IsReadOnly?"  ·  Read only":Session.IsDirty?"  ·  Unsaved changes":"  ·  Saved");
        PseudoClasses.Set(":readonly",IsReadOnly);PseudoClasses.Set(":dirty",Session.IsDirty);PseudoClasses.Set(":selection",!Session.Selection.IsEmpty);
        _command.Refresh();
    }
    private SearchOptions SearchOptions => new(MatchCase,WholeWord);
    private void RefreshSearch()
    {
        try { _matches=Session.Find(SearchText??"",SearchOptions);SearchStatus=string.IsNullOrEmpty(SearchText)?"":$"{_matches.Length:N0} matches"; }
        catch(Exception ex) when(ex is ArgumentException or TimeoutException) { _matches=[];SearchStatus=ex.Message; }
        _surface?.InvalidateVisual();
    }
    public void FocusEditor() { _surface?.Focus(); _surface?.EnsureCaretVisible(); }
    public void Report(string message) { Message=message; }
    public bool TryEdit(Action action)
    {
        try {action();Message="";return true;} catch(Exception ex) when(ex is ArgumentException or InvalidOperationException or TimeoutException) {Message=ex.Message;OperationFailed?.Invoke(this,ex.Message);return false;}
    }
    private bool CanExecute(string name) => name switch
    {
        "Undo"=>Session.CanUndo,"Redo"=>Session.CanRedo,"Copy"=>!Session.Selection.IsEmpty,
        "Cut"=>!IsReadOnly&&!Session.Selection.IsEmpty,"Search" or "CloseSearch" or "NextMatch" or "PreviousMatch" or "SelectAll" or "ZoomIn" or "ZoomOut" or "Fit"=>true,
        "AddRow" or "DeleteRow" or "AddColumn" or "DeleteColumn"=>!IsReadOnly&&Session.CurrentTable is not null,
        "DeleteBlock"=>!IsReadOnly&&SelectedBlockId is not null,_=>!IsReadOnly
    };
    public void Execute(string name)
    {
        if(!CanExecute(name))return;
        if(name=="Copy"){_=CopyAsync();return;}if(name=="Cut"){_=CopyAsync(true);return;}if(name=="Paste"){_=PasteAsync();return;}
        if(name=="Search"){SearchVisible=true;Dispatcher.UIThread.Post(()=>_searchBox?.Focus());return;}
        TryEdit(()=>
        {
            switch(name)
            {
                case "Undo":Session.Undo();break;case "Redo":Session.Redo();break;
                case "Bold":Session.ToggleBold();break;case "Italic":Session.ToggleItalic();break;case "Underline":Session.ToggleUnderline();break;case "Strike":Session.ToggleStrike();break;
                case "Clear":Session.ClearFormatting();break;case "Bullet":Session.ToggleList(ListKind.Bullet);break;case "Numbered":Session.ToggleList(ListKind.Numbered);break;case "Check":Session.ToggleList(ListKind.Check);break;
                case "Left":Session.FormatParagraph(p=>p with {Alignment=ParagraphAlignment.Start});break;case "Center":Session.FormatParagraph(p=>p with {Alignment=ParagraphAlignment.Center});break;case "Right":Session.FormatParagraph(p=>p with {Alignment=ParagraphAlignment.End});break;case "Justify":Session.FormatParagraph(p=>p with {Alignment=ParagraphAlignment.Justify});break;
                case "Indent":Session.Indent(1);break;case "Outdent":Session.Indent(-1);break;
                case "Quote":var quote=!Session.Index.At(Session.Selection.Focus).Paragraph.Style.Quote;Session.FormatParagraph(p=>p with {Quote=quote});break;
                case "Code":var code=!Session.Index.At(Session.Selection.Focus).Paragraph.Style.CodeBlock;Session.FormatParagraph(p=>p with {CodeBlock=code});break;
                case "Rule":Session.InsertRule();break;case "Table":Session.InsertTable();break;case "AddRow":Session.AddTableRow();break;case "DeleteRow":Session.RemoveTableRow();break;case "AddColumn":Session.AddTableColumn();break;case "DeleteColumn":Session.RemoveTableColumn();break;
                case "DeleteBlock":if(SelectedBlockId is { } id)Session.RemoveBlock(id);break;
                case "SelectAll":Session.SelectAll();break;
                case "NextMatch":Session.FindNext(SearchText,SearchOptions);break;case "PreviousMatch":Session.FindNext(SearchText,SearchOptions,true);break;
                case "Replace":if(!Session.Selection.IsEmpty && _matches.Any(m=>m.Range==Session.Selection.Range))Session.InsertText(ReplacementText,false);Session.FindNext(SearchText,SearchOptions);break;
                case "ReplaceAll":Session.ReplaceAll(SearchText,ReplacementText,SearchOptions);break;
                case "CloseSearch":SearchVisible=false;break;
                case "ZoomIn":Zoom=Math.Min(3,Math.Round(Zoom+0.1,2));break;case "ZoomOut":Zoom=Math.Max(0.25,Math.Round(Zoom-0.1,2));break;
                case "Fit":Zoom=Math.Clamp(((Scroller?.Viewport.Width??PageWidth)-48)/(PageWidth+40),0.25,1.5);break;
                case "Body":Session.SetHeading(0);break;case "H1":Session.SetHeading(1);break;case "H2":Session.SetHeading(2);break;case "H3":Session.SetHeading(3);break;
            }
        });
        FocusEditor();
    }
    private static readonly DataFormat<string> NativeFormat=DataFormat.CreateStringApplicationFormat("Folio.RichDocument");
    public async Task CopyAsync(bool cut=false)
    {
        if(Session.Selection.IsEmpty || cut&&IsReadOnly)return;
        var document=Session.Document;var selection=Session.Selection;var clipboard=TopLevel.GetTopLevel(this)?.Clipboard;
        if(clipboard is null){Message="Clipboard is not available on this host.";return;}
        try
        {
            var fragment=Session.CopySelection();var item=DataTransferItem.CreateText(Session.SelectedText);item.Set(NativeFormat,DocumentFormats.ToJson(fragment));var data=new DataTransfer();data.Add(item);
            try {await clipboard.SetDataAsync(data);}catch(NotSupportedException){await clipboard.SetTextAsync(new DocumentIndex(fragment).Text);}
            if(cut && ReferenceEquals(document,Session.Document) && selection==Session.Selection && !IsReadOnly)Session.InsertText("",false);
            Message=cut?"Selection cut":"Selection copied";FocusEditor();
        }
        catch(Exception ex){Message="Clipboard operation failed: "+ex.Message;OperationFailed?.Invoke(this,Message);}
    }
    public async Task PasteAsync(bool plainText=false)
    {
        if(IsReadOnly)return;var document=Session.Document;var selection=Session.Selection;var clipboard=TopLevel.GetTopLevel(this)?.Clipboard;
        if(clipboard is null){Message="Clipboard is not available on this host.";return;}
        try
        {
            using var data=await clipboard.TryGetDataAsync();if(data is null)return;
            var json=plainText?null:await data.TryGetValueAsync(NativeFormat);var text=json is null?await data.TryGetValueAsync(DataFormat.Text):null;
            if(!ReferenceEquals(document,Session.Document)||selection!=Session.Selection||IsReadOnly){Message="Paste cancelled because the document or selection changed.";return;}
            if(json is not null)TryEdit(()=>Session.InsertFragment(DocumentFormats.FromJson(json,Session.Limits)));else if(text is not null)TryEdit(()=>Session.InsertText(text,false));
            FocusEditor();
        }
        catch(Exception ex){Message="Paste failed: "+ex.Message;OperationFailed?.Invoke(this,Message);}
    }
}
