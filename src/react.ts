/** Optional React entry point. Importing core/web does not import React. */
import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ForwardedRef, HTMLAttributes } from "react";
import { FlowDocument } from "./model.js";
import {
  RichTextBox,
  RichTextPageEditor,
  registerRichTextWeb,
  type VirtualizationStatistics,
  type PageLayoutResult,
  type PageLayoutPage,
  type DocumentViewMode,
  type PageArrangement,
  type DocumentZoomMode,
} from "./control.js";
import { EquationEditor, registerEquationEditor } from "./equation-control.js";
import type { EquationOptions } from "./equations.js";
import type { TextSelection } from "./engine.js";
import type { ObservableObject } from "./mvvm.js";

interface RichTextControlProps<TControl extends RichTextBox> extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onChange" | "onSelect" | "defaultValue"
> {
  /** Shared mutable document model. Change its identity to replace the editor document. */
  document?: FlowDocument;
  /** Used only when this mounted control is first initialized. */
  defaultDocument?: FlowDocument;
  readOnly?: boolean;
  acceptsTab?: boolean;
  zoom?: number;
  viewMode?: "page" | "continuous";
  documentView?: DocumentViewMode;
  pageArrangement?: PageArrangement;
  zoomMode?: DocumentZoomMode;
  outlineLevel?: number;
  onViewChange?: (
    state: {
      documentView: DocumentViewMode;
      pageArrangement: PageArrangement;
      zoomMode: DocumentZoomMode;
    },
    event: CustomEvent,
  ) => void;
  style?: CSSProperties;
  enableVirtualization?: boolean;
  virtualizationThreshold?: number;
  virtualizationOverscan?: number;
  onVirtualizationChange?: (
    statistics: VirtualizationStatistics,
    event: CustomEvent,
  ) => void;
  onPaginated?: (layout: PageLayoutResult, event: CustomEvent) => void;
  onPageChange?: (
    state: { pageNumber: number; pageCount: number; page?: PageLayoutPage },
    event: CustomEvent,
  ) => void;
  onDocumentChange?: (document: FlowDocument, event: CustomEvent) => void;
  onSelectionChange?: (selection: TextSelection, event: CustomEvent) => void;
  onCommandStateChange?: (
    state: { canUndo: boolean; canRedo: boolean; isReadOnly: boolean },
    event: CustomEvent,
  ) => void;
  onReady?: (editor: TControl) => void;
}

