import { showMailMergeResults } from "./mail-merge.js";
function fieldReference(instruction) {
  const match = /^(?:REF|PAGEREF)\s+(?:"([^"]+)"|(\S+))/i.exec(instruction);
  return match?.[1] ?? match?.[2];
}
import "@wieslawsoltes/ribbon-web";
import {
  DockingManager,
  LayoutRoot,
  LayoutPanel,
  LayoutDocumentPane,
  LayoutDocument,
  LayoutAnchorablePane,
  LayoutAnchorable,
} from "@wieslawsoltes/dockyard";
import "@wieslawsoltes/dockyard/styles.css";
import {
  ObservableList,
  FlatTreeDataGridSource,
  TextColumn,
} from "@wieslawsoltes/treedatagridweb";
import "@wieslawsoltes/treedatagridweb/web";
import "@wieslawsoltes/treedatagridweb/styles.css";
import {
  SourceCache,
  filter,
  sort,
  toCollection,
} from "@wieslawsoltes/dynamicdataweb";
import {
  ReactiveObject,
  ReactiveCommand,
  WhenAnyValue,
  CompositeDisposable,
} from "@wieslawsoltes/reactiveweb";
import { OneWayBind } from "@wieslawsoltes/reactiveweb/html";
import { BehaviorSubject } from "rxjs";
import { RBush, Envelope } from "@wieslawsoltes/rbushweb";
import {
  BidirectionalGraph,
  TaggedEdge,
  BreadthFirstSearchAlgorithm,
  defineQuikGraphViewer,
} from "@wieslawsoltes/quikgraphweb";
import { createDocumentRibbon } from "./word-ribbon.js";
import "./word-workspace.css";

const passive = new Set([
  "read-mode",
  "outline-view",
  "draft-view",
  "fit-width",
  "fit-page",
  "two-pages",
  "single-page",
  "vertical-pages",
  "multiple-pages",
  "quick-save",
  "save",
  "open",
  "new",
  "find",
  "select-all",
  "properties",
  "comments",
  "navigation",
  "source",
  "print",
  "pdf-tools",
  "PagePreview",
  "WordCount",
  "FormData",
  "DocumentStyles",
  "DocumentTheme",
  "ValidateForm",
  "ReviewChanges",
  "Copy",
  "collaboration-demo",
]);

/** A real ReactiveWeb view model; editor state is the only document authority. */
class StudioViewModel extends ReactiveObject {
  get Title() {
    return this.GetValue("Title", "Document");
  }
  set Title(value) {
    this.RaiseAndSetIfChanged("Title", value);
  }
  get Catalog() {
    return this.GetValue("Catalog", "all");
  }
  set Catalog(value) {
    this.RaiseAndSetIfChanged("Catalog", value);
  }
  get Filter() {
    return this.GetValue("Filter", "");
  }
  set Filter(value) {
    this.RaiseAndSetIfChanged("Filter", value);
  }
  get Summary() {
    return this.GetValue("Summary", "");
  }
  set Summary(value) {
    this.RaiseAndSetIfChanged("Summary", value);
  }
  get IsReadOnly() {
    return this.GetValue("IsReadOnly", false);
  }
  set IsReadOnly(value) {
    this.RaiseAndSetIfChanged("IsReadOnly", value);
  }
  get Status() {
    return this.GetValue("Status", "Ready");
  }
  set Status(value) {
    this.RaiseAndSetIfChanged("Status", value);
  }
}

