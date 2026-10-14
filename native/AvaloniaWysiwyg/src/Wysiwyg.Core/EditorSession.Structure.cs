using System.Collections.Immutable;
namespace Wysiwyg.Core;
public sealed partial class EditorSession
{
    public TableBlock? CurrentTable => Index.At(Selection.Focus) is { IsCell: true } leaf ? Document.Blocks[leaf.BlockIndex] as TableBlock : null;
    public bool InsertTable(int rows = 3, int columns = 3)
    {
        if (IsReadOnly) return false;
        if (rows > Limits.MaxTableRows || columns > Limits.MaxTableColumns) throw new DocumentValidationException("Table dimensions exceed the configured limits.");
        return InsertBlock(TableBlock.Create(rows, columns), true);
    }
    public bool InsertImage(string dataUri, string altText, double width = 480, double height = 240)
    {
        if (IsReadOnly) return false;
        var image = new ImageBlock(Ids.New(), dataUri, altText, width, height);
        DocumentValidation.Validate(Document with { Blocks = Document.Blocks.Add(image) }, Limits);
        return InsertBlock(image, false);
    }
    public bool InsertRule() => !IsReadOnly && InsertBlock(new RuleBlock(Ids.New()), false);
    private bool InsertBlock(Block block, bool selectFirstCell)
    {
        var basis = Selection.IsEmpty ? (Document, Selection) : DocumentEditing.Replace(Document, Selection, "", TypingStyle);
        var doc = basis.Item1; var leaf = new DocumentIndex(doc).At(basis.Item2.Focus);
        var blocks = doc.Blocks.ToBuilder(); var next = ParagraphBlock.Create();
        blocks.Insert(leaf.BlockIndex + 1, block); blocks.Insert(leaf.BlockIndex + 2, next);
        doc = DocumentEditing.MapStructuralChange(basis.Item1, doc with { Blocks = blocks.ToImmutable() });
        var id = selectFirstCell && block is TableBlock t ? t.Rows[0].Cells[0].Content.Id : next.Id;
        var pos = new DocumentIndex(doc).ById(id)!.Start;
        return Apply("Insert " + block.GetType().Name.Replace("Block", "").ToLowerInvariant(), (doc, new(pos, pos)));
    }
    public bool RemoveBlock(string id)
    {
        if (IsReadOnly) return false; var i = Document.Blocks.FindIndex(b => b.Id == id); if (i < 0) return false;
        var blocks = Document.Blocks.RemoveAt(i); if (!blocks.Any(b => b is ParagraphBlock)) blocks = blocks.Add(ParagraphBlock.Create());
        var doc = Document with { Blocks = blocks }; var p = Math.Min(Selection.Focus, new DocumentIndex(doc).Length);
        return Apply("Remove block", (doc, new(p, p)));
    }
    public bool ResizeImage(string id, double width, double height, string? altText = null)
    {
        if (IsReadOnly) return false; var i = Document.Blocks.FindIndex(b => b.Id == id);
        if (i < 0 || Document.Blocks[i] is not ImageBlock image) return false;
        var doc = Document with { Blocks = Document.Blocks.SetItem(i, image with { Width = width, Height = height, AltText = altText ?? image.AltText }) };
        DocumentValidation.Validate(doc, Limits); return Apply("Resize image", (doc, Selection));
    }
    public bool AddTableRow(bool before = false)
    {
        if (IsReadOnly || CurrentTable is not { } t) return false;
        if (t.Rows.Length >= Limits.MaxTableRows) throw new DocumentValidationException("Table row limit reached.");
        var leaf = Index.At(Selection.Focus); var cells = Enumerable.Range(0, t.ColumnCount).Select(_ => new TableCell(Ids.New(), ParagraphBlock.Create())).ToImmutableArray();
        t = t with { Rows = t.Rows.Insert(before ? leaf.Row : leaf.Row + 1, new(cells)) };
        var doc = Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) }; var p = new DocumentIndex(doc).ById(cells[leaf.Column].Content.Id)!.Start;
        return Apply("Insert table row", (doc, new(p, p)));
    }
    public bool RemoveTableRow()
    {
        if (IsReadOnly || CurrentTable is not { } t) return false; var leaf = Index.At(Selection.Focus);
        if (t.Rows.Length == 1) return RemoveBlock(t.Id);
        t = t with { Rows = t.Rows.RemoveAt(leaf.Row) };
        var doc = Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) };
        var p = new DocumentIndex(doc).ById(t.Rows[Math.Min(leaf.Row, t.Rows.Length - 1)].Cells[leaf.Column].Content.Id)!.Start;
        return Apply("Delete table row", (doc, new(p, p)));
    }
    public bool AddTableColumn(bool before = false)
    {
        if (IsReadOnly || CurrentTable is not { } t) return false;
        if (t.ColumnCount >= Limits.MaxTableColumns) throw new DocumentValidationException("Table column limit reached.");
        var leaf = Index.At(Selection.Focus); var col = before ? leaf.Column : leaf.Column + 1;
        t = t with { Rows = t.Rows.Select(r => r with { Cells = r.Cells.Insert(col, new(Ids.New(), ParagraphBlock.Create())) }).ToImmutableArray(), ColumnWidths = t.ColumnWidths.Insert(col, 1) };
        var doc = Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) }; var p = new DocumentIndex(doc).ById(t.Rows[leaf.Row].Cells[col].Content.Id)!.Start;
        return Apply("Insert table column", (doc, new(p, p)));
    }
    public bool RemoveTableColumn()
    {
        if (IsReadOnly || CurrentTable is not { } t) return false; var leaf = Index.At(Selection.Focus);
        if (t.ColumnCount == 1) return RemoveBlock(t.Id);
        t = t with { Rows = t.Rows.Select(r => r with { Cells = r.Cells.RemoveAt(leaf.Column) }).ToImmutableArray(), ColumnWidths = t.ColumnWidths.RemoveAt(leaf.Column) };
        var doc = Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) }; var p = new DocumentIndex(doc).ById(t.Rows[leaf.Row].Cells[Math.Min(leaf.Column, t.ColumnCount - 1)].Content.Id)!.Start;
        return Apply("Delete table column", (doc, new(p, p)));
    }
    public bool SetColumnWidth(double relativeWidth)
    {
        if (IsReadOnly || CurrentTable is not { } t) return false;
        if (!double.IsFinite(relativeWidth) || relativeWidth is <= 0 or > 10000) throw new DocumentValidationException("Column width must be finite and positive.");
        var leaf = Index.At(Selection.Focus); t = t with { ColumnWidths = t.ColumnWidths.SetItem(leaf.Column, relativeWidth) };
        return Apply("Column width", (Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) }, Selection));
    }
    public bool SetCellBackground(string? color)
    {
        if (IsReadOnly || CurrentTable is not { } t) return false;
        if (!DocumentValidation.IsColor(color)) throw new DocumentValidationException("Invalid cell color.");
        var leaf = Index.At(Selection.Focus); var row = t.Rows[leaf.Row];
        row = row with { Cells = row.Cells.SetItem(leaf.Column, row.Cells[leaf.Column] with { Background = color }) };
        t = t with { Rows = t.Rows.SetItem(leaf.Row, row) };
        return Apply("Cell shading", (Document with { Blocks = Document.Blocks.SetItem(leaf.BlockIndex, t) }, Selection));
    }
    public bool NavigateTable(bool backward = false)
    {
        if (CurrentTable is not { } t) return false; var leaf = Index.At(Selection.Focus); var i = Index.Ordinal(leaf.Paragraph.Id);
        if (!backward && leaf.Row == t.Rows.Length - 1 && leaf.Column == t.ColumnCount - 1 && !IsReadOnly)
        {
            if (!AddTableRow()) return false; var current = Index.At(Selection.Focus); var table = (TableBlock)Document.Blocks[current.BlockIndex];
            var first = Index.ById(table.Rows[current.Row].Cells[0].Content.Id)!; SetSelection(first.Start, first.End); return true;
        }
        var target = Index.Leaves[Math.Clamp(i + (backward ? -1 : 1), 0, Index.Leaves.Length - 1)]; SetSelection(target.Start, target.End); return true;
    }
    public bool AddComment(string text, string author = "You")
    {
        if (IsReadOnly) return false;
        if (string.IsNullOrWhiteSpace(text) || text.Length > 8000 || string.IsNullOrWhiteSpace(author) || author.Length > 128) throw new DocumentValidationException("A comment needs an author and text within the configured limits.");
        if (Document.Comments.Length >= Limits.MaxComments) throw new DocumentValidationException("Comment limit reached.");
        return Apply("Add comment", (Document with { Comments = Document.Comments.Add(new(Ids.New(), author.Trim(), text.Trim(), Selection.Range, DateTimeOffset.UtcNow)) }, Selection));
    }
    public bool ResolveComment(string id, bool resolved = true)
    {
        if (IsReadOnly) return false; var i = Document.Comments.FindIndex(c => c.Id == id); if (i < 0 || Document.Comments[i].Resolved == resolved) return false;
        return Apply(resolved ? "Resolve comment" : "Reopen comment", (Document with { Comments = Document.Comments.SetItem(i, Document.Comments[i] with { Resolved = resolved }) }, Selection));
    }
    public bool RemoveComment(string id)
    {
        if (IsReadOnly) return false; var i = Document.Comments.FindIndex(c => c.Id == id);
        return i >= 0 && Apply("Delete comment", (Document with { Comments = Document.Comments.RemoveAt(i) }, Selection));
    }
    public RichDocument CopySelection()
    {
        if (Selection.IsEmpty) return RichDocument.Empty("Clipboard"); var blocks = ImmutableArray.CreateBuilder<Block>();
        foreach (var leaf in Index.Intersecting(Selection))
        {
            var a = Math.Clamp(Selection.Start - leaf.Start, 0, leaf.Paragraph.Length); var b = Math.Clamp(Selection.End - leaf.Start, a, leaf.Paragraph.Length);
            blocks.Add(leaf.Paragraph with { Id = Ids.New(), Runs = TextUtilities.NormalizeRuns(TextUtilities.SliceRuns(leaf.Paragraph, a, b - a)) });
        }
        if (blocks.Count == 0) blocks.Add(ParagraphBlock.Create()); return new() { Title = "Clipboard", Blocks = blocks.ToImmutable() };
    }
    public bool InsertFragment(RichDocument fragment)
    {
        if (IsReadOnly) return false; DocumentValidation.Validate(fragment, Limits);
        var basis = Selection.IsEmpty ? (Document, Selection) : DocumentEditing.Replace(Document, Selection, "", TypingStyle);
        var doc = basis.Item1; var leaf = new DocumentIndex(doc).At(basis.Item2.Focus); var offset = basis.Item2.Focus - leaf.Start;
        var prefix = TextUtilities.SliceRuns(leaf.Paragraph, 0, offset); var suffix = TextUtilities.SliceRuns(leaf.Paragraph, offset, leaf.Paragraph.Length - offset);
        var inserted = fragment.Blocks.Select(Clone).ToList();
        if (leaf.IsCell)
        {
            if (inserted.Any(b => b is not ParagraphBlock)) throw new DocumentValidationException("Paste text into a cell; insert structured content outside the table.");
            var runs = new List<TextRun>();
            foreach (var p in inserted.Cast<ParagraphBlock>()) { if (runs.Count > 0) runs.Add(new("\u2028")); runs.AddRange(p.Runs); }
            var n = runs.Sum(r => r.Text.Length); var paragraph = leaf.Paragraph with { Runs = TextUtilities.NormalizeRuns(prefix.Concat(runs).Concat(suffix)) };
            doc = DocumentEditing.SetParagraph(doc, leaf, paragraph); doc = DocumentEditing.MapComments(doc, leaf.Start + offset, 0, n);
            var p0 = leaf.Start + offset + n; return Apply("Paste rich text", (doc, new(p0, p0)));
        }
        if (inserted[0] is ParagraphBlock first) inserted[0] = first with { Id = leaf.Paragraph.Id, Runs = TextUtilities.NormalizeRuns(prefix.Concat(first.Runs)), Style = prefix.IsEmpty ? first.Style : leaf.Paragraph.Style };
        else inserted.Insert(0, leaf.Paragraph with { Runs = TextUtilities.NormalizeRuns(prefix) });
        string targetId; int targetOffset;
        if (inserted[^1] is ParagraphBlock last)
        { targetId = last.Id; targetOffset = last.Length; inserted[^1] = last with { Runs = TextUtilities.NormalizeRuns(last.Runs.Concat(suffix)) }; }
        else { var p = ParagraphBlock.Create() with { Runs = TextUtilities.NormalizeRuns(suffix) }; inserted.Add(p); targetId = p.Id; targetOffset = 0; }
        var blocks = doc.Blocks.ToBuilder(); blocks.RemoveAt(leaf.BlockIndex); blocks.InsertRange(leaf.BlockIndex, inserted);
        doc = DocumentEditing.MapStructuralChange(basis.Item1, doc with { Blocks = blocks.ToImmutable() });
        DocumentValidation.Validate(doc, Limits); var target = new DocumentIndex(doc).ById(targetId)!.Start + targetOffset;
        return Apply("Paste rich content", (doc, new(target, target)));
        static Block Clone(Block b) => b switch
        {
            ParagraphBlock p => p with { Id = Ids.New() }, ImageBlock image => image with { Id = Ids.New() }, RuleBlock rule => rule with { Id = Ids.New() },
            TableBlock t => t with { Id = Ids.New(), Rows = t.Rows.Select(r => r with { Cells = r.Cells.Select(c => c with { Id = Ids.New(), Content = c.Content with { Id = Ids.New() } }).ToImmutableArray() }).ToImmutableArray() },
            _ => throw new DocumentValidationException("Unknown fragment block.")
        };
    }
}
