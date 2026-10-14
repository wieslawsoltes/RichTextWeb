using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
namespace Folio.Sample;
public partial class App:Application
{
    public override void Initialize()=>AvaloniaXamlLoader.Load(this);
    public override void OnFrameworkInitializationCompleted()
    {
        var view=new MainView();
        if(ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)desktop.MainWindow=new Window {Title="Folio Studio — Avalonia WYSIWYG",Width=1480,Height=960,MinWidth=760,MinHeight=560,Content=view};
        else if(ApplicationLifetime is ISingleViewApplicationLifetime single)single.MainView=view;
        base.OnFrameworkInitializationCompleted();
    }
}
