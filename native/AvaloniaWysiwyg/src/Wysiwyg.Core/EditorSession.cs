using System.Collections.Immutable;
namespace Wysiwyg.Core;
public sealed record DocumentChangedEventArgs(RichDocument Before, RichDocument After, string Operation, long Revision);
public sealed record FormattingSummary(bool? Bold, bool? Italic, bool? Underline, bool? Strike, string? FontFamily, double? FontSize, string? Foreground, string? Background, string? Link);
/// <summary>Single-owner editing session; immutable document snapshots can be shared. Failed edits are atomic.</summary>
public sealed partial class EditorSession
{
    private sealed record HistoryEntry(RichDocument Before, RichDocument After, EditorSelection BeforeSelection, EditorSelection AfterSelection, TextStyle BeforeStyle, TextStyle AfterStyle, string Label, int Epoch, DateTimeOffset Time, long Cost);
    private readonly List<HistoryEntry> _undo = []; private readonly List<HistoryEntry> _redo = [];
    private RichDocument _saved; private bool _readOnly; private int _epoch; private bool _pendingStyle;
    public DocumentLimits Limits { get; }
    public RichDocument Document { get; private set; }
    public DocumentIndex Index { get; private set; }
    public EditorSelection Selection { get; private set; }
    public TextStyle TypingStyle { get; private set; } = TextStyle.Default;
    public long Revision { get; private set; }
    public int HistoryLimit { get; set; } = 200;
    public long HistoryByteLimit { get; set; } = 32 * 1024 * 1024;
    public bool IsReadOnly { get => _readOnly; set { if (_readOnly == value) return; _readOnly = value; _epoch++; StateChanged?.Invoke(this, EventArgs.Empty); } }
    public bool CanUndo => !IsReadOnly && _undo.Count > 0;
    public bool CanRedo => !IsReadOnly && _redo.Count > 0;
    public int UndoCount => _undo.Count;
    public int RedoCount => _redo.Count;
    public bool IsDirty => !ReferenceEquals(Document, _saved);
    public string SelectedText => Selection.IsEmpty ? "" : Index.Text.Substring(Selection.Start, Selection.Length);
    public int WordCount => Index.Leaves.Sum(l => ParagraphMetrics.Get(l.Paragraph).Words);
    public int CharacterCount => Index.Leaves.Sum(l => l.Paragraph.Length);
    public event EventHandler<DocumentChangedEventArgs>? DocumentChanged;
    public event EventHandler? SelectionChanged;
    public event EventHandler? StateChanged;
    public EditorSession(RichDocument? document = null, DocumentLimits? limits = null)
    { Limits = limits ?? DocumentLimits.Default; Document = DocumentValidation.Validate(document ?? RichDocument.Empty(), Limits); _saved = Document; Index = new(Document); }
    public void Load(RichDocument document)
    {
        document = DocumentValidation.Validate(document, Limits); var before = Document;
        Document = document; Index = new(document); Selection = default; TypingStyle = TextStyle.Default; _pendingStyle = false;
        _undo.Clear(); _redo.Clear(); _saved = document; _epoch++; Revision++;
        DocumentChanged?.Invoke(this, new(before, document, "Load", Revision)); SelectionChanged?.Invoke(this, EventArgs.Empty); StateChanged?.Invoke(this, EventArgs.Empty);
    }
    public void MarkSaved() { _saved = Document; _epoch++; StateChanged?.Invoke(this, EventArgs.Empty); }
    public void SetSelection(int anchor, int focus)
    {
        var next = new EditorSelection(Snap(anchor, anchor > focus), Snap(focus, focus > anchor));
        var oldStyle = TypingStyle; _epoch++; _pendingStyle = false;
        var old = Selection; Selection = next; UpdateTypingStyle();
        if (next == old && oldStyle == TypingStyle) return;
        SelectionChanged?.Invoke(this, EventArgs.Empty); StateChanged?.Invoke(this, EventArgs.Empty);
    }
    private int Snap(int position, bool forward = false)
    { position = Math.Clamp(position, 0, Index.Length); var leaf = Index.At(position); return leaf.Start + TextUtilities.Snap(leaf.Paragraph.Text, position - leaf.Start, forward); }
    public void MoveCaret(int position, bool extend = false) => SetSelection(extend ? Selection.Anchor : position, position);
    public void SelectAll() => SetSelection(0, Index.Length);
    public void SelectWord(int position)
    { var leaf = Index.At(position); var word = TextUtilities.WordAt(leaf.Paragraph.Text, position - leaf.Start); SetSelection(leaf.Start + word.Start, leaf.Start + word.End); }
    public void SelectParagraph(int position) { var leaf = Index.At(position); SetSelection(leaf.Start, leaf.End); }
    public int PreviousPosition(bool word = false)
    {
        var leaf = Index.At(Selection.Focus); var p = Selection.Focus - leaf.Start;
        if (p == 0) return Math.Max(0, leaf.Start - 1);
        return leaf.Start + (word ? TextUtilities.PreviousWord(leaf.Paragraph.Text, p) : TextUtilities.Previous(leaf.Paragraph.Text, p));
    }
    public int NextPosition(bool word = false)
    {
        var leaf = Index.At(Selection.Focus); var p = Selection.Focus - leaf.Start;
        if (p == leaf.Paragraph.Length) return Math.Min(Index.Length, leaf.End + 1);
        return leaf.Start + (word ? TextUtilities.NextWord(leaf.Paragraph.Text, p) : TextUtilities.Next(leaf.Paragraph.Text, p));
    }
    public bool InsertText(string text, bool coalesce = true)
    {
        if (IsReadOnly || string.IsNullOrEmpty(text) && Selection.IsEmpty) return false;
        return Apply(coalesce && !text.Contains('\n') && Selection.IsEmpty ? "Typing" : "Insert text", DocumentEditing.Replace(Document, Selection, text, TypingStyle));
    }
    public bool Enter(bool softBreak = false)
    {
        if (IsReadOnly) return false; var leaf = Index.At(Selection.Focus);
        if (!softBreak && Selection.IsEmpty && leaf.Paragraph.Length == 0 && leaf.Paragraph.Style.List != ListKind.None) return FormatParagraph(p => p with { List = ListKind.None, Indent = Math.Max(0, p.Indent - 1) });
        return InsertText(softBreak || leaf.IsCell ? "\u2028" : "\n", false);
    }
    public bool DeleteBackward(bool word = false)
    {
        if (IsReadOnly) return false; if (!Selection.IsEmpty) return InsertText("", false); if (Selection.Focus == 0) return false;
        var leaf = Index.At(Selection.Focus);
        if (Selection.Focus == leaf.Start && (leaf.IsCell || Index.At(leaf.Start - 1).IsCell)) { MoveCaret(leaf.Start - 1); return false; }
        return Apply("Backspace", DocumentEditing.Replace(Document, new(PreviousPosition(word), Selection.Focus), "", TypingStyle));
    }
    public bool DeleteForward(bool word = false)
    {
        if (IsReadOnly) return false; if (!Selection.IsEmpty) return InsertText("", false); if (Selection.Focus == Index.Length) return false;
        var leaf = Index.At(Selection.Focus);
        if (Selection.Focus == leaf.End && (leaf.IsCell || Index.At(leaf.End + 1).IsCell)) { MoveCaret(leaf.End + 1); return false; }
        return Apply("Delete", DocumentEditing.Replace(Document, new(Selection.Focus, NextPosition(word)), "", TypingStyle));
    }
    public bool ApplyTextStyle(Func<TextStyle, TextStyle> format, string label = "Format text")
    {
        if (IsReadOnly) return false;
        var nextStyle = DocumentValidation.ValidateStyle(format(TypingStyle));
        if (Selection.IsEmpty)
        {
            TypingStyle = nextStyle; _pendingStyle = true; _epoch++;
            SelectionChanged?.Invoke(this, EventArgs.Empty); StateChanged?.Invoke(this, EventArgs.Empty); return true;
        }
        var next = Document;
        foreach (var leaf in Index.Intersecting(Selection))
        {
            var a = Math.Max(0, Selection.Start - leaf.Start); var b = Math.Min(leaf.Paragraph.Length, Selection.End - leaf.Start); if (b <= a) continue;
            var p = leaf.Paragraph with { Runs = TextUtilities.FormatRuns(leaf.Paragraph, a, b - a, s => DocumentValidation.ValidateStyle(format(s))) };
            next = DocumentEditing.SetParagraph(next, leaf, p);
        }
        return Apply(label, (next, Selection));
    }
    public bool FormatParagraph(Func<ParagraphStyle, ParagraphStyle> format)
    {
        if (IsReadOnly) return false; var next = Document;
        foreach (var leaf in Index.Intersecting(Selection)) next = DocumentEditing.SetParagraph(next, leaf, leaf.Paragraph with { Style = DocumentValidation.ValidateParagraphStyle(format(leaf.Paragraph.Style)) });
        return Apply("Format paragraph", (next, Selection));
    }
    public bool ToggleBold() { var value = GetFormatting().Bold != true; return ApplyTextStyle(s => s with { Bold = value }, "Bold"); }
    public bool ToggleItalic() { var value = GetFormatting().Italic != true; return ApplyTextStyle(s => s with { Italic = value }, "Italic"); }
    public bool ToggleUnderline() { var value = GetFormatting().Underline != true; return ApplyTextStyle(s => s with { Underline = value }, "Underline"); }
    public bool ToggleStrike() { var value = GetFormatting().Strike != true; return ApplyTextStyle(s => s with { Strike = value }, "Strikethrough"); }
    public bool SetLink(string? url) => ApplyTextStyle(s => s with { Link = url, Underline = url is not null || s.Underline }, "Hyperlink");
    public bool ClearFormatting() => ApplyTextStyle(_ => TextStyle.Default, "Clear formatting");
    public bool SetHeading(int level) => FormatParagraph(p => p with { HeadingLevel = level, List = ListKind.None, Quote = false, CodeBlock = false });
    public bool ToggleList(ListKind list) { var value = Index.At(Selection.Focus).Paragraph.Style.List == list ? ListKind.None : list; return FormatParagraph(p => p with { List = value, HeadingLevel = 0 }); }
    public bool Indent(int delta) => FormatParagraph(p => p with { Indent = Math.Clamp(p.Indent + delta, 0, 8) });
    public FormattingSummary GetFormatting()
    {
        var styles = new List<TextStyle>();
        if (Selection.IsEmpty) styles.Add(TypingStyle);
        else foreach (var leaf in Index.Intersecting(Selection))
        {
            var a = Math.Clamp(Selection.Start - leaf.Start, 0, leaf.Paragraph.Length); var b = Math.Clamp(Selection.End - leaf.Start, a, leaf.Paragraph.Length);
            styles.AddRange(TextUtilities.SliceRuns(leaf.Paragraph, a, b - a).Select(r => r.Style));
        }
        if (styles.Count == 0) styles.Add(TypingStyle); var first = styles[0];
        bool? Common(Func<TextStyle, bool> f) => styles.All(s => f(s) == f(first)) ? f(first) : null;
        return new(Common(s => s.Bold), Common(s => s.Italic), Common(s => s.Underline), Common(s => s.Strike),
            styles.All(s => s.FontFamily == first.FontFamily) ? first.FontFamily : null, styles.All(s => s.FontSize == first.FontSize) ? first.FontSize : null,
            styles.All(s => s.Foreground == first.Foreground) ? first.Foreground : null, styles.All(s => s.Background == first.Background) ? first.Background : null,
            styles.All(s => s.Link == first.Link) ? first.Link : null);
    }
    public bool Rename(string title)
    {
        if (IsReadOnly) return false;
        if (string.IsNullOrWhiteSpace(title) || title.Length > 512) throw new DocumentValidationException("A title between 1 and 512 characters is required.");
        return title != Document.Title && Apply("Rename document", (Document with { Title = title }, Selection));
    }
    public bool Undo()
    {
        if (!CanUndo) return false; var h = _undo[^1]; _undo.RemoveAt(_undo.Count - 1); _redo.Add(h); Restore(h.Before, h.BeforeSelection, h.BeforeStyle, "Undo " + h.Label); return true;
    }
    public bool Redo()
    {
        if (!CanRedo) return false; var h = _redo[^1]; _redo.RemoveAt(_redo.Count - 1); _undo.Add(h); Restore(h.After, h.AfterSelection, h.AfterStyle, "Redo " + h.Label); return true;
    }
    private void Restore(RichDocument next, EditorSelection selection, TextStyle style, string label)
    {
        var before = Document; Document = next; Index = new(next); Selection = selection; TypingStyle = style; _pendingStyle = false; _epoch++; Revision++;
        DocumentChanged?.Invoke(this, new(before, next, label, Revision)); SelectionChanged?.Invoke(this, EventArgs.Empty); StateChanged?.Invoke(this, EventArgs.Empty);
    }
    private void UpdateTypingStyle() { if (!_pendingStyle) { var leaf = Index.At(Selection.Focus); TypingStyle = TextUtilities.StyleAt(leaf.Paragraph, Selection.Focus - leaf.Start); } }
    private bool Apply(string label, (RichDocument Document, EditorSelection Selection) result)
    {
        if (IsReadOnly || ReferenceEquals(result.Document, Document)) return false;
        var next = DocumentEditing.MapStructuralChange(Document, result.Document); var index = new DocumentIndex(next);
        if (next.Blocks.Length > Limits.MaxBlocks || index.Leaves.Sum(l => (long)l.Paragraph.Length) > Limits.MaxCharacters || index.Leaves.Any(l => l.Paragraph.Length > Limits.MaxParagraphCharacters) || index.Leaves.Sum(l => (long)l.Paragraph.Runs.Length) > Limits.MaxRuns) throw new DocumentValidationException("The edit exceeds the configured document limits.");
        var before = Document; var beforeSelection = Selection; var beforeStyle = TypingStyle;
        var selection = new EditorSelection(Math.Clamp(result.Selection.Anchor, 0, index.Length), Math.Clamp(result.Selection.Focus, 0, index.Length));
        var leaf = index.At(selection.Focus); var nextStyle = _pendingStyle ? TypingStyle : TextUtilities.StyleAt(leaf.Paragraph, selection.Focus - leaf.Start);
        var changed = index.Leaves.Where(l => !ReferenceEquals(Index.ById(l.Paragraph.Id)?.Paragraph, l.Paragraph));
        long cost = next.Blocks.Length * 16L + changed.Sum(l => l.Paragraph.Length * 2L + l.Paragraph.Runs.Length * 96L) + 256;
        cost += next.Blocks.OfType<ImageBlock>().Where(i => !before.Blocks.Any(b => ReferenceEquals(b, i))).Sum(i => i.DataUri.Length * 2L);
        var h = new HistoryEntry(before, next, beforeSelection, selection, beforeStyle, nextStyle, label, _epoch, DateTimeOffset.UtcNow, cost);
        if (label == "Typing" && _undo.Count > 0 && _undo[^1] is var last && last.Label == label && last.Epoch == _epoch && last.AfterSelection == beforeSelection && last.AfterStyle == beforeStyle && h.Time - last.Time < TimeSpan.FromMilliseconds(800))
            _undo[^1] = h with { Before = last.Before, BeforeSelection = last.BeforeSelection, BeforeStyle = last.BeforeStyle, Cost = Math.Max(cost, last.Cost) };
        else _undo.Add(h);
        while (_undo.Count > 0 && (_undo.Count > Math.Max(0, HistoryLimit) || _undo.Sum(x => x.Cost) > Math.Max(0, HistoryByteLimit))) _undo.RemoveAt(0);
        _redo.Clear(); Document = next; Index = index; Selection = selection; TypingStyle = nextStyle; Revision++;
        DocumentChanged?.Invoke(this, new(before, next, label, Revision)); SelectionChanged?.Invoke(this, EventArgs.Empty); StateChanged?.Invoke(this, EventArgs.Empty); return true;
    }
}
