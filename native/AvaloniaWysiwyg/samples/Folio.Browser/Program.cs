using System.Runtime.InteropServices.JavaScript;
using Avalonia;
using Avalonia.Browser;
using Folio.Sample;
namespace Folio.Browser;
internal static partial class Program
{
    private static Task Main(string[] args)
    {
        SampleServices.AutomationEnabled=IsAutomation();SampleServices.ReadDraft=ReadDraft;SampleServices.WriteDraft=WriteDraft;SampleServices.Ready=Ready;
        SampleServices.DownloadText=(name,text)=>{Download(name,text);return Task.CompletedTask;};
        return AppBuilder.Configure<App>().WithInterFont().StartBrowserAppAsync("out");
    }
    [JSImport("readDraft","folio-host")]internal static partial string? ReadDraft();
    [JSImport("writeDraft","folio-host")]internal static partial void WriteDraft(string text);
    [JSImport("download","folio-host")]internal static partial void Download(string name,string text);
    [JSImport("ready","folio-host")]internal static partial void Ready();
    [JSImport("isAutomation","folio-host")]internal static partial bool IsAutomation();
}