export function createWordWorkspace(hooks) {
  const { editor, RT, run, toast } = hooks;
  let pane, graphPanel;
  const q = (id) =>
    pane?.querySelector(`#${id}`) ||
    graphPanel?.querySelector(`#${id}`) ||
    document.getElementById(id);
  const lifetime = new CompositeDisposable();
  const vm = new StudioViewModel();
  lifetime.Add(vm);
  const records = [],
    models = [],
    subscriptions = [];
  let revision = -1,
    currentDocument,
    queued = false,
    graphDirty = true,
    disposed = false,
    spatialFrame;
  const rows = new SourceCache((item) => item.Id);
  const predicates = new BehaviorSubject(() => true);
  const spatial = new RBush(12);
  const recordById = new Map();
  const ribbon = q("word-ribbon");

  const commandService = document.createElement("rich-text-toolbar");
  commandService.id = "document-command-service";
  commandService.Editor = editor;
  commandService.Mode = "all";
  document.body.append(commandService);
  const hideTools = document.createElement("style");
  hideTools.textContent = ".tools{display:none}";
  commandService.shadowRoot.append(hideTools);
  commandService.addEventListener("previewrequest", hooks.openPagePreview);
  commandService.addEventListener("documentsgenerated", (event) => {
    showMailMergeResults(event.detail.documents, editor, RT);
  });
  commandService.addEventListener("commanderror", (event) =>
    toast(event.detail.error.message),
  );
  const executeControl = (name, value) => {
    const result = commandService.Execute(name, value);
    Refresh();
    return result;
  };

  pane = document.createElement("section");
  pane.className = "document-explorer";
  pane.innerHTML = `<div class="explorer-heading"><strong>Document explorer</strong><span id="explorer-count"></span></div>
    <div class="explorer-controls"><select id="catalog-kind" aria-label="Explore document"><option value="all">All document items</option><option value="styles">Styles</option><option value="revisions">Tracked changes</option><option value="fields">Fields & references</option><option value="objects">Tables & floating objects</option><option value="headings">Headings</option></select><input id="catalog-search" type="search" placeholder="Filter items…" aria-label="Filter document items" /></div>
    <tree-data-grid id="document-grid" aria-label="Document items" row-height="auto"></tree-data-grid>
    <div class="explorer-actions"><button id="catalog-go">Go to selection</button><button id="catalog-apply-style" hidden>Apply style</button><button id="catalog-accept" hidden>Accept</button><button id="catalog-reject" hidden>Reject</button></div>
    <div id="catalog-detail" class="catalog-detail">Select an item to inspect its document position.</div>
    <div id="engine-metrics" class="engine-metrics" aria-live="polite"></div>`;
  graphPanel = document.createElement("section");
  graphPanel.className = "document-graph";
  graphPanel.innerHTML = `<div class="explorer-heading"><strong>Document map</strong></div><p class="pane-description">Headings, tables, fields, and their references. Select a node to navigate to its text.</p><div class="graph-actions"><button id="graph-root">Whole document</button><button id="graph-related">Show related</button></div><quikgraph-viewer id="document-graph" aria-label="Document reference graph"></quikgraph-viewer><div id="graph-status" class="catalog-detail"></div>`;
  defineQuikGraphViewer();
  customElements.upgrade(graphPanel);
  const toolsPanel = document.createElement("section");
  toolsPanel.className = "all-tools-panel";
  const fullToolbar = document.createElement("rich-text-toolbar");
  fullToolbar.Editor = editor;
  fullToolbar.Mode = "all";
  fullToolbar.addEventListener("previewrequest", hooks.openPagePreview);
  fullToolbar.addEventListener("commanderror", (event) =>
    toast(event.detail.error.message),
  );
  fullToolbar.addEventListener("documentsgenerated", (event) =>
    commandService.dispatchEvent(
      new CustomEvent("documentsgenerated", { detail: event.detail }),
    ),
  );
  toolsPanel.append(fullToolbar);

  const nav = document.querySelector(".navigation"),
    canvas = document.querySelector(".canvas"),
    inspector = document.querySelector(".inspector");
  const main = document.querySelector("main.workspace"),
    host = document.createElement("div");
  host.id = "docking-workspace";
  host.setAttribute("aria-label", "Dockable document workspace");
  const navModel = new LayoutAnchorable({
    ContentId: "navigation",
    Title: "Navigation",
    Content: nav,
    CanClose: false,
    AutoHideWidth: 240,
  });
  const documentModel = new LayoutDocument({
    ContentId: "document",
    Title: q("document-title").value,
    Content: canvas,
    CanClose: false,
  });
  const propertiesModel = new LayoutAnchorable({
    ContentId: "properties",
    Title: "Properties",
    Content: inspector,
    CanClose: false,
  });
  const explorerModel = new LayoutAnchorable({
    ContentId: "explorer",
    Title: "Explorer",
    Content: pane,
    CanClose: false,
  });
  const graphModel = new LayoutAnchorable({
    ContentId: "graph",
    Title: "Map",
    Content: graphPanel,
    CanClose: false,
  });
  const toolsModel = new LayoutAnchorable({
    ContentId: "tools",
    Title: "All tools",
    Content: toolsPanel,
    CanClose: false,
  });
  const right = new LayoutAnchorablePane({
    DockWidth: 292,
    DockMinWidth: 230,
    Children: [propertiesModel, explorerModel, graphModel, toolsModel],
  });
  const layout = new LayoutRoot(
    new LayoutPanel({
      Orientation: "Horizontal",
      Children: [
        new LayoutAnchorablePane({
          DockWidth: 225,
          DockMinWidth: 175,
          Children: [navModel],
        }),
        new LayoutDocumentPane({
          Children: [documentModel],
          DockMinWidth: 280,
        }),
        right,
      ],
    }),
  );
  // Construct the full model before detaching existing content. Dockyard reuses each node.
  main.replaceChildren(host);
  const docking = new DockingManager(host, {
    Layout: layout,
    Theme: "light",
    GridSplitterWidth: 5,
    EnableHistory: true,
  });
  const defaultLayout = docking.SaveLayout();
  const showPane = (id) => {
    const item = docking.Find(id);
    if (item?.IsHidden && item.Show) item.Show();
    if (item?.IsAutoHidden) docking.ShowAutoHideWindow(item);
    item?.Activate();
    if (innerWidth < 900 && id !== "document" && item && !item.IsFloating) {
      docking.Float(item, {
        FloatingLeft: 10,
        FloatingTop: 10,
        FloatingWidth: Math.max(280, Math.min(360, innerWidth - 20)),
        FloatingHeight: Math.max(240, Math.min(540, innerHeight - 240)),
      });
    }
  };
  const togglePane = (id) => {
    const item = docking.Find(id);
    if (item?.IsHidden || item?.IsAutoHidden) {
      showPane(id);
    } else item?.Hide();
  };
  const openCatalog = (value) => {
    vm.Catalog = value;
    q("catalog-kind").value = value;
    showPane("explorer");
  };
  const showGraph = () => {
    showPane("graph");
    refreshGraph();
  };

  const button = (id, label, icon, execute, options = {}) => {
    const mutates =
      options.mutates ??
      !(
        id.includes("-pane") ||
        id.includes("-catalog") ||
        id.includes("-graph") ||
        id.includes("-field-list") ||
        id === "all-tools" ||
        passive.has(id) ||
        id.startsWith("export-") ||
        id.startsWith("source-")
      );
    const action = ReactiveCommand.CreateFromTask(
      async (value) => await execute(value),
      mutates ? WhenAnyValue(vm, "IsReadOnly", (locked) => !locked) : undefined,
    );
    lifetime.Add(action);
    subscriptions.push(
      action.ThrownExceptions.subscribe((error) => toast(error.message)),
    );
    const item = {
      id,
      type: "button",
      label,
      icon,
      size: "small",
      ...options,
      command(value) {
        if (mutates && editor.IsReadOnly) {
          toast("Turn off read-only mode to edit this document.");
          return;
        }
        if (ribbon.shadowRoot.querySelector(".backstage"))
          ribbon.selectTab("home");
        action
          .Execute(value)
          .subscribe({ error: (error) => toast(error.message) });
      },
    };
    records.push({ item, mutates });
    return item;
  };
  const dock = (action) => {
    if (action === "float") docking.Find("document")?.Float();
    if (action === "dock") docking.Find("document")?.Dock();
    if (action === "save") {
      try {
        localStorage.setItem("richtextweb-workspace-v1", docking.SaveLayout());
        toast("Workspace layout saved.");
      } catch (error) {
        toast(`Could not save workspace: ${error.message}`);
      }
    }
    if (action === "restore") {
      try {
        docking.LoadLayout(
          localStorage.getItem("richtextweb-workspace-v1") || defaultLayout,
        );
        toast("Workspace layout restored.");
      } catch (error) {
        toast(`Could not restore workspace: ${error.message}`);
      }
    }
    if (action === "tools") showPane("tools");
    if (action === "nearest") {
      updateSpatial();
      const bounds = editor.getBoundingClientRect(),
        found = spatial.Knn(
          1,
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )[0];
      if (found) {
        goTo(found.Id);
        openCatalog("objects");
        toast(`Selected ${recordById.get(found.Id)?.Name || "nearest object"}`);
      } else
        toast("Insert a picture, text box, or table to use object navigation.");
    }
  };
  const configuration = createDocumentRibbon({
    button,
    control: executeControl,
    command: (name) => run(name === "quick-save" ? "save" : name),
    openCatalog,
    showGraph,
    dock,
    editor,
    RT,
  });
  ribbon.model = configuration.model;
  ribbon.addEventListener("ribbon-error", (event) =>
    toast(event.detail.error?.message || "Command failed."),
  );
  ribbon.addEventListener("ribbon-command", Refresh);
  ribbon.addEventListener("ribbon-tab-change", (event) => {
    if (event.detail.id === "advanced") showPane("tools");
  });

  const gridItems = new ObservableList();
  const gridModel = new FlatTreeDataGridSource(gridItems);
  gridModel.Columns.Add(
    new TextColumn("Item", (item) => item.Name, "2*", {
      TextWrapping: true,
      AffectsRowHeight: true,
    }),
  );
  gridModel.Columns.Add(new TextColumn("Kind", (item) => item.Kind, "1*"));
  gridModel.Columns.Add(
    new TextColumn("Detail", (item) => item.Detail, "2*", {
      TextWrapping: true,
      AffectsRowHeight: true,
    }),
  );
  const grid = q("document-grid");
  grid.Model = gridModel;
  grid.CanUserResizeColumns = true;
  models.push(gridModel);
  subscriptions.push(
    rows
      .connect()
      .pipe(
        filter(predicates),
        sort((a, b) => a.Order - b.Order || a.Name.localeCompare(b.Name)),
        toCollection(),
      )
      .subscribe((items) => {
        gridItems.Reset(items);
        q("explorer-count").textContent = `${items.length} items`;
      }),
  );
  subscriptions.push(
    WhenAnyValue(vm, "Catalog", "Filter", (kind, query) => ({
      kind,
      query,
    })).subscribe(({ kind, query }) => {
      const needle = query.trim().toLowerCase();
      predicates.next(
        (item) =>
          (kind === "all"
            ? item.Category !== "styles"
            : item.Category === kind) &&
          (!needle ||
            `${item.Name} ${item.Kind} ${item.Detail}`
              .toLowerCase()
              .includes(needle)),
      );
      q("catalog-apply-style").hidden = kind !== "styles";
      q("catalog-accept").hidden = q("catalog-reject").hidden =
        kind !== "revisions";
    }),
  );
  lifetime.Add(OneWayBind(vm, "Summary", q("engine-metrics"), "textContent"));
  q("catalog-kind").onchange = (event) => (vm.Catalog = event.target.value);
  q("catalog-search").oninput = (event) => (vm.Filter = event.target.value);
  const selected = () => gridModel.RowSelection.SelectedItem;
  subscriptions.push(
    gridModel.RowSelection.SelectionChanged.Subscribe(() => {
      const item = selected();
      q("catalog-detail").textContent = item
        ? `${item.Name}\n${item.Detail}${item.Start !== undefined ? `\nText range ${item.Start}–${item.End}` : ""}`
        : "Select an item to inspect its document position.";
    }),
  );
  q("catalog-go").onclick = () => {
    const item = selected();
    if (item) goTo(item.Id);
  };
  q("catalog-apply-style").onclick = () => {
    const item = selected();
    if (item && !editor.IsReadOnly) {
      if (item.NamedStyle) {
        const definition = editor.Engine.GetDocumentStyles().find(
          (s) => s.Id === item.NamedStyle,
        );
        if (definition?.Kind === "Character")
          editor.Engine.ApplyCharacterStyle(definition.Id);
        else if (definition) editor.Engine.ApplyParagraphStyle(definition.Id);
        editor.Focus();
        Refresh();
      } else configuration.ApplyStyle(item.Style);
    }
  };
  q("catalog-accept").onclick = () => {
    const item = selected();
    if (item && !editor.IsReadOnly) {
      editor.Engine.AcceptRevision(item.RevisionId);
      Refresh();
    }
  };
  q("catalog-reject").onclick = () => {
    const item = selected();
    if (item && !editor.IsReadOnly) {
      try {
        editor.Engine.RejectRevision(item.RevisionId);
        Refresh();
      } catch (error) {
        toast(error.message);
      }
    }
  };

  const viewer = q("document-graph");
  let graph = new BidirectionalGraph(),
    selectedVertex;
  viewer.VertexLabel = (id) => {
    const name =
      recordById.get(id)?.Name || (id === "document-root" ? "Document" : id);
    return name.length > 22 ? `${name.slice(0, 21)}…` : name;
  };
  viewer.addEventListener("graph-select", (event) => {
    if (event.detail.vertex !== undefined) {
      selectedVertex = event.detail.vertex;
      goTo(selectedVertex);
    }
  });
  q("graph-root").onclick = () => {
    selectedVertex = undefined;
    viewer.Graph = graph;
    viewer.Refresh();
  };
  q("graph-related").onclick = () => {
    if (!selectedVertex || !graph.ContainsVertex(selectedVertex)) return;
    const reached = new Set();
    const search = new BreadthFirstSearchAlgorithm(graph);
    const subscription = search.DiscoverVertex.subscribe((vertex) =>
      reached.add(vertex),
    );
    search.Compute(selectedVertex);
    subscription.Dispose();
    const related = new BidirectionalGraph();
    related.AddVertexRange(reached);
    related.AddEdgeRange(
      [...graph.Edges].filter(
        (edge) => reached.has(edge.Source) && reached.has(edge.Target),
      ),
    );
    viewer.Graph = related;
    viewer.Refresh();
    q("graph-status").textContent =
      `${related.VertexCount} related items from ${recordById.get(selectedVertex)?.Name || "document"}.`;
  };

  function goTo(id) {
    const item = recordById.get(id);
    if (!item || item.Start === undefined) return;
    showPane("document");
    const max = editor.Document.Text.length;
    editor.Engine.Select(Math.min(max, item.Start), Math.min(max, item.End));
    if (editor.ScrollToTextOffset) editor.ScrollToTextOffset(item.Start);
    editor.Focus();
  }
  function rebuildRows() {
    const document = editor.Document,
      root = document.ToJSON(),
      map = document.GetSymbolMap();
    const next = [];
    const visit = (node, parent = "document-root") => {
      const props = node.props || {},
        heading = node.type === "Paragraph" && Number(props.HeadingLevel) > 0;
      const category = heading
        ? "headings"
        : props.Field || props.NoteReference
          ? "fields"
          : [
                "Image",
                "Table",
                "Figure",
                "Floater",
                "BlockUIContainer",
              ].includes(node.type)
            ? "objects"
            : null;
      let nextParent = parent;
      if (category) {
        const bounds = map.GetElementBounds(node.id);
        const name = heading
          ? (document.FindById(node.id)?.Text || "").slice(0, 90)
          : props.Field
            ? props.Field.Instruction
            : props.AlternativeText ||
              props.Name ||
              `${node.type} ${next.filter((x) => x.Kind === node.type).length + 1}`;
        const item = {
          Id: node.id,
          Name: name || "Empty heading",
          Category: category,
          Kind: props.Field
            ? "Field"
            : heading
              ? `Heading ${props.HeadingLevel}`
              : node.type,
          Detail: props.Field
            ? String(props.Field.Argument || props.Field.Type)
            : heading
              ? "Navigate to this heading"
              : props.WrapStyle
                ? `Wrap: ${props.WrapStyle}`
                : `${(node.children || []).length} child items`,
          Start: bounds ? map.GetTextOffset(bounds.ContentStart) : 0,
          End: bounds ? map.GetTextOffset(bounds.ContentEnd) : 0,
          Parent: parent,
          Reference:
            props.Field?.Argument ||
            (/^(REF|PAGEREF)\s/i.test(props.Field?.Instruction ?? "")
              ? fieldReference(props.Field.Instruction)
              : undefined),
          Order: next.length,
          Node: node,
        };
        next.push(item);
        nextParent = node.id;
      }
      for (const child of node.children || []) visit(child, nextParent);
    };
    visit(root);
    const revisionIds = new Set(editor.Engine.Revisions.map((item) => item.Id));
    for (const annotation of editor.Engine.Annotations) {
      const isRevision = revisionIds.has(annotation.Id);
      if (!isRevision && annotation.Kind !== "Bookmark") continue;
      next.push({
        Id: `annotation-${annotation.Id}`,
        RevisionId: annotation.Id,
        Name: isRevision
          ? `${annotation.Kind} · ${annotation.Data.Author || "Author"}`
          : annotation.Data.Name,
        Category: isRevision ? "revisions" : "fields",
        Kind: annotation.Kind,
        Detail:
          annotation.Data.Text ||
          annotation.Data.Operation ||
          annotation.Data.Name ||
          "Document change",
        Start: annotation.Start,
        End: annotation.End,
        Order: next.length,
        Parent: "document-root",
        Bookmark: annotation.Data.Name,
      });
    }
    for (const [index, style] of [
      "normal",
      "title",
      "subtitle",
      "heading1",
      "heading2",
      "quote",
    ].entries())
      next.push({
        Id: `style-${style}`,
        Name: style
          .replace(/(\d)/, " $1")
          .replace(/^./, (c) => c.toUpperCase()),
        Style: style,
        Category: "styles",
        Kind: "Paragraph style",
        Detail: "Apply to selected paragraphs",
        Order: index,
      });
    for (const style of editor.Engine.GetDocumentStyles())
      next.push({
        Id: `named-style-${style.Id}`,
        Name: style.Name,
        NamedStyle: style.Id,
        Style: style.Id,
        Category: "styles",
        Kind: `${style.Kind} style`,
        Detail: `Based on: ${style.BasedOn ?? "none"}${style.IsDefault ? " · Default" : ""}`,
        Order: next.length,
      });
    const previous = new Set(recordById.keys());
    rows.edit((cache) => {
      for (const item of next) {
        previous.delete(item.Id);
        const old = recordById.get(item.Id);
        recordById.set(item.Id, item);
        if (!old || JSON.stringify(old) !== JSON.stringify(item))
          cache.addOrUpdate(item);
      }
      for (const id of previous) {
        recordById.delete(id);
        cache.removeKey(id);
      }
    });
    graphDirty = true;
    if (docking.Find("graph")?.IsSelected) refreshGraph();
    cancelAnimationFrame(spatialFrame);
    spatialFrame = requestAnimationFrame(updateSpatial);
  }
  function refreshGraph() {
    if (!graphDirty) return;
    graphDirty = false;
    graph = new BidirectionalGraph();
    graph.AddVertex("document-root");
    const items = [...recordById.values()].filter(
      (item) => item.Category !== "styles" && item.Category !== "revisions",
    );
    // Bound the interactive overview; the complete catalog and document stay available.
    const visible = items.slice(0, 250),
      ids = new Set(["document-root", ...visible.map((item) => item.Id)]);
    graph.AddVertexRange(visible.map((item) => item.Id));
    for (const item of visible) {
      graph.AddEdge(
        new TaggedEdge(
          ids.has(item.Parent) ? item.Parent : "document-root",
          item.Id,
          "contains",
        ),
      );
      if (item.Reference) {
        const target = visible.find(
          (candidate) =>
            candidate.Bookmark === item.Reference ||
            candidate.Id === item.Reference,
        );
        if (target && target.Id !== item.Id)
          graph.AddEdge(new TaggedEdge(item.Id, target.Id, "references"));
      }
    }
    viewer.Graph = graph;
    viewer.Refresh();
    requestAnimationFrame(() => viewer.Fit());
    q("graph-status").textContent =
      `${graph.VertexCount} nodes · ${graph.EdgeCount} relationships${items.length > visible.length ? ` · overview shows first ${visible.length} items; use Explorer for all ${items.length}` : ""}`;
  }
  function updateSpatial() {
    const items = [];
    for (const element of editor.shadowRoot.querySelectorAll("[data-rt-id]")) {
      const id = element.dataset.rtId,
        row = recordById.get(id);
      if (row?.Category !== "objects") continue;
      for (const box of element.getClientRects())
        if (box.width > 0 && box.height > 0)
          items.push({
            Id: id,
            Envelope: new Envelope(box.left, box.top, box.right, box.bottom),
          });
    }
    spatial.Clear();
    if (items.length) spatial.BulkLoad(items);
  }
  function Refresh() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      vm.Title = q("document-title").value;
      vm.IsReadOnly = editor.IsReadOnly;
      const item = docking.Find("document");
      if (item) item.Title = vm.Title;
      if (
        currentDocument !== editor.Document ||
        revision !== editor.Document.Revision
      ) {
        currentDocument = editor.Document;
        revision = currentDocument.Revision;
        rebuildRows();
      }
      const stats = editor.VirtualizationStatistics;
      vm.Summary = `${recordById.size - 6} indexed items · ${editor.Engine.Revisions.length} tracked changes${stats ? ` · ${stats.RealizedBlocks ?? stats.RealizedCount ?? "—"} rendered blocks` : ""}`;
      for (const { item, mutates } of records) {
        const current = ribbon.getControl(item.id);
        if (!current) continue;
        let enabled = !(mutates && editor.IsReadOnly);
        if (item.id === "Undo") enabled &&= editor.Engine.CanUndo;
        if (item.id === "Redo") enabled &&= editor.Engine.CanRedo;
        if (current.enabled !== enabled) current.enabled = enabled;
      }
      for (const [id, property, value] of [
        ["ToggleBold", "FontWeight", "Bold"],
        ["ToggleItalic", "FontStyle", "Italic"],
        ["ToggleUnderline", "TextDecorations", "Underline"],
      ]) {
        const item = ribbon.getControl(id);
        if (item)
          item.checked = editor.Selection.GetPropertyValue(property) === value;
      }
      if (
        !["INPUT", "SELECT"].includes(ribbon.shadowRoot?.activeElement?.tagName)
      ) {
        for (const [id, property] of [
          ["font-family", "FontFamily"],
          ["font-size", "FontSize"],
          ["font-color", "Foreground"],
          ["highlight-color", "Background"],
        ]) {
          const value = editor.Selection.GetPropertyValue(property),
            item = ribbon.getControl(id);
          if (
            item &&
            (typeof value === "string" || typeof value === "number") &&
            (item.type !== "color" || /^#[0-9a-f]{6}$/i.test(String(value)))
          )
            item.value = String(value);
        }
      }
      const track = ribbon.getControl("TrackChanges");
      if (track) track.checked = editor.Engine.TrackChanges;
      const virtual = ribbon.getControl("virtualization");
      if (virtual) virtual.checked = !!editor.EnableVirtualization;
      const readOnly = ribbon.getControl("read-only");
      if (readOnly) readOnly.checked = editor.IsReadOnly;
      for (const id of [
        "catalog-accept",
        "catalog-reject",
        "catalog-apply-style",
      ])
        q(id).disabled = editor.IsReadOnly;
      const pageCount = editor.PageCount,
        pageNumber = editor.PageNumber;
      q("page-status").textContent = pageCount
        ? `Page ${pageNumber || 1} of ${pageCount}`
        : "Flow document";
    });
  }
  function SetTheme(theme) {
    ribbon.theme = theme;
    docking.Theme = theme;
    grid.setAttribute("theme", theme);
    viewer.setAttribute("theme", theme);
    const gallery = ribbon.getControl("styles");
    for (const item of gallery?.items || [])
      if (item.style?.color)
        item.style.color = theme === "dark" ? "#a9caff" : "#1f4d78";
    ribbon.invalidate();
    viewer.Refresh();
  }
  const responsive = matchMedia("(max-width: 900px)");
  const arrange = () => {
    if (responsive.matches) {
      hooks.zoom(Math.max(25, Math.floor(((innerWidth - 26) / 794) * 100)));
      if (!docking.Find("navigation")?.IsHidden)
        docking.Find("navigation")?.Hide();
      for (const name of ["properties", "explorer", "graph", "tools"]) {
        const item = docking.Find(name);
        if (item && !item.IsHidden) item.Hide();
      }
    }
  };
  responsive.addEventListener("change", arrange);
  arrange();
  editor.EnableVirtualization = true;
  editor.VirtualizationThreshold = 120;
  editor.addEventListener("pagechange", Refresh);
  editor.addEventListener("paginated", Refresh);
  editor.addEventListener("scroll", updateSpatial, true);
  editor.addEventListener("pointerdown", (event) => {
    if (!event.altKey) return;
    updateSpatial();
    const hits = spatial.Search(
      new Envelope(event.clientX, event.clientY, event.clientX, event.clientY),
    );
    if (hits.length) {
      openCatalog("objects");
      goTo(hits[0].Id);
    }
  });
  SetTheme(document.body.classList.contains("dark") ? "dark" : "light");
  Refresh();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(spatialFrame);
    responsive.removeEventListener("change", arrange);
    subscriptions.forEach(
      (subscription) =>
        subscription.Dispose?.() ?? subscription.unsubscribe?.(),
    );
    lifetime.Dispose();
    rows.dispose();
    predicates.complete();
    grid.Dispose();
    models.forEach((model) => model.Dispose());
    commandService.Dispose();
    fullToolbar.Dispose();
    docking.Dispose();
  };
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) dispose();
    },
    { once: true },
  );
  return {
    Ribbon: ribbon,
    Docking: docking,
    ViewModel: vm,
    Catalog: rows,
    Grid: grid,
    GraphViewer: viewer,
    SpatialIndex: spatial,
    Toolbar: commandService,
    Dispose: dispose,
    Refresh,
    SetTheme,
    SetZoom: hooks.zoom,
    ShowPane: showPane,
    TogglePane: togglePane,
    OpenCatalog: openCatalog,
    ShowGraph: showGraph,
    GoTo: goTo,
    UpdateSpatial: updateSpatial,
    HandleCommand(name) {
      if (name === "navigation") {
        togglePane("navigation");
        return true;
      }
      if (name === "focus") {
        document.body.classList.toggle("focus");
        if (document.body.classList.contains("focus")) {
          docking.Find("navigation")?.Hide();
          for (const id of ["properties", "explorer", "graph", "tools"])
            docking.Find(id)?.Hide();
        }
        return true;
      }
      if (name === "find") {
        showPane("navigation");
        q("find-tools").hidden = false;
        q("find-input").focus();
        return true;
      }
      return false;
    },
  };
}
