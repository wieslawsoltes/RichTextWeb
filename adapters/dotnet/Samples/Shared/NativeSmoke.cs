using System.Text.Json;
using RichTextWeb;

internal static class NativeSmoke
{
    public static string? Argument(string[] args, string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    public static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    public static async Task RunAsync(RichTextDocumentClient client, Func<string, Task<string?>> script, List<string> checks)
    {
        client.RequestTimeout = TimeSpan.FromSeconds(45);
        await client.WaitUntilReadyAsync().WaitAsync(TimeSpan.FromSeconds(90));
        checks.Add("Native browser loaded packaged assets and completed the C# bridge handshake");
        await client.InsertTextAsync("Desktop text");
        Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Insert text");
        checks.Add("C# insertion changed the JavaScript document");
        await client.SelectAsync(0, 7); await client.ExecuteAsync("ToggleBold");
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Bold", StringComparison.OrdinalIgnoreCase), "Format selection");
        checks.Add("Selection and formatting passed through the real native transport");
        await client.InsertTextAsync("Native");
        await client.UndoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Undo");
        await client.RedoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Native text", "Redo");
        checks.Add("Undo and redo restored document text");
        var dom = await script("document.querySelector('rich-text-box').shadowRoot.querySelector('[part=editor]').textContent");
        Require(dom?.Contains("Native text") == true, "Native DOM output");
        checks.Add("The native browser rendered the edited document");
        Require(client.Document.HasValue && client.Revision > 0 && client.CanUndo, "MVVM state");
        checks.Add("C# MVVM document, revision and history state updated");
        await script("document.querySelector('rich-text-box').IsReadOnly=true");
        try { await client.InsertTextAsync("blocked"); throw new InvalidOperationException("Read-only edit succeeded"); }
        catch (RichTextBridgeException e) when (e.Code == "read_only") { }
        await script("document.querySelector('rich-text-box').IsReadOnly=false");
        checks.Add("Read-only policy rejected a native edit");
        try { await client.SetDocumentAsync(await client.GetDocumentAsync(), -1); throw new InvalidOperationException("Stale document accepted"); }
        catch (RichTextBridgeException e) when (e.Code == "revision_conflict") { }
        checks.Add("Stale revision replacement was rejected");
        int end = (await client.InvokeAsync("getText")).GetString()!.Length;
        await client.SelectAsync(end, end);
        await client.DocumentFeatureAsync("InsertField", new { type = "PAGE" });
        await client.DocumentFeatureAsync("UpdateFields", new { context = new { PageNumber = 3, PageCount = 5 } });
        Require((await client.InvokeAsync("getText")).GetString()!.EndsWith("3"), "Page field");
        await client.DocumentFeatureAsync("InsertNote", new { kind = "Footnote", content = "Native runtime qualification" });
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Native runtime qualification"), "Note");
        checks.Add("Fields and notes executed through the reusable document API");
        await client.ExecuteAsync("TrackChanges", true);
        await client.InsertTextAsync(" tracked");
        Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() > 0, "Tracked insertion");
        await client.ExecuteAsync("RejectAllRevisions");
        Require(!(await client.InvokeAsync("getText")).GetString()!.Contains(" tracked"), "Reject revision");
        checks.Add("Tracked insertion and rejection executed through native commands");
        await client.ExecuteAsync("TrackChanges", false);
        await client.ExecuteAsync("InsertEquation", new { Source = @"\frac{a}{b}", Format = "latex", DisplayMode = true });
        Require((await client.GetDocumentAsync()).GetRawText().Contains("EquationSource"), "Native equation insertion");
        var paths = await script("document.querySelector('rich-text-box').shadowRoot.querySelectorAll('[data-rt-type=Equation] svg path').length");
        Require(int.TryParse(paths?.Trim('"'), out int count) && count > 0, "Native vector equation rendering");
        checks.Add("Native equation command inserted an editable model node and rendered vector paths");


        await client.ExecuteAsync("TrackChanges", false);
        using var floating = JsonDocument.Parse("""
            {"type":"FlowDocument","id":"native-float-document","props":{},"children":[
              {"type":"Paragraph","id":"native-body","props":{},"children":[
                {"type":"Run","id":"native-before","props":{},"text":"Before "},
                {"type":"Figure","id":"native-figure","props":{"Width":180},"children":[
                  {"type":"Paragraph","id":"native-story","props":{},"children":[
                    {"type":"Run","id":"native-story-text","props":{},"text":"Original story"}]}]},
                {"type":"Run","id":"native-after","props":{},"text":" after"}]}]}
            """);
        await client.SetDocumentAsync(floating.RootElement);
        await client.SetElementPropertyAsync("native-figure", "Width", 220);
        await client.SetElementPropertyAsync("native-figure", "HorizontalAnchor", "ContentLeft");
        using var story = JsonDocument.Parse("""
            [{"type":"Paragraph","id":"native-rich-story","props":{},"children":[
              {"type":"Bold","id":"native-story-bold","props":{},"children":[
                {"type":"Run","id":"native-rich-text","props":{},"text":"Updated rich story"}]}]}]
            """);
        await client.EditFloatingContentAsync("native-figure", story.RootElement);
        var figure = (await client.GetDocumentAsync()).GetProperty("children")[0].GetProperty("children")[1];
        Require(figure.GetProperty("props").GetProperty("Width").GetInt32() == 220 &&
            figure.GetProperty("props").GetProperty("HorizontalAnchor").GetString() == "ContentLeft", "Floating layout properties");
        Require(figure.GetProperty("children")[0].GetProperty("children")[0].GetProperty("type").GetString() == "Bold" &&
            figure.GetRawText().Contains("Updated rich story", StringComparison.Ordinal), "Rich floating story replacement");
        Require((await client.InvokeAsync("getText")).GetString() == "Before \uFFFC after", "Atomic floating main-story offsets");
        await client.UndoAsync();
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Original story", StringComparison.Ordinal), "Undo floating story");
        await client.RedoAsync();
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Updated rich story", StringComparison.Ordinal), "Redo floating story");
        checks.Add("C# floating layout and rich-story wrappers preserved formatting, atomic main text and undo/redo");

        using var table = JsonDocument.Parse("""
            {"type":"FlowDocument","id":"native-table-document","props":{},"children":[
              {"type":"Paragraph","id":"native-first","props":{},"children":[{"type":"Run","id":"native-first-text","props":{},"text":"First block"}]},
              {"type":"Paragraph","id":"native-second","props":{},"children":[{"type":"Run","id":"native-second-text","props":{},"text":"Second block"}]},
              {"type":"Table","id":"native-table","props":{},"children":[
                {"type":"TableRowGroup","id":"native-group","props":{},"children":[
                  {"type":"TableRow","id":"native-row","props":{},"children":[
                    {"type":"TableCell","id":"native-left","props":{},"children":[{"type":"Paragraph","id":"native-left-paragraph","props":{},"children":[{"type":"Run","id":"native-left-text","props":{},"text":"Left cell"}]}]},
                    {"type":"TableCell","id":"native-right","props":{},"children":[{"type":"Paragraph","id":"native-right-paragraph","props":{},"children":[{"type":"Run","id":"native-right-text","props":{},"text":"Right cell"}]}]}]}]}]}]}
            """);
        await client.SetDocumentAsync(table.RootElement);
        await client.ExecuteAsync("TrackChanges", true);
        int cellStart = (await client.InvokeAsync("getText")).GetString()!.IndexOf("Left cell", StringComparison.Ordinal);
        Require(cellStart >= 0, "Locate table selection");
        await client.SelectAsync(cellStart, cellStart);
        await client.MergeTableCellsAsync(2);
        var cells = (await client.GetDocumentAsync()).GetProperty("children")[2].GetProperty("children")[0].GetProperty("children")[0].GetProperty("children");
        Require(cells.GetArrayLength() == 1 && cells[0].GetProperty("props").GetProperty("ColumnSpan").GetInt32() == 2, "Merged table geometry");
        Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() == 1, "Tracked native table merge");
        await client.ExecuteAsync("RejectAllRevisions");
        cells = (await client.GetDocumentAsync()).GetProperty("children")[2].GetProperty("children")[0].GetProperty("children")[0].GetProperty("children");
        Require(cells.GetArrayLength() == 2 && cells[1].GetProperty("id").GetString() == "native-right", "Reject merged table preserves cells");
        await client.MoveBlocksAsync(new[] { "native-first" }, "native-table-document", 3);
        Require((await client.GetDocumentAsync()).GetProperty("children")[2].GetProperty("id").GetString() == "native-first", "Move blocks preserves identity");
        Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() == 1, "Tracked native block move");
        await client.ExecuteAsync("RejectAllRevisions");
        Require((await client.GetDocumentAsync()).GetProperty("children")[0].GetProperty("id").GetString() == "native-first", "Reject block move restores order");
        await client.ExecuteAsync("TrackChanges", false);
        checks.Add("C# table merge and block-move wrappers recorded revisions and restored structure on rejection");
    }
    public static Task ReportAsync(string directory, string host, bool passed, List<string> checks, Exception? error = null)
    {
        Directory.CreateDirectory(directory);
        Console.WriteLine($"{(passed ? "PASS" : "FAIL")}: {checks.Count} real {host} checks");
        return File.WriteAllTextAsync(Path.Combine(directory, host + ".json"), JsonSerializer.Serialize(new
        {
            passed, checks, host, os = Environment.OSVersion.ToString(), dotnet = Environment.Version.ToString(),
            timestampUtc = DateTimeOffset.UtcNow, error = error?.ToString(),
            boundaries = new[] { "Programmatic native runtime and rendered output qualification", "Physical input devices, OS IMEs and screen readers need separate device testing" }
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
