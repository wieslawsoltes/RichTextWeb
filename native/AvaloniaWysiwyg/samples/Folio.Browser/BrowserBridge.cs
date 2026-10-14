using System.Collections.Immutable;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Styling;
using Avalonia.VisualTree;
using Folio.Sample;
using Wysiwyg.Core;
using Wysiwyg.Formats;
namespace Folio.Browser;
/// <summary>Opt-in sample test bridge. Production control packages contain no browser globals or test hooks.</summary>
public static partial class BrowserBridge
{
    private static MainView View=>MainView.Current??throw new InvalidOperationException("The sample is not ready.");
    private static void RequireAutomation(){if(!SampleServices.AutomationEnabled)throw new InvalidOperationException("Start the sample with ?automation=1 to enable its test bridge.");}
    [JSExport]public static string State()
    {
        RequireAutomation();var e=View.Editor;var s=e.Session;
        return JsonSerializer.Serialize(new{title=s.Document.Title,text=s.Index.Text,anchor=s.Selection.Anchor,focus=s.Selection.Focus,selection=s.Selection.Length,revision=s.Revision,undo=s.UndoCount,redo=s.RedoCount,dirty=s.IsDirty,readOnly=e.IsReadOnly,zoom=e.Zoom,bold=e.IsBold,italic=e.IsItalic,underline=e.IsUnderline,search=e.SearchText,searchStatus=e.SearchStatus,message=e.Message,selectedBlock=e.SelectedBlockId,theme=Application.Current?.ActualThemeVariant.ToString(),surfaceFocused=e.Surface?.IsFocused??false,cachedParagraphs=e.Surface?.CachedParagraphCount??0,formattedParagraphs=e.Surface?.FormattedParagraphCount??0,
            paragraphs=s.Index.Leaves.Select(l=>new{id=l.Paragraph.Id,text=l.Paragraph.Text,start=l.Start,row=l.Row,column=l.Column,heading=l.Paragraph.Style.HeadingLevel,list=l.Paragraph.Style.List.ToString(),check=l.Paragraph.Style.Checked,alignment=l.Paragraph.Style.Alignment.ToString(),rtl=l.Paragraph.Style.RightToLeft,runs=l.Paragraph.Runs.Select(r=>new{text=r.Text,bold=r.Style.Bold,italic=r.Style.Italic,underline=r.Style.Underline,strike=r.Style.Strike,fontSize=r.Style.FontSize,color=r.Style.Foreground,background=r.Style.Background,link=r.Style.Link})}),
            tables=s.Document.Blocks.OfType<TableBlock>().Select(t=>new{id=t.Id,rows=t.Rows.Length,columns=t.ColumnCount}),images=s.Document.Blocks.OfType<ImageBlock>().Select(i=>new{id=i.Id,width=i.Width,height=i.Height,alt=i.AltText}),comments=s.Document.Comments});
    }
    [JSExport]public static string Act(string action,string argument)
    {
        RequireAutomation();var e=View.Editor;
        switch(action)
        {
            case "loadText":e.Session.Load(RichDocument.FromText(argument));break;
            case "loadJson":e.Session.Load(DocumentFormats.FromJson(argument));break;
            case "loadHtml":e.Session.Load(DocumentFormats.FromHtml(argument).Document);break;
            case "sample":e.Session.Load(SampleDocument.Create());break;
            case "select":var positions=argument.Split(',').Select(int.Parse).ToArray();e.Session.SetSelection(positions[0],positions[1]);break;
            case "focus":e.FocusEditor();break;
            case "command":e.Execute(argument);break;
            case "readOnly":e.IsReadOnly=bool.Parse(argument);break;
            case "zoom":e.Zoom=double.Parse(argument,System.Globalization.CultureInfo.InvariantCulture);break;
            case "theme":View.SetDark(argument=="dark");break;
            case "json":return DocumentFormats.ToJson(e.Session.Document);
            case "html":return DocumentFormats.ToHtml(e.Session.Document);
            case "markdown":return DocumentFormats.ToMarkdown(e.Session.Document);
            case "large":var count=Math.Clamp(int.Parse(argument),1,10000);e.Session.Load(new RichDocument{Title="Large document",Blocks=Enumerable.Range(0,count).Select(i=>(Block)ParagraphBlock.Create($"Paragraph {i}: retained native text layout and viewport drawing.")).ToImmutableArray()});break;
            default:throw new ArgumentException("Unknown sample test action: "+action);
        }
        return State();
    }
    [JSExport]public static string Bounds(string name)
    {
        RequireAutomation();var control=View.GetVisualDescendants().OfType<Control>().FirstOrDefault(c=>c.Name==name);if(control is null)return "null";
        var top=TopLevel.GetTopLevel(View);var point=control.TranslatePoint(default,top!);if(point is null)return "null";
        return JsonSerializer.Serialize(new{x=point.Value.X,y=point.Value.Y,width=control.Bounds.Width,height=control.Bounds.Height,visible=control.IsEffectivelyVisible,enabled=control.IsEffectivelyEnabled});
    }
    [JSExport]public static string Caret(int position)
    {
        RequireAutomation();var surface=View.Editor.Surface;if(surface is null)return "null";var r=surface.GetCaretRectangle(position);var p=surface.TranslatePoint(r.Position,TopLevel.GetTopLevel(View)!);if(p is null)return "null";
        return JsonSerializer.Serialize(new{x=p.Value.X,y=p.Value.Y,width=r.Width,height=r.Height});
    }
    [JSExport]public static string ObjectBounds(string id)
    {
        RequireAutomation();var surface=View.Editor.Surface;if(surface?.GetObjectRectangle(id) is not { } r)return "null";var p=surface.TranslatePoint(r.Position,TopLevel.GetTopLevel(View)!);if(p is null)return "null";
        return JsonSerializer.Serialize(new{x=p.Value.X,y=p.Value.Y,width=r.Width,height=r.Height});
    }
}
