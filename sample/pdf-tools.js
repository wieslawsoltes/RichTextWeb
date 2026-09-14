/** The sample hosts the reusable PDF editor and handles application navigation. */
export async function openPDFTools(RT, toast, flowDocument) {
  const PDF = await import(
    new URL("./richtextweb.pdf.js", window.location.href).href
  );
  const asset = (name) =>
    new URL(`./pdf-assets/${name}`, window.location.href).href;
  PDF.configurePDF({
    workerSrc: asset("pdf.worker.mjs"),
    cMapUrl: asset("cmaps/"),
    wasmUrl: asset("wasm/"),
    iccUrl: asset("iccs/"),
  });
  PDF.registerPDFEditor();
  const dialog = document.createElement("dialog");
  dialog.className = "pdf-workspace-dialog";
  const heading = document.createElement("div");
  heading.className = "dialog-title";
  const title = document.createElement("h2");
  title.textContent = "PDF workspace";
  const close = document.createElement("button");
  close.dataset.close = "";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  heading.append(title, close);
  const control = document.createElement("rich-pdf-editor");
  control.id = "pdf-workspace";
  control.addEventListener("flowdocumentimport", (event) => {
    const editor = window.richTextStudio.editor;
    if (editor.IsReadOnly) {
      toast("Turn off read-only mode to import into the main document.");
      return;
    }
    editor.Engine.ReplaceDocument(
      RT.FlowDocument.FromJSON(event.detail.document.ToJSON()),
    );
    toast(
      "PDF text reconstructed into an editable document. Review reading order and layout.",
    );
  });
  dialog.append(heading, control);
  document.body.append(dialog);
  dialog.showModal();
  dialog.onclose = () => {
    control.Dispose();
    dialog.remove();
  };
  try {
    await control.Load(await RT.toPDF(flowDocument));
  } catch (error) {
    toast(error.message);
  }
}
