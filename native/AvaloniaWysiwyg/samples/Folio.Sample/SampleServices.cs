namespace Folio.Sample;
/// <summary>Host capabilities are injected; the control library itself performs no storage or network I/O.</summary>
public static class SampleServices
{
    public static Func<string?>? ReadDraft {get;set;}
    public static Action<string>? WriteDraft {get;set;}
    public static Func<string,string,Task>? DownloadText {get;set;}
    public static Action? Ready {get;set;}
    public static bool AutomationEnabled {get;set;}
}