export interface RichTextEditorProps extends RichTextControlProps<RichTextBox> {}
export interface RichTextPagedEditorProps extends RichTextControlProps<RichTextPageEditor> {}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function createEditorComponent<TControl extends RichTextBox>(
  tag: "rich-text-box" | "rich-text-page-editor",
) {
  return forwardRef<TControl, RichTextControlProps<TControl>>(
    function RichTextControl(props, forwardedRef) {
      const {
        document,
        defaultDocument,
        readOnly = false,
        acceptsTab = false,
        zoom = 1,
        viewMode = "page",
        documentView,
        pageArrangement,
        zoomMode,
        outlineLevel,
        onViewChange,
        enableVirtualization = false,
        virtualizationThreshold = 200,
        virtualizationOverscan = 6,
        onVirtualizationChange,
        onPaginated,
        onPageChange,
        onDocumentChange,
        onSelectionChange,
        onCommandStateChange,
        onReady,
        ...attributes
      } = props;
      const [editor, setEditor] = useState<TControl | null>(null);
      const initialized = useRef<TControl | null>(null);
      const attached = useRef<TControl | null>(null);
      const assigningDocument = useRef(false);
      const callbacks = useRef({
        onDocumentChange,
        onSelectionChange,
        onCommandStateChange,
        onReady,
        onVirtualizationChange,
        onPaginated,
        onPageChange,
        onViewChange,
      });
      callbacks.current = {
        onDocumentChange,
        onSelectionChange,
        onCommandStateChange,
        onReady,
        onVirtualizationChange,
        onPaginated,
        onPageChange,
        onViewChange,
      };
      const attach = useCallback(
        (element: HTMLElement | null) => {
          if (element) registerRichTextWeb();
          const control = element as TControl | null;
          const previous = attached.current;
          attached.current = control;
          assignRef(forwardedRef, control);
          setEditor(control);
          if (!control && previous)
            queueMicrotask(() => {
              // React StrictMode/ref identity changes can immediately reattach the same element.
              if (attached.current !== previous && !previous.isConnected)
                previous.Dispose();
            });
        },
        [forwardedRef],
      );

      useEffect(() => {
        if (!editor) return;
        const changed = (event: Event) => {
          if (!assigningDocument.current)
            callbacks.current.onDocumentChange?.(
              editor.Document,
              event as CustomEvent,
            );
        };
        const selected = (event: Event) =>
          callbacks.current.onSelectionChange?.(
            editor.Selection,
            event as CustomEvent,
          );
        const state = (event: Event) =>
          callbacks.current.onCommandStateChange?.(
            (event as CustomEvent).detail,
            event as CustomEvent,
          );
        const virtualized = (event: Event) =>
          callbacks.current.onVirtualizationChange?.(
            (event as CustomEvent).detail.statistics,
            event as CustomEvent,
          );
        const paginated = (event: Event) =>
          callbacks.current.onPaginated?.(
            (event as CustomEvent).detail.layout,
            event as CustomEvent,
          );
        const pageChanged = (event: Event) =>
          callbacks.current.onPageChange?.(
            (event as CustomEvent).detail,
            event as CustomEvent,
          );
        const viewChanged = (event: Event) =>
          callbacks.current.onViewChange?.(
            (event as CustomEvent).detail,
            event as CustomEvent,
          );
        editor.addEventListener("viewchange", viewChanged);
        editor.addEventListener("virtualizationchange", virtualized);
        editor.addEventListener("paginated", paginated);
        editor.addEventListener("pagechange", pageChanged);
        editor.addEventListener("documentchange", changed);
        editor.addEventListener("selectionchange", selected);
        editor.addEventListener("commandstatechange", state);
        return () => {
          editor.removeEventListener("viewchange", viewChanged);
          editor.removeEventListener("virtualizationchange", virtualized);
          editor.removeEventListener("paginated", paginated);
          editor.removeEventListener("pagechange", pageChanged);
          editor.removeEventListener("documentchange", changed);
          editor.removeEventListener("selectionchange", selected);
          editor.removeEventListener("commandstatechange", state);
        };
      }, [editor]);

      useEffect(() => {
        if (!editor) return;
        assigningDocument.current = true;
        try {
          if (document && editor.Document !== document)
            editor.Document = document;
          else if (
            !document &&
            initialized.current !== editor &&
            defaultDocument
          )
            editor.Document = defaultDocument;
          editor.IsReadOnly = readOnly;
          editor.AcceptsTab = acceptsTab;
          if (editor.Zoom !== zoom && (!zoomMode || zoomMode === "Custom"))
            editor.Zoom = zoom;
          if (editor instanceof RichTextPageEditor && documentView)
            editor.DocumentView = documentView;
          else if (editor.ViewMode !== viewMode) editor.ViewMode = viewMode;
          if (editor instanceof RichTextPageEditor) {
            if (pageArrangement && editor.PageArrangement !== pageArrangement)
              editor.PageArrangement = pageArrangement;
            if (zoomMode && editor.ZoomMode !== zoomMode)
              editor.ZoomMode = zoomMode;
            if (
              outlineLevel !== undefined &&
              editor.OutlineLevel !== outlineLevel
            )
              editor.OutlineLevel = outlineLevel;
          }
          if (editor.VirtualizationThreshold !== virtualizationThreshold)
            editor.VirtualizationThreshold = virtualizationThreshold;
          if (editor.VirtualizationOverscan !== virtualizationOverscan)
            editor.VirtualizationOverscan = virtualizationOverscan;
          if (editor.EnableVirtualization !== enableVirtualization)
            editor.EnableVirtualization = enableVirtualization;
          if (initialized.current !== editor) {
            initialized.current = editor;
            callbacks.current.onReady?.(editor);
          }
        } finally {
          assigningDocument.current = false;
        }
      }, [
        editor,
        document,
        defaultDocument,
        readOnly,
        acceptsTab,
        zoom,
        viewMode,
        documentView,
        pageArrangement,
        zoomMode,
        outlineLevel,
        enableVirtualization,
        virtualizationThreshold,
        virtualizationOverscan,
      ]);

      return createElement(tag, { ...attributes, ref: attach });
    },
  );
}

