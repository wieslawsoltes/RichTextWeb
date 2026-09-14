import { FlowDocument, type DocumentNode } from "./model.js";
import { RichTextEngine } from "./engine.js";
import { DocumentFeatures, type StoryKind } from "./document-features.js";

const kinds: readonly StoryKind[] = [
  "Headers",
  "Footers",
  "FirstPageHeader",
  "FirstPageFooter",
  "EvenPageHeader",
  "EvenPageFooter",
];
/** A detached, editable rich story. Apply is one parent-document undo unit; Cancel never mutates the parent. */
export class DocumentStorySession {
  readonly Engine: RichTextEngine;
  readonly Kind: StoryKind;
  private readonly parent: FlowDocument;
  private readonly original: string;
  private closed = false;
  constructor(
    private readonly owner: RichTextEngine,
    kind: StoryKind,
    readonly SectionId?: string,
  ) {
    if (!kinds.includes(kind))
      throw new TypeError("Unknown header/footer story.");
    this.Kind = kind;
    this.parent = owner.Document;
    const target = this.target();
    const content = target.props[kind];
    this.original = JSON.stringify(content ?? null);
    const root = new FlowDocument().ToJSON();
    // Font properties are inherited from the main document without copying its page stories/review metadata.
    const properties = this.parent.ToJSON().props;
    for (const name of [
      "FontFamily",
      "FontSize",
      "FontWeight",
      "FontStyle",
      "Foreground",
      "FlowDirection",
      "Language",
    ])
      if (properties[name] !== undefined) root.props[name] = properties[name];
    root.children = structuredClone(Array.isArray(content) ? content : []);
    this.Engine = new RichTextEngine(FlowDocument.FromJSON(root));
  }
  get Document(): FlowDocument {
    return this.Engine.Document;
  }
  get IsClosed(): boolean {
    return this.closed;
  }
  get HasConflict(): boolean {
    if (this.closed || this.owner.Document !== this.parent) return true;
    try {
      return (
        JSON.stringify(this.target().props[this.Kind] ?? null) !== this.original
      );
    } catch {
      return true;
    }
  }
  Apply(): boolean {
    if (this.closed) throw new Error("The story editing session is closed.");
    if (this.HasConflict)
      throw new Error(
        "The target story changed or was removed; reopen it before applying.",
      );
    const children = this.Document.ToJSON().children ?? [];
    const changed =
      JSON.stringify(children) !== this.original &&
      !(this.original === "null" && children.length === 0);
    if (changed)
      new DocumentFeatures(this.owner).SetStory(
        this.Kind,
        children,
        this.SectionId,
      );
    this.Dispose();
    return changed;
  }
  Cancel(): void {
    this.Dispose();
  }
  Dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.Engine.Dispose();
  }
  private target(): DocumentNode {
    const root = this.owner.Document.ToJSON();
    if (!this.SectionId) return root;
    const node = this.owner.Document.FindById(this.SectionId);
    if (!node || node.Type !== "Section")
      throw new Error("Section was not found.");
    return node.ToJSON();
  }
}
