using Avalonia;
using Folio.Sample;
namespace Folio.Desktop;
internal static class Program
{
    [STAThread] public static void Main(string[] args)
    {
        var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FolioStudio");var path=Path.Combine(folder,"draft.folio");
        SampleServices.ReadDraft=()=>File.Exists(path)?File.ReadAllText(path):null;
        SampleServices.WriteDraft=text=>{Directory.CreateDirectory(folder);var temporary=path+".tmp";File.WriteAllText(temporary,text);File.Move(temporary,path,true);};
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }
    public static AppBuilder BuildAvaloniaApp()=>AppBuilder.Configure<App>().UsePlatformDetect().WithInterFont().LogToTrace();
}