/** Works with React 18 and 19; ref exposes the actual RichTextBox control. */
export const RichTextEditor =
  createEditorComponent<RichTextBox>("rich-text-box");
/** Finite page editing with the same React document, lifecycle, events and virtualization props. */
export const RichTextPagedEditor = createEditorComponent<RichTextPageEditor>(
  "rich-text-page-editor",
);

/** Subscribes React to a mutable FlowDocument using a stable numeric snapshot. */
export function useDocumentRevision(document: FlowDocument): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = document.Changed.Subscribe(notify);
      return () => subscription.Dispose();
    },
    [document],
  );
  const snapshot = useCallback(() => document.Revision, [document]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Creates one model per component instance and rerenders on document mutations. */
export function useFlowDocument(
  initial?: FlowDocument | (() => FlowDocument),
): FlowDocument {
  const [document] = useState(() =>
    typeof initial === "function" ? initial() : (initial ?? new FlowDocument()),
  );
  useDocumentRevision(document);
  return document;
}

/** Select an observable property; object values should be replaced to notify React. */
export function useObservableProperty<T>(
  source: ObservableObject,
  propertyName: string,
  defaultValue?: T,
): T {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = source.PropertyChanged.Subscribe((args) => {
        if (!args.PropertyName || args.PropertyName === propertyName) notify();
      });
      return () => subscription.Dispose();
    },
    [source, propertyName],
  );
  const snapshot = useCallback(
    () => source.GetProperty<T>(propertyName, defaultValue),
    [source, propertyName, defaultValue],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface ReactEquationEditorProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onChange" | "defaultValue"
> {
  value?: EquationOptions;
  defaultValue?: EquationOptions;
  readOnly?: boolean;
  onValueChange?: (value: EquationOptions, event: CustomEvent) => void;
  onValidationChange?: (
    state: { isValid: boolean; error: string },
    event: CustomEvent,
  ) => void;
  onReady?: (editor: EquationEditor) => void;
}
/** Controlled/uncontrolled React math workbench using the same web component and local history. */
export const ReactEquationEditor = forwardRef<
  EquationEditor,
  ReactEquationEditorProps
>(function ReactEquationEditor(props, forwardedRef) {
  const {
    value,
    defaultValue,
    readOnly = false,
    onValueChange,
    onValidationChange,
    onReady,
    ...attributes
  } = props;
  const [editor, setEditor] = useState<EquationEditor | null>(null);
  const attached = useRef<EquationEditor | null>(null),
    initialized = useRef<EquationEditor | null>(null);
  const callbacks = useRef({ onValueChange, onValidationChange, onReady });
  callbacks.current = { onValueChange, onValidationChange, onReady };
  const attach = useCallback(
    (node: HTMLElement | null) => {
      if (node) registerEquationEditor();
      const previous = attached.current,
        control = node as EquationEditor | null;
      attached.current = control;
      assignRef(forwardedRef, control);
      setEditor(control);
      if (!control && previous)
        queueMicrotask(() => {
          if (attached.current !== previous && !previous.isConnected)
            previous.Dispose();
        });
    },
    [forwardedRef],
  );
  useEffect(() => {
    if (!editor) return;
    const change = (event: Event) =>
      callbacks.current.onValueChange?.(editor.Value, event as CustomEvent);
    const validation = (event: Event) =>
      callbacks.current.onValidationChange?.(
        (event as CustomEvent).detail,
        event as CustomEvent,
      );
    editor.addEventListener("equationchange", change);
    editor.addEventListener("validationchange", validation);
    return () => {
      editor.removeEventListener("equationchange", change);
      editor.removeEventListener("validationchange", validation);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    if (initialized.current !== editor) {
      if (value ?? defaultValue) editor.Value = (value ?? defaultValue)!;
      editor.IsReadOnly = readOnly;
      initialized.current = editor;
      callbacks.current.onReady?.(editor);
    }
    const same =
      value &&
      value.Source === editor.Source &&
      (value.Format ?? "latex") === editor.Format &&
      !!value.DisplayMode === editor.DisplayMode &&
      (value.AlternativeText ?? "") === (editor.Value.AlternativeText ?? "");
    if (value && !same) editor.Value = value;
    if (editor.IsReadOnly !== readOnly) editor.IsReadOnly = readOnly;
  }, [editor, value, defaultValue, readOnly]);
  return createElement("rich-equation-editor", { ...attributes, ref: attach });
});
