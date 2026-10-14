using System.Collections.Immutable;
using System.Diagnostics;
using Wysiwyg.Core;

var tests = new List<(string Name, Action Run)>();
void Test(string name, Action action) => tests.Add((name, action));
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}; got {actual}"); }
void True(bool value) { if (!value) throw new Exception("Expected true"); }
void Throws(Action action) { try { action(); } catch (ArgumentException) { return; } throw new Exception("Expected an argument/validation exception"); }
EditorSession Session(string text = "") => new(RichDocument.FromText(text));
Test("Insertion, selection replacement and undo", () => { var e = Session("alpha beta"); e.SetSelection(6, 10); e.InsertText("gamma", false); Equal("alpha gamma", e.Index.Text); e.Undo(); Equal("alpha beta", e.Index.Text); Equal(new EditorSelection(6,10), e.Selection); e.Redo(); Equal("alpha gamma", e.Index.Text); });
Test("Paragraph split and join preserve suffix", () => { var e = Session("abcdef"); e.MoveCaret(3); e.Enter(); Equal("abc\ndef", e.Index.Text); e.DeleteBackward(); Equal("abcdef", e.Index.Text); });
Test("Cross-paragraph deletion merges surviving runs", () => { var e = Session("alpha\nbeta\ngamma"); e.SetSelection(2,13); e.InsertText("X", false); Equal("alXmma", e.Index.Text); e.Undo(); Equal(3,e.Document.Blocks.Length); });
Test("Run formatting splits and normalizes", () => { var e = Session("abcdef"); e.SetSelection(1,5); e.ToggleBold(); var p = (ParagraphBlock)e.Document.Blocks[0]; Equal(3,p.Runs.Length); True(p.Runs[1].Style.Bold); e.ToggleBold(); Equal(1,((ParagraphBlock)e.Document.Blocks[0]).Runs.Length); });
Test("Mixed formatting reports indeterminate", () => { var e = Session("abcdef"); e.SetSelection(1,3); e.ToggleBold(); e.SelectAll(); Equal<bool?>(null,e.GetFormatting().Bold); e.ToggleBold(); Equal<bool?>(true,e.GetFormatting().Bold); });
Test("Typing style does not dirty the document", () => { var e = Session(); e.ToggleItalic(); True(!e.IsDirty); e.InsertText("x"); True(((ParagraphBlock)e.Document.Blocks[0]).Runs[0].Style.Italic); });
Test("Typing coalesces into one undo transaction", () => { var e = Session(); e.InsertText("a"); e.InsertText("b"); e.InsertText("c"); Equal(1,e.UndoCount); e.Undo(); Equal("",e.Index.Text); });
Test("Navigation breaks typing coalescence", () => { var e = Session(); e.InsertText("a"); e.MoveCaret(0); e.MoveCaret(1); e.InsertText("b"); Equal(2,e.UndoCount); });
Test("Save barrier and undo dirty state", () => { var e = Session(); e.InsertText("a"); e.MarkSaved(); e.InsertText("b"); e.Undo(); True(!e.IsDirty); Equal("a",e.Index.Text); });
Test("History count limit", () => { var e = Session(); e.HistoryLimit=3; for(var i=0;i<10;i++)e.InsertText("x",false); Equal(3,e.UndoCount); });
Test("Read-only gates mutation and history", () => { var e = Session("abc"); e.InsertText("x"); e.IsReadOnly=true; True(!e.InsertText("y")); True(!e.ToggleBold()); True(!e.Undo()); e.SelectAll(); Equal("xabc",e.SelectedText); });
Test("UTF16 surrogate deletion is atomic", () => { var e = Session("A😀B"); e.MoveCaret(3); e.DeleteBackward(); Equal("AB",e.Index.Text); e.Undo(); Equal("A😀B",e.Index.Text); });
Test("Combining sequence deletion is atomic", () => { var e = Session("e\u0301x"); e.MoveCaret(2); e.DeleteBackward(); Equal("x",e.Index.Text); });
Test("ZWJ family deletion is atomic", () => { var e = Session("👨‍👩‍👧‍👦x"); e.MoveCaret(e.Index.Length-1); e.DeleteBackward(); Equal("x",e.Index.Text); });
Test("Selection snaps to grapheme boundaries", () => { var e = Session("A😀B"); e.SetSelection(2,3); Equal(new EditorSelection(1,3),e.Selection); });
Test("Unicode word navigation", () => { var e = Session("żółw alpha beta"); e.MoveCaret(e.Index.Length); Equal(11,e.PreviousPosition(true)); e.MoveCaret(0); Equal(5,e.NextPosition(true)); });
Test("Newlines normalize", () => { var e = Session(); e.InsertText("a\r\nb\rc"); Equal("a\nb\nc",e.Index.Text); });
Test("Heading enter becomes body", () => { var e = Session("Heading"); e.SetHeading(1); e.MoveCaret(7); e.Enter(); Equal(0,((ParagraphBlock)e.Document.Blocks[1]).Style.HeadingLevel); });
Test("Empty list enter exits list", () => { var e = Session(); e.ToggleList(ListKind.Bullet); e.Enter(); Equal(ListKind.None,((ParagraphBlock)e.Document.Blocks[0]).Style.List); Equal(1,e.Document.Blocks.Length); });
Test("Soft break stays in paragraph", () => { var e = Session("ab"); e.MoveCaret(1); e.Enter(true); Equal("a\u2028b",e.Index.Text); Equal(1,e.Document.Blocks.Length); });
Test("Paragraph formatting excludes following endpoint", () => { var e = Session("a\nb"); e.SetSelection(0,2); e.SetHeading(2); Equal(0,((ParagraphBlock)e.Document.Blocks[1]).Style.HeadingLevel); });
Test("Table insertion and rectangular editing", () => { var e = Session(); e.InsertTable(2,2); Equal(2,e.CurrentTable!.ColumnCount); e.AddTableRow(); Equal(3,e.CurrentTable!.Rows.Length); e.AddTableColumn(); Equal(3,e.CurrentTable!.ColumnCount); e.RemoveTableColumn(); e.RemoveTableRow(); Equal(2,e.CurrentTable!.Rows.Length); DocumentValidation.Validate(e.Document); });
Test("Table Enter creates soft break", () => { var e = Session(); e.InsertTable(1,2); e.InsertText("a"); e.Enter(); e.InsertText("b"); Equal("a\u2028b",e.CurrentTable!.Rows[0].Cells[0].Content.Text); });
Test("Tab at last cell appends row", () => { var e = Session(); e.InsertTable(1,1); e.NavigateTable(); Equal(2,e.CurrentTable!.Rows.Length); Equal(1,e.Index.At(e.Selection.Focus).Row); });
Test("Deleting last row removes table safely", () => { var e = Session(); e.InsertTable(1,1); e.RemoveTableRow(); True(!e.Document.Blocks.OfType<TableBlock>().Any()); DocumentValidation.Validate(e.Document); });
Test("Cross-cell deletion preserves grid", () => { var e = Session(); e.InsertTable(1,2); e.InsertText("abc"); e.NavigateTable(); e.InsertText("xyz"); var cells=e.Index.Leaves.Where(l=>l.IsCell).ToArray(); e.SetSelection(cells[0].Start+1,cells[1].End-1); e.InsertText("",false); Equal(2,e.Document.Blocks.OfType<TableBlock>().Single().ColumnCount); Equal("a",((TableBlock)e.Document.Blocks[1]).Rows[0].Cells[0].Content.Text); Equal("z",((TableBlock)e.Document.Blocks[1]).Rows[0].Cells[1].Content.Text); });
Test("Comment shifts on insertion before anchor", () => { var e = Session("alpha beta"); e.SetSelection(6,10); e.AddComment("Check this"); e.MoveCaret(0); e.InsertText("NEW "); Equal(new TextRange(10,4),e.Document.Comments[0].Range); e.Undo(); Equal(new TextRange(6,4),e.Document.Comments[0].Range); });
Test("Deleted comment range is orphaned", () => { var e = Session("abc def"); e.SetSelection(4,7); e.AddComment("Review"); e.InsertText("",false); True(e.Document.Comments[0].Orphaned); Equal(0,e.Document.Comments[0].Range.Length); });
Test("Comment resolve is undoable", () => { var e = Session("x"); e.AddComment("Review"); e.ResolveComment(e.Document.Comments[0].Id); True(e.Document.Comments[0].Resolved); e.Undo(); True(!e.Document.Comments[0].Resolved); });
Test("Case and whole-word search", () => { var e = Session("Alpha alpha alphabet"); Equal(3,e.Find("alpha").Length); Equal(1,e.Find("alpha",new(true,true)).Length); });
Test("Find wraps", () => { var e = Session("a b a"); e.MoveCaret(5); Equal(0,e.FindNext("a")!.Range.Start); });
Test("Replace all is one undo step", () => { var e = Session("red red red"); Equal(3,e.ReplaceAll("red","blue")); Equal("blue blue blue",e.Index.Text); Equal(1,e.UndoCount); e.Undo(); Equal("red red red",e.Index.Text); });
Test("Regex replacement is literal", () => { var e = Session("a1 a2"); e.ReplaceAll(@"a\d","$1",new(UseRegex:true)); Equal("$1 $1",e.Index.Text); });
Test("Zero-width regex does not edit", () => { var e = Session("abc"); Equal(0,e.ReplaceAll("^","x",new(UseRegex:true))); });
Test("Invalid regex fails atomically", () => { var e = Session("abc"); Throws(()=>e.ReplaceAll("[","x",new(UseRegex:true))); Equal("abc",e.Index.Text); });
Test("Rich clipboard preserves inline formatting", () => { var e = Session("bold"); e.SelectAll(); e.ToggleBold(); var fragment=e.CopySelection(); var target=Session("xy"); target.MoveCaret(1); target.InsertFragment(fragment); Equal("xboldy",target.Index.Text); True(((ParagraphBlock)target.Document.Blocks[0]).Runs[1].Style.Bold); });
Test("Fragment IDs are regenerated", () => { var e = Session(); var fragment=RichDocument.FromText("a\nb"); e.InsertFragment(fragment); e.InsertFragment(fragment); DocumentValidation.Validate(e.Document); });
Test("Duplicate IDs rejected", () => { var p=ParagraphBlock.Create("a"); Throws(()=>DocumentValidation.Validate(new RichDocument {Blocks=[p,p]})); });
Test("Unknown schema rejected", () => Throws(()=>new EditorSession(RichDocument.Empty() with {SchemaVersion=99})));
Test("Invalid hyperlink protocols rejected", () => { var e=Session("abc"); e.SelectAll(); Throws(()=>e.SetLink("javascript:alert(1)")); Throws(()=>e.SetLink("file:///etc/passwd")); True(e.SetLink("https://example.com")); });
Test("Invalid colors and font sizes rejected", () => { var e=Session("a"); Throws(()=>e.ApplyTextStyle(s=>s with {Foreground="red;url(x)"})); Throws(()=>e.ApplyTextStyle(s=>s with {FontSize=double.NaN})); });
Test("Text limits reject edits without mutation", () => { var e=new EditorSession(RichDocument.FromText("abc"),new DocumentLimits {MaxCharacters=5}); e.MoveCaret(3); Throws(()=>e.InsertText("xyz")); Equal("abc",e.Index.Text); Equal(0,e.UndoCount); });
Test("Remote and SVG images rejected", () => { var e=Session(); Throws(()=>e.InsertImage("https://example.com/x.png","x")); Throws(()=>e.InsertImage("data:image/svg+xml;base64,PHN2Zy8+","x")); });
Test("Invalid raster signatures rejected", () => Throws(()=>EmbeddedImage.Validate("data:image/png;base64,AAAAAAAAAAAAAAAAAAAA")));
Test("Deterministic randomized editing invariants: 1000 operations", () =>
{
    var e=Session("seed"); var random=new Random(42);
    for(var i=0;i<1000;i++)
    {
        var p=random.Next(e.Index.Length+1); e.MoveCaret(p);
        switch(random.Next(7)) { case 0:e.InsertText("x",false);break;case 1:e.Enter();break;case 2:e.DeleteBackward();break;case 3:e.DeleteForward();break;case 4:e.ToggleBold();break;case 5:e.Undo();break;case 6:e.Redo();break; }
        DocumentValidation.Validate(e.Document); True(e.Selection.Focus>=0 && e.Selection.Focus<=e.Index.Length);
    }
});
Test("Ten-thousand-paragraph index and localized edit", () =>
{
    var doc=new RichDocument {Blocks=Enumerable.Range(0,10000).Select(i=>(Block)ParagraphBlock.Create($"Paragraph {i}")).ToImmutableArray()};
    var watch=Stopwatch.StartNew(); var e=new EditorSession(doc); e.MoveCaret(e.Index.Length); e.InsertText("!",false);
    Equal(10000,e.Document.Blocks.Length); True(e.Index.Text.EndsWith("!")); Console.WriteLine($"METRIC 10000-paragraph construct/edit: {watch.ElapsedMilliseconds} ms");
});

var failed=0;var started=Stopwatch.StartNew();
foreach(var (name,run) in tests) { try {run();Console.WriteLine($"PASS {name}");} catch(Exception ex){failed++;Console.WriteLine($"FAIL {name}: {ex}");} }
Console.WriteLine($"RESULT {tests.Count-failed}/{tests.Count} tests passed in {started.ElapsedMilliseconds} ms");
return failed==0?0:1;
