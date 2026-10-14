using System.Collections.Immutable;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Styling;
using Avalonia.Threading;
using Wysiwyg.Controls;
using Wysiwyg.Core;
using Wysiwyg.Formats;
namespace Folio.Sample;

public partial class MainView:UserControl
{
    public static MainView? Current {get;private set;}
    public WysiwygEditor Editor {get;}
    private readonly DispatcherTimer _autosave=new(){Interval=TimeSpan.FromMilliseconds(800)};
    private bool _uiSync;
    private string _outlineSignature="",_commentSignature="";
    public MainView()
    {
        AvaloniaXamlLoader.Load(this);Current=this;Editor=Find<WysiwygEditor>("DocumentEditor");
        Wire("NewButton",()=>{Editor.Session.Load(RichDocument.Empty());Editor.FocusEditor();});
        WireAsync("OpenButton",OpenAsync);WireAsync("SaveButton",()=>SaveAsync("folio"));
        WireAsync("ExportHtmlButton",()=>SaveAsync("html"));WireAsync("ExportMarkdownButton",()=>SaveAsync("md"));WireAsync("ExportTextButton",()=>SaveAsync("txt"));
        Wire("ThemeButton",()=>SetDark(Application.Current?.RequestedThemeVariant!=ThemeVariant.Dark));
        Wire("ApplyFontButton",()=>{var family=Find<TextBox>("FontFamilyBox").Text??"Inter";var size=(double)(Find<NumericUpDown>("FontSizeBox").Value??16);Editor.TryEdit(()=>Editor.Session.ApplyTextStyle(s=>s with {FontFamily=family,FontSize=size}));Editor.FocusEditor();});
        Wire("HighlightButton",()=>{Editor.TryEdit(()=>Editor.Session.ApplyTextStyle(s=>s with {Background="#FEF08A"}));Editor.FocusEditor();});
        Wire("ApplyLinkButton",()=>{Editor.TryEdit(()=>Editor.Session.SetLink(Find<TextBox>("LinkBox").Text));Editor.FocusEditor();});
        Wire("RemoveLinkButton",()=>{Editor.TryEdit(()=>Editor.Session.SetLink(null));Editor.FocusEditor();});
        WireAsync("InsertImageButton",InsertImageAsync);
        Wire("DemoImageButton",()=>{Editor.TryEdit(()=>Editor.Session.InsertImage(SampleDocument.Artwork,"Geometric launch artwork",560,140));Editor.FocusEditor();});
        Wire("AddCommentButton",()=>{if(Editor.TryEdit(()=>Editor.Session.AddComment(Find<TextBox>("CommentBox").Text??"")))Find<TextBox>("CommentBox").Text="";Editor.FocusEditor();});
        foreach(var pair in new[]{("AlignLeftButton","Left"),("AlignCenterButton","Center"),("AlignRightButton","Right"),("IndentButton","Indent"),("OutdentButton","Outdent"),("InsertRuleButton","Rule"),("CodeButton","Code"),("AddRowButton","AddRow"),("DeleteRowButton","DeleteRow"),("AddColumnButton","AddColumn"),("DeleteColumnButton","DeleteColumn"),("DeleteObjectButton","DeleteBlock")})
        {var button=Find<Button>(pair.Item1);button.Command=Editor.Command;button.CommandParameter=pair.Item2;}
        Find<CheckBox>("ReadOnlyBox").PropertyChanged+=(_,e)=>{if(e.Property==ToggleButton.IsCheckedProperty&&!_uiSync)Editor.IsReadOnly=Find<CheckBox>("ReadOnlyBox").IsChecked==true;};
        Find<CheckBox>("RtlBox").PropertyChanged+=(_,e)=>{if(e.Property==ToggleButton.IsCheckedProperty&&!_uiSync){var rtl=Find<CheckBox>("RtlBox").IsChecked==true;Editor.TryEdit(()=>Editor.Session.FormatParagraph(p=>p with {RightToLeft=rtl}));}};
        Find<TextBox>("TitleBox").KeyDown+=(_,e)=>{if(e.Key==Key.Enter){Rename();Editor.FocusEditor();e.Handled=true;}};
        Find<TextBox>("TitleBox").LostFocus+=(_,_)=>Rename();
        var colors=new[]{"#243047","#6366F1","#0D9488","#DC2626","#D97706","#9333EA"};var swatches=Find<WrapPanel>("ColorSwatches");
        for(var i=0;i<colors.Length;i++)
        {
            var color=colors[i];var button=new Button{Name="Color"+i,Width=24,Height=24,MinWidth=0,MinHeight=0,Padding=new Thickness(0),Margin=new Thickness(0,0,8,6),CornerRadius=new CornerRadius(12),Background=Brush.Parse(color)};ToolTip.SetTip(button,"Text color "+color);
            button.Click+=(_,_)=>{Editor.TryEdit(()=>Editor.Session.ApplyTextStyle(s=>s with {Foreground=color}));Editor.FocusEditor();};swatches.Children.Add(button);
        }
        Editor.DocumentChanged+=(_,_)=>{RefreshDocumentUi();if(!SampleServices.AutomationEnabled){_autosave.Stop();_autosave.Start();}};
        Editor.SelectionChanged+=(_,_)=>RefreshSelectionUi();
        _autosave.Tick+=(_,_)=>
        {
            _autosave.Stop();if(SampleServices.WriteDraft is null)return;
            try{var snapshot=Editor.Session.Document;SampleServices.WriteDraft(DocumentFormats.ToJson(snapshot));if(ReferenceEquals(snapshot,Editor.Session.Document))Editor.Session.MarkSaved();Editor.Report("Draft saved on this device");}
            catch(Exception ex){Editor.Report("Autosave unavailable: "+ex.Message);}
        };
        var document=SampleDocument.Create();
        if(!SampleServices.AutomationEnabled&&SampleServices.ReadDraft is not null)
        {try{var draft=SampleServices.ReadDraft();if(!string.IsNullOrWhiteSpace(draft))document=DocumentFormats.FromJson(draft);}catch(Exception ex){Editor.Report("Draft could not be restored: "+ex.Message);}}
        Editor.Session.Load(document);RefreshDocumentUi();RefreshSelectionUi();
        AttachedToVisualTree+=(_,_)=>Dispatcher.UIThread.Post(()=>{ResizeWorkspace();SampleServices.Ready?.Invoke();},DispatcherPriority.Background);
        DetachedFromVisualTree+=(_,_)=>_autosave.Stop();
        PropertyChanged+=(_,e)=>{if(e.Property==BoundsProperty)ResizeWorkspace();};
    }
    private T Find<T>(string name) where T:Control=>this.FindControl<T>(name)??throw new InvalidOperationException("Missing sample control "+name);
    private void Wire(string name,Action action)=>Find<Button>(name).Click+=(_,_)=>{try{action();}catch(Exception ex){Editor.Report(ex.Message);}};
    private void WireAsync(string name,Func<Task> action)=>Find<Button>(name).Click+=async(_,_)=>{try{await action();}catch(Exception ex){Editor.Report(ex.Message);}};
    private void Rename(){if(_uiSync)return;var title=Find<TextBox>("TitleBox").Text??"";if(title!=Editor.Session.Document.Title)Editor.TryEdit(()=>Editor.Session.Rename(title));}
    public void SetDark(bool dark){if(Application.Current is { } app)app.RequestedThemeVariant=dark?ThemeVariant.Dark:ThemeVariant.Light;Find<Button>("ThemeButton").Content=dark?"Light":"Dark";}
    private void ResizeWorkspace()
    {
        if(Bounds.Width<=0)return;var grid=Find<Grid>("WorkspaceGrid");var outline=Bounds.Width>=1250;var inspector=Bounds.Width>=960;
        grid.ColumnDefinitions[0].Width=new GridLength(outline?178:0);grid.ColumnDefinitions[2].Width=new GridLength(inspector?248:0);
        Find<Border>("OutlinePane").IsVisible=outline;Find<Border>("InspectorPane").IsVisible=inspector;Find<TextBox>("TitleBox").IsVisible=Bounds.Width>=1000;
    }
    private void RefreshDocumentUi()
    {
        _uiSync=true;if(!Find<TextBox>("TitleBox").IsFocused)Find<TextBox>("TitleBox").Text=Editor.Session.Document.Title;_uiSync=false;
        var headings=Editor.Session.Index.Leaves.Where(l=>l.Paragraph.Style.HeadingLevel>0).Take(200).ToArray();var signature=string.Join('|',headings.Select(l=>l.Paragraph.Id+":"+l.Paragraph.Text));
        if(signature!=_outlineSignature)
        {
            _outlineSignature=signature;var outline=Find<StackPanel>("OutlineItems");outline.Children.Clear();
            foreach(var heading in headings)
            {
                var id=heading.Paragraph.Id;var button=new Button{Content=new TextBlock{Text=heading.Paragraph.Text,TextWrapping=TextWrapping.Wrap,FontSize=12},HorizontalAlignment=HorizontalAlignment.Stretch,HorizontalContentAlignment=HorizontalAlignment.Left,Background=Brushes.Transparent,BorderThickness=new Thickness(0),Padding=new Thickness(Math.Max(0,heading.Paragraph.Style.HeadingLevel-1)*9+7,8,7,8)};
                button.Click+=(_,_)=>{if(Editor.Session.Index.ById(id) is { } leaf){Editor.Session.MoveCaret(leaf.Start);Editor.FocusEditor();}};outline.Children.Add(button);
            }
        }
        var comments=Editor.Session.Document.Comments;var cs=string.Join('|',comments.Select(c=>c.Id+":"+c.Resolved+":"+c.Text+":"+c.Orphaned));
        if(cs!=_commentSignature)
        {
            _commentSignature=cs;var panel=Find<StackPanel>("CommentItems");panel.Children.Clear();
            foreach(var comment in comments.Reverse().Take(50))
            {
                var id=comment.Id;var body=new StackPanel{Spacing=5};body.Children.Add(new TextBlock{Text=comment.Author+(comment.Resolved?" · Resolved":comment.Orphaned?" · Detached":" · Open"),FontSize=10,FontWeight=FontWeight.SemiBold});
                body.Children.Add(new TextBlock{Text=comment.Text,TextWrapping=TextWrapping.Wrap,FontSize=12});var row=new StackPanel{Orientation=Orientation.Horizontal,Spacing=4};
                var show=new Button{Content="Go to",FontSize=10,Padding=new Thickness(6,3)};show.Click+=(_,_)=>{var c=Editor.Session.Document.Comments.FirstOrDefault(c=>c.Id==id);if(c is not null){Editor.Session.SetSelection(c.Range.Start,c.Range.End);Editor.FocusEditor();}};row.Children.Add(show);
                var resolve=new Button{Content=comment.Resolved?"Reopen":"Resolve",FontSize=10,Padding=new Thickness(6,3)};resolve.Click+=(_,_)=>Editor.TryEdit(()=>Editor.Session.ResolveComment(id,!comment.Resolved));row.Children.Add(resolve);
                var remove=new Button{Content="×",FontSize=10,Padding=new Thickness(5,3)};remove.Click+=(_,_)=>Editor.TryEdit(()=>Editor.Session.RemoveComment(id));row.Children.Add(remove);body.Children.Add(row);
                panel.Children.Add(new Border{Padding=new Thickness(9),CornerRadius=new CornerRadius(5),BorderThickness=new Thickness(1),BorderBrush=Brush.Parse("#8094A3B8"),Child=body});
            }
            if(comments.Length>50)panel.Children.Add(new TextBlock{Text="Showing the newest 50 comments.",FontSize=10,TextWrapping=TextWrapping.Wrap});
        }
    }
    private void RefreshSelectionUi()
    {
        _uiSync=true;var s=Editor.Session;Find<CheckBox>("ReadOnlyBox").IsChecked=Editor.IsReadOnly;Find<CheckBox>("RtlBox").IsChecked=s.Index.At(s.Selection.Focus).Paragraph.Style.RightToLeft;
        if(!Find<TextBox>("FontFamilyBox").IsFocused)Find<TextBox>("FontFamilyBox").Text=s.TypingStyle.FontFamily??"Inter";
        if(!Find<NumericUpDown>("FontSizeBox").IsKeyboardFocusWithin)Find<NumericUpDown>("FontSizeBox").Value=(decimal)(s.TypingStyle.FontSize??16);
        if(!Find<TextBox>("LinkBox").IsFocused)Find<TextBox>("LinkBox").Text=s.GetFormatting().Link??"";_uiSync=false;
    }
    private async Task OpenAsync()
    {
        var top=TopLevel.GetTopLevel(this);if(top is null)return;
        var files=await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions{Title="Open rich document",AllowMultiple=false,FileTypeFilter=[new("Documents"){Patterns=["*.folio","*.json","*.html","*.htm","*.md","*.txt"]}]});
        if(files.Count==0)return;var file=files[0];await using var stream=await file.OpenReadAsync();var bytes=await ReadBoundedAsync(stream,Editor.Session.Limits.MaxSerializedBytes);var text=new UTF8Encoding(false,true).GetString(bytes);var extension=Path.GetExtension(file.Name).ToLowerInvariant();
        ImportResult result=extension switch{".folio" or ".json"=>new(DocumentFormats.FromJson(text),[]),".html" or ".htm"=>DocumentFormats.FromHtml(text),".md"=>DocumentFormats.FromMarkdown(text),_=>new(DocumentFormats.FromText(text),[])};
        Editor.Session.Load(result.Document);Editor.Report(result.Warnings.IsEmpty?"Opened "+file.Name:string.Join(" ",result.Warnings));Editor.FocusEditor();
    }
    private async Task SaveAsync(string format)
    {
        var snapshot=Editor.Session.Document;var text=format switch{"html"=>DocumentFormats.ToHtml(snapshot),"md"=>DocumentFormats.ToMarkdown(snapshot),"txt"=>DocumentFormats.ToText(snapshot),_=>DocumentFormats.ToJson(snapshot)};
        var safe=string.Concat(snapshot.Title.Select(c=>char.IsLetterOrDigit(c)||c is '-' or '_' or ' '?c:'_'));if(string.IsNullOrWhiteSpace(safe))safe="Document";var name=safe+"."+format;
        if(SampleServices.DownloadText is { } download)await download(name,text);
        else
        {
            var top=TopLevel.GetTopLevel(this);if(top is null)return;var file=await top.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions{Title="Save document",SuggestedFileName=name,DefaultExtension=format,ShowOverwritePrompt=true,FileTypeChoices=[new("Document"){Patterns=["*."+format]}]});
            if(file is null)return;await using var stream=await file.OpenWriteAsync();if(stream.CanSeek)stream.SetLength(0);var bytes=Encoding.UTF8.GetBytes(text);await stream.WriteAsync(bytes);await stream.FlushAsync();
        }
        if(format=="folio"&&ReferenceEquals(snapshot,Editor.Session.Document))Editor.Session.MarkSaved();Editor.Report("Exported "+name);
    }
    private async Task InsertImageAsync()
    {
        if(Editor.IsReadOnly)return;var top=TopLevel.GetTopLevel(this);if(top is null)return;
        var files=await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions{Title="Insert embedded image",AllowMultiple=false,FileTypeFilter=[new("Raster images"){Patterns=["*.png","*.jpg","*.jpeg","*.gif","*.webp"]}]});
        if(files.Count==0)return;var file=files[0];await using var stream=await file.OpenReadAsync();var bytes=await ReadBoundedAsync(stream,Editor.Session.Limits.MaxImageBytes);var dimensions=RasterImageInfo.Read(bytes);
        var mime=Path.GetExtension(file.Name).ToLowerInvariant() switch{".jpg" or ".jpeg"=>"jpeg",".gif"=>"gif",".webp"=>"webp",_=>"png"};var width=Math.Min(560,dimensions.Width);var height=(double)dimensions.Height*width/dimensions.Width;
        Editor.TryEdit(()=>Editor.Session.InsertImage("data:image/"+mime+";base64,"+Convert.ToBase64String(bytes),file.Name,width,Math.Min(4096,height)));Editor.FocusEditor();
    }
    private static async Task<byte[]> ReadBoundedAsync(Stream stream,int max)
    {
        using var output=new MemoryStream();var buffer=new byte[81920];int count;
        while((count=await stream.ReadAsync(buffer))>0){if(output.Length+count>max)throw new DocumentValidationException("File exceeds the configured size limit.");output.Write(buffer,0,count);}return output.ToArray();
    }
}
