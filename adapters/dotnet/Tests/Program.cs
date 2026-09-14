using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using RichTextWeb;

internal static class Program
{
    private static int _passed;
    public static async Task<int> Main(string[] args)
    {
        try
        {
            await Run("correlated concurrent responses", Correlation);
            await Run("remote errors and malformed responses", Errors);
            await Run("timeouts and cancellation", Cancellation);
            await Run("disposal cancels pending requests", Disposal);
            await Run("ready and MVVM state notifications", Notifications);
            await Run("invalid and oversized envelopes", Validation);
            await Run("loopback assets and path confinement", AssetServer);
            await Run("C# to real JavaScript engine integration", () => NodeEngine(args.FirstOrDefault()));
            Console.WriteLine($"PASS: {_passed} desktop bridge checks");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static async Task Run(string name, Func<Task> action) { await action(); _passed++; Console.WriteLine($"PASS: {name}"); }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static async Task<TException> Throws<TException>(Task task) where TException : Exception
    {
        try { await task; } catch (TException error) { return error; }
        throw new InvalidOperationException($"Expected {typeof(TException).Name}");
    }
    private static string Response(string id, object result) => JsonSerializer.Serialize(new { channel = "richtextweb", version = 1, kind = "response", id, result });
    private static string RemoteError(string id, string code) => JsonSerializer.Serialize(new { channel = "richtextweb", version = 1, kind = "response", id, error = new { code, message = "test failure" } });
    private static string Event(string name, object payload) => JsonSerializer.Serialize(new { channel = "richtextweb", version = 1, kind = "event", @event = name, payload });
    private static string Id(string json) { using var doc = JsonDocument.Parse(json); return doc.RootElement.GetProperty("id").GetString()!; }

    private static async Task AssetServer()
    {
        string temp = Path.Combine(Path.GetTempPath(), "richtextweb-assets-" + Guid.NewGuid());
        string assets = Path.Combine(temp, "web"); Directory.CreateDirectory(assets);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(assets, "editor.html"), "<h1>Editor</h1>");
            await File.WriteAllTextAsync(Path.Combine(assets, "worker.mjs"), "export const worker = true;");
            await File.WriteAllTextAsync(Path.Combine(temp, "private.txt"), "outside assets");
            using var server = new LocalAssetServer(assets);
            using var http = new HttpClient { BaseAddress = server.BaseUri, Timeout = TimeSpan.FromSeconds(5) };
            Assert(server.BaseUri.Host == "127.0.0.1", "Server must bind loopback");
            Assert((await http.GetStringAsync(server.EditorUri)).Contains("Editor"), "Editor delivery");
            using var module = await http.GetAsync("worker.mjs");
            Assert(module.Content.Headers.ContentType?.MediaType == "text/javascript", "ES module MIME");
            using var missing = await http.GetAsync("missing.txt"); Assert((int)missing.StatusCode == 404, "Missing asset");
            using var traversal = await http.GetAsync("..%2fprivate.txt"); Assert((int)traversal.StatusCode == 404, "Path escape");
            using var mutation = await http.PostAsync("editor.html", new StringContent("replace")); Assert((int)mutation.StatusCode == 405, "Read-only server");
            var concurrent = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => http.GetStringAsync("editor.html")));
            Assert(concurrent.All(value => value.Contains("Editor")), "Concurrent asset requests");
        }
        finally { Directory.Delete(temp, true); }
    }

    private static async Task Correlation()
    {
        using var transport = new FakeTransport(); using var client = new RichTextDocumentClient(transport);
        var first = client.GetDocumentAsync(); var second = client.InvokeAsync("getText");
        Assert(transport.Sent.Count == 2, "Requests were not sent");
        transport.Emit(Response(Id(transport.Sent[1]), "second"));
        transport.Emit(Response(Id(transport.Sent[0]), new { type = "FlowDocument" }));
        Assert((await second).GetString() == "second", "Out-of-order response misrouted");
        Assert((await first).GetProperty("type").GetString() == "FlowDocument", "Document response misrouted");
    }
    private static async Task Errors()
    {
        using var transport = new FakeTransport(); using var client = new RichTextDocumentClient(transport);
        var pending = client.InsertTextAsync("x"); transport.Emit(RemoteError(Id(transport.Sent[^1]), "read_only"));
        Assert((await Throws<RichTextBridgeException>(pending)).Code == "read_only", "Error code was lost");
        pending = client.GetDocumentAsync();
        transport.Emit(JsonSerializer.Serialize(new { channel = "richtextweb", version = 1, kind = "response", id = Id(transport.Sent[^1]) }));
        Assert((await Throws<RichTextBridgeException>(pending)).Code == "invalid_response", "Malformed response should reject immediately");
    }
    private static async Task Cancellation()
    {
        using var transport = new FakeTransport(); using var client = new RichTextDocumentClient(transport) { RequestTimeout = TimeSpan.FromMilliseconds(40) };
        await Throws<TimeoutException>(client.InvokeAsync("getText"));
        using var cancellation = new CancellationTokenSource();
        var request = client.InvokeAsync("getText", cancellationToken: cancellation.Token); cancellation.Cancel();
        await Throws<OperationCanceledException>(request);
        // Late replies must not revive timed-out or cancelled requests.
        foreach (var sent in transport.Sent) transport.Emit(Response(Id(sent), "late"));
    }
    private static async Task Disposal()
    {
        var transport = new FakeTransport(); var client = new RichTextDocumentClient(transport);
        var request = client.InvokeAsync("getText"); var ready = client.WaitUntilReadyAsync();
        client.Dispose(); client.Dispose();
        await Throws<OperationCanceledException>(request); await Throws<OperationCanceledException>(ready);
        Assert(transport.Disposed, "Transport ownership was not released");
        await Throws<ObjectDisposedException>(client.GetDocumentAsync());
    }
    private static async Task Notifications()
    {
        using var transport = new FakeTransport(); using var client = new RichTextDocumentClient(transport);
        var changed = new List<string>(); client.PropertyChanged += (_, e) => changed.Add(e.PropertyName!);
        transport.Emit(Event("ready", new { revision = 4, canUndo = false, canRedo = false }));
        await client.WaitUntilReadyAsync();
        transport.Emit(Event("documentChanged", new { revision = 5, canUndo = true, canRedo = false, document = new { type = "FlowDocument", id = "doc", props = new { }, children = Array.Empty<object>() } }));
        Assert(client.Revision == 5 && client.CanUndo && !client.CanRedo, "Native MVVM state did not update");
        Assert(client.Document?.GetProperty("id").GetString() == "doc", "Document snapshot lifetime was not retained");
        Assert(changed.Contains(nameof(client.Document)) && changed.Contains(nameof(client.Revision)), "Property notifications missing");
    }
    private static Task Validation()
    {
        using var transport = new FakeTransport(); using var client = new RichTextDocumentClient(transport) { MaximumIncomingMessageLength = 256 };
        var errors = new List<Exception>(); client.ProtocolError += errors.Add;
        transport.Emit("not JSON"); transport.Emit(new string('x', 300)); transport.Emit("{\"channel\":\"other\",\"version\":1}");
        transport.Emit(Event("documentChanged", new { revision = "not-a-number" }));
        Assert(errors.Count == 4, "Malformed messages should be reported without crashing the host");
        return Task.CompletedTask;
    }
    private static async Task NodeEngine(string? repository)
    {
        string root = Path.GetFullPath(repository ?? Environment.CurrentDirectory);
        string script = Path.Combine(root, "adapters", "dotnet", "Tests", "node-host.mjs");
        if (!File.Exists(script)) throw new FileNotFoundException("Run from the repository root or pass that path as the first argument", script);
        using var transport = new NodeTransport(script, root);
        using var client = new RichTextDocumentClient(transport);
        transport.Start(); await client.WaitUntilReadyAsync();
        Assert((await client.InvokeAsync("getText")).GetString() == "Native bridge document", "Real engine startup failed");
        await client.SelectAsync(0, 6); await client.InsertTextAsync("Shared");
        Assert((await client.InvokeAsync("getText")).GetString() == "Shared bridge document", "C# insert did not change the JS engine");
        await client.UndoAsync(); Assert((await client.InvokeAsync("getText")).GetString() == "Native bridge document", "Native undo failed");
        await client.RedoAsync(); Assert((await client.InvokeAsync("getText")).GetString() == "Shared bridge document", "Native redo failed");
        await client.SelectAsync(0, 6); await client.ExecuteAsync("ToggleBold");
        var document = await client.GetDocumentAsync();
        Assert(document.GetRawText().Contains("Bold", StringComparison.OrdinalIgnoreCase), "Formatting did not reach the shared model");
        var stale = client.SetDocumentAsync(document, -1);
        Assert((await Throws<RichTextBridgeException>(stale)).Code == "revision_conflict", "Stale replacement was not rejected");
        Assert(client.Document.HasValue && client.Revision > 0, "JS changes did not update native MVVM snapshots");
        await client.DocumentFeatureAsync("InsertField", new { type = "MERGEFIELD", argument = "Name" });
        var merged = await client.DocumentFeatureAsync("MailMerge", new { records = new[] { new { Name = "Ada" }, new { Name = "Lin" } } });
        Assert(merged.GetArrayLength() == 2 && merged[0].GetRawText().Contains("Ada"), "Native mail merge failed");
        var note = await client.DocumentFeatureAsync("InsertNote", new { kind = "Footnote", content = "Native footnote" });
        string noteId = note.GetProperty("id").GetString()!;
        await client.DocumentFeatureAsync("UpdateNote", new { kind = "Footnote", id = noteId, content = "Updated native footnote" });
        Assert((await client.GetDocumentAsync()).GetRawText().Contains("Updated native footnote"), "Native note update failed");
        await client.DocumentFeatureAsync("UpdateFields", new { context = new { Data = new { Name = "Grace" }, Now = "2026-09-13T12:00:00Z" } });
        Assert((await client.InvokeAsync("getText")).GetString()!.Contains("Grace"), "Native field update failed");
        var review = await client.GetReviewStateAsync();
        Assert(review.GetProperty("revisions").ValueKind == JsonValueKind.Array, "Native review state was not exposed");
        await client.ExecuteAsync("CurrentAuthor", "Native test author");
        await client.ExecuteAsync("TrackChanges", true);
        await client.InsertTextAsync(" tracked insertion");
        review = await client.GetReviewStateAsync();
        Assert(review.GetProperty("trackChanges").GetBoolean() && review.GetProperty("currentAuthor").GetString() == "Native test author" && review.GetProperty("revisions").GetArrayLength() > 0, "Native change tracking did not record the edit");
        await client.ExecuteAsync("RejectAllRevisions");
        Assert(!(await client.InvokeAsync("getText")).GetString()!.Contains("tracked insertion"), "Native revision rejection did not remove tracked text");
        await client.ExecuteAsync("TrackChanges", false);
        await client.ExecuteAsync("InsertEquation", new { Source = @"\frac{a}{b}", Format = "latex", DisplayMode = true });
        var mathDocument = await client.GetDocumentAsync();
        Assert(mathDocument.GetRawText().Contains("EquationSource"), "Native equation command did not reach the engine");
        await client.SetDocumentAsync(mathDocument);
        Assert((await client.GetDocumentAsync()).GetRawText().Contains("EquationSource"), "Native equation JSON did not round-trip");

    }
    private sealed class FakeTransport : IRichTextTransport
    {
        public event Action<string>? MessageReceived;
        public List<string> Sent { get; } = [];
        public bool Disposed { get; private set; }
        public Task SendAsync(string json, CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Sent.Add(json); return Task.CompletedTask; }
        public void Emit(string json) => MessageReceived?.Invoke(json);
        public void Dispose() { Disposed = true; }
    }
    private sealed class NodeTransport(string script, string directory) : IRichTextTransport
    {
        private readonly Process _process = new() { StartInfo = new ProcessStartInfo("node") { WorkingDirectory = directory, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false } };
        private readonly SemaphoreSlim _write = new(1, 1);
        public event Action<string>? MessageReceived;
        public void Start()
        {
            _process.StartInfo.ArgumentList.Add(script);
            _process.OutputDataReceived += (_, args) => { if (args.Data is not null) MessageReceived?.Invoke(args.Data); };
            _process.ErrorDataReceived += (_, args) => { if (args.Data is not null) Console.Error.WriteLine(args.Data); };
            _process.Start(); _process.BeginOutputReadLine(); _process.BeginErrorReadLine();
        }
        public async Task SendAsync(string json, CancellationToken cancellationToken = default)
        {
            await _write.WaitAsync(cancellationToken);
            try { await _process.StandardInput.WriteLineAsync(json.AsMemory(), cancellationToken); await _process.StandardInput.FlushAsync(cancellationToken); }
            finally { _write.Release(); }
        }
        public void Dispose()
        {
            try { if (!_process.HasExited) { _process.StandardInput.Close(); if (!_process.WaitForExit(1500)) _process.Kill(true); } } catch (InvalidOperationException) { }
            _process.Dispose();
        }
    }
}
