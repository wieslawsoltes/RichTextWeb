/** Validate the publishable tarball from an isolated consumer, rather than importing source. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryManifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const tarballOption = process.argv.indexOf("--tarball");
if (tarballOption >= 0 && !process.argv[tarballOption + 1])
  throw new Error("--tarball requires an archive path");
const suppliedTarball =
  tarballOption >= 0
    ? process.argv[tarballOption + 1]
    : process.env.RELEASE_TARBALL;
const temporary = await mkdtemp(join(tmpdir(), "richtextweb-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
try {
  let packed;
  let manifest;
  if (suppliedTarball) {
    // The release job verifies its downloaded artifact without rebuilding or repacking it.
    const source = resolve(suppliedTarball);
    const archive = join(temporary, "release-package.tgz");
    await copyFile(source, archive);
    const names = run("tar", ["-tzf", archive]).split("\n").filter(Boolean);
    for (const name of names)
      assert.ok(
        name.startsWith("package/") &&
          !name.split("/").includes("..") &&
          !name.includes("\\"),
        `Unsafe archive path: ${name}`,
      );
    const details = run("tar", ["-tvzf", archive]).split("\n").filter(Boolean);
    for (const line of details)
      assert.ok(
        line[0] === "-" || line[0] === "d",
        "Release archive must contain only regular files and directories",
      );
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    run("tar", [
      "-xzf",
      archive,
      "--directory",
      unpacked,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    manifest = JSON.parse(
      await readFile(join(unpacked, "package/package.json"), "utf8"),
    );
    assert.equal(
      manifest.name,
      repositoryManifest.name,
      "Release artifact package name must match this repository",
    );
    packed = {
      filename: "release-package.tgz",
      files: names
        .filter((name) => !name.endsWith("/"))
        .map((name) => ({ path: name.slice("package/".length) })),
      size: (await stat(archive)).size,
    };
  } else {
    [packed] = JSON.parse(
      run(
        npm,
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        root,
      ),
    );
    manifest = repositoryManifest;
  }
  assert.ok(packed?.filename, "npm pack must produce a tarball");
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of [
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "src/model.ts",
    "dist/richtextweb.global.js",
    "dist/types/index.d.ts",
    "dist/types/core.d.ts",
    "dist/types/react.d.ts",
    "dist/types/collaboration-document.d.ts",
    "dist/types/pdf-operators.d.ts",
  ])
    assert.ok(files.has(file), `Missing published file: ${file}`);
  assert.ok(
    !manifest.dependencies?.["mathjax-full"],
    "Math renderer must be privately bundled",
  );
  for (const path of files)
    assert.ok(
      !/\.(?:ttf|otf|woff2?|pfb)$/i.test(path),
      `Do not distribute font binaries: ${path}`,
    );
  for (const path of files)
    assert.ok(
      !/(^|\/)(node_modules|\.git|\.env)(\/|$)/.test(path),
      `Unexpected private/build dependency file in package: ${path}`,
    );
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (typeof entry === "string") {
      assert.ok(
        files.has(entry.replace(/^\.\//, "")),
        `Missing export ${subpath}`,
      );
      continue;
    }
    for (const condition of ["types", "import", "require"])
      assert.ok(
        files.has(entry[condition].replace(/^\.\//, "")),
        `Missing ${condition} target for ${subpath}`,
      );
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "richtextweb-package-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
  const install = [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--offline",
    join(temporary, packed.filename),
    `react@${manifest.devDependencies.react}`,
    `@types/react@${manifest.devDependencies["@types/react"]}`,
  ];
  if (process.env.RICHTEXTWEB_PACKAGE_OFFLINE !== "1")
    install.splice(install.indexOf("--offline"), 1);
  run(npm, install, consumer);

  const assertions = `
assert.equal(root.FlowDocument, core.FlowDocument, 'root/core must share model constructors');
assert.equal(root.RichTextEngine, core.RichTextEngine, 'root/core must share engine constructors');
assert.equal(root.RichTextBox, web.RichTextBox, 'root/web must share control constructors');
assert.equal(root.DocumentSerializer, formats.DocumentSerializer, 'root/formats must share serializer identity');
assert.equal(root.ObservableObject, mvvm.ObservableObject, 'root/mvvm must share observable constructors');
assert.equal(root.RichTextWebBridge, bridge.RichTextWebBridge, 'root/bridge must share bridge constructors');
assert.ok(react.RichTextEditor, 'optional React component must import');
assert.equal(root.DocumentFeatures, features.DocumentFeatures);
assert.equal(root.Equation, core.Equation);
const math = root.renderEquation({Source:'\\\\frac{a}{b}',DisplayMode:true});
assert.match(math.SVG, /<path/); assert.match(math.MathML, /mfrac/);
const equation = new core.Equation('x^2');
const equationDocument = new core.FlowDocument(new core.Paragraph(equation));
assert.equal(equationDocument.Text, '\uFFFC');
assert.ok(formats.fromHTML(formats.toHTML(equationDocument)).Blocks.Get(0).Inlines.Get(0) instanceof core.Equation);

assert.equal(root.CollaborativeTextSession, collaboration.CollaborativeTextSession);
assert.equal(root.RichTextToolbar, web.RichTextToolbar);
assert.equal(typeof pdf.fromPDF, 'function');
assert.equal(typeof pdf.PDFEditorControl, 'function');
assert.equal(root.RichTextPageEditor, web.RichTextPageEditor);
assert.equal(root.Figure, core.Figure); assert.equal(root.Floater, core.Floater);
assert.equal(root.CollaborativeDocumentSession, collaboration.CollaborativeDocumentSession);
assert.equal(core.CollaborativeDocumentSession, collaboration.CollaborativeDocumentSession);
assert.equal(root.PDFEditor, pdf.PDFEditor);
assert.ok(react.RichTextPagedEditor, 'optional paged React component must import');
const registeredControls = new Map();
web.registerRichTextWeb({ get: name => registeredControls.get(name), define: (name, constructor) => registeredControls.set(name, constructor) });
assert.equal(registeredControls.get('rich-text-page-editor'), root.RichTextPageEditor);
assert.equal(typeof web.RichTextPageEditor.prototype.GoToPage, 'function');
assert.ok(Object.getOwnPropertyDescriptor(web.RichTextBox.prototype, 'EnableVirtualization')?.set);
const figure = new core.Figure(new core.Paragraph('floating figure'));
figure.Width = new core.FigureLength(0.5, core.FigureUnitType.Content);
const floater = new core.Floater(new core.Paragraph('floating note')); floater.Width = 120;
const floating = new core.FlowDocument(new core.Paragraph([new core.Run('before'), figure, floater, new core.Run('after')]));
const restoredFloating = core.FlowDocument.FromJSON(floating.ToJSON());
assert.equal(restoredFloating.Text, 'before\uFFFC\uFFFCafter');
assert.ok(restoredFloating.FindById(figure.Id) instanceof core.Figure);
assert.equal(restoredFloating.FindById(figure.Id).Width.FigureUnitType, 'Content');
assert.equal(restoredFloating.FindById(floater.Id).Width, 120);
class PackageOwner extends core.DependencyObject {}
class PackageDerived extends PackageOwner {}
const property = core.DependencyProperty.Register('PackageAmount', Number, PackageOwner,
  new core.FrameworkPropertyMetadata(2, core.FrameworkPropertyMetadataOptions.BindsTwoWayByDefault, undefined, (_owner, value) => Math.min(10, value)), value => value >= 0);
property.OverrideMetadata(PackageDerived, new core.PropertyMetadata(4));
const propertyOwner = new PackageDerived(); assert.equal(propertyOwner.GetValue(property), 4);
propertyOwner.SetValue(property, 20); assert.equal(propertyOwner.GetValue(property), 10);
propertyOwner.ClearValue(property); assert.equal(propertyOwner.GetValue(property), 4);
const readOnlyKey = core.DependencyProperty.RegisterReadOnly('PackageStatus', Number, PackageOwner, new core.PropertyMetadata(0));
propertyOwner.SetValue(readOnlyKey, 3); assert.equal(propertyOwner.GetValue(readOnlyKey.DependencyProperty), 3);
assert.throws(() => propertyOwner.SetValue(readOnlyKey.DependencyProperty, 9), /read.only|key/i);
const sharedSeed = new core.FlowDocument(new core.Paragraph('shared')).ToJSON();
const peerA = new collaboration.CollaborativeDocumentSession({ DocumentId: 'package', ActorId: 'alice', Document: sharedSeed });
const peerB = new collaboration.CollaborativeDocumentSession({ DocumentId: 'package', ActorId: 'bob', Document: sharedSeed });
const textChange = peerA.ReplaceText(sharedSeed.children[0].children[0].id, 0, 0, 'A ');
const propertyChange = peerB.SetProperty(sharedSeed.children[0].id, 'TextAlignment', 'Center');
peerB.Receive(textChange); peerA.Receive(propertyChange);
assert.deepEqual(peerA.DocumentJSON, peerB.DocumentJSON); assert.equal(peerA.Text, 'A shared');
const checkpoint = peerA.CreateCheckpoint({ alice: peerA.VersionVector, bob: peerB.VersionVector });
peerA.AdoptCheckpoint(checkpoint); peerB.AdoptCheckpoint(checkpoint);
assert.equal(peerA.Statistics.Operations, 0); assert.deepEqual(peerA.DocumentJSON, peerB.DocumentJSON);
const originalPDF = await pdf.PDFEditor.Create(); originalPDF.AddPage(240, 160);
await originalPDF.AddText(0, 'Original source', { x: 20, y: 90, fontSize: 12 });
const inspection = await originalPDF.GetTextOperators(0), sourceOperator = inspection.operators.find(item => item.text === 'Original source');
assert.ok(sourceOperator?.editable, 'installed PDF engine must inspect an editable original operator');
const sourceEdit = await originalPDF.ReplaceTextOperator(0, sourceOperator.id, 'Revised source', { expectedText: sourceOperator.text });
assert.equal(sourceEdit.operatorsChanged, 1);
const reopenedPDF = await pdf.PDFEditor.Load(await originalPDF.Save());
assert.ok((await reopenedPDF.GetTextOperators()).operators.some(item => item.text === 'Revised source'));
const sourceReplace = await reopenedPDF.ReplaceSourceText('Revised', 'Final', { pageIndices: [0], caseSensitive: true });
assert.equal(sourceReplace.occurrences, 1);
assert.ok((await reopenedPDF.GetTextOperators()).operators.some(item => item.text === 'Final source'));
assert.equal(typeof pdf.PDFEditorControl.prototype.ReplaceTextOperator, 'function');
assert.equal(typeof pdf.PDFEditorControl.prototype.ReplaceSourceText, 'function');
const document = new core.FlowDocument(new core.Paragraph('published package'));
const engine = new root.RichTextEngine(document);
engine.Select(0, 9); engine.InsertText('installed');
assert.equal(document.Text, 'installed package');
engine.Undo(); assert.equal(document.Text, 'published package');
const imported = formats.fromMarkdown('**Rich text**');
assert.ok(imported instanceof core.FlowDocument, 'formats must construct the core FlowDocument type');
assert.equal(new core.TextPointer(imported, 0).Document, imported);
assert.match(formats.toHTML(imported), /Rich text/);
const model = new mvvm.ObservableObject({ Title: 'first' });
let title; const subscription = model.PropertyChanged.Subscribe(event => { title = event.NewValue; });
model.SetProperty('Title', 'second'); assert.equal(title, 'second'); subscription.Dispose();
const messages = []; const transport = new bridge.RichTextWebBridge(engine, message => messages.push(message));
const result = transport.HandleMessage({ channel: 'richtextweb', version: 1, kind: 'request', id: 'package-test', method: 'setDocument', params: { document: imported.ToJSON() } });
assert.equal(result.error, undefined, result.error?.message);
assert.ok(engine.Document instanceof core.FlowDocument, 'bridge must construct the core FlowDocument type');
assert.equal(engine.Document.Text, 'Rich text');
transport.Dispose(); engine.Dispose(); model.Dispose();
`;
  const entries = [
    ["root", ""],
    ["core", "/core"],
    ["web", "/web"],
    ["formats", "/formats"],
    ["mvvm", "/mvvm"],
    ["bridge", "/bridge"],
    ["react", "/react"],
    ["features", "/document"],
    ["collaboration", "/collaboration"],
    ["pdf", "/pdf"],
  ];
  const esm = `import assert from 'node:assert/strict';\n${entries.map(([name, suffix]) => `import * as ${name} from '${manifest.name}${suffix}';`).join("\n")}\nawait (async () => {${assertions}})();\nconsole.log('Installed ESM consumer passed.');\n`;
  const cjs = `const assert = require('node:assert/strict');\n${entries.map(([name, suffix]) => `const ${name} = require('${manifest.name}${suffix}');`).join("\n")}\n(async () => {${assertions}\nconsole.log('Installed CommonJS consumer passed.');\n})().catch(error => { console.error(error); process.exitCode = 1; });\n`;
  await writeFile(join(consumer, "consumer.mjs"), esm);
  await writeFile(join(consumer, "consumer.cjs"), cjs);
  process.stdout.write(run(process.execPath, ["consumer.mjs"], consumer));
  process.stdout.write(run(process.execPath, ["consumer.cjs"], consumer));

  const typeConsumer = `
import { FlowDocument, Paragraph, Run, RichTextEngine, TextPointer, TextElement, Figure, Floater, FigureLength, FigureUnitType, DependencyObject, DependencyProperty, FrameworkPropertyMetadata, FrameworkPropertyMetadataOptions, PropertyMetadata, type PropertyChangedEvent } from '${manifest.name}/core';
import { RichTextBox, RichTextPageEditor, type VirtualizationStatistics } from '${manifest.name}/web';
import { toHTML, fromMarkdown, DocumentSerializer } from '${manifest.name}/formats';
import { ObservableObject, RelayCommand, Binding, BindingMode } from '${manifest.name}/mvvm';
import { RichTextEditor, RichTextPagedEditor, type RichTextEditorProps, type RichTextPagedEditorProps } from '${manifest.name}/react';
import { RichTextWebBridge, type BridgeOutgoingMessage } from '${manifest.name}/bridge';
import { createElement, createRef } from 'react';
import { DocumentFeatures } from '${manifest.name}/document';
import { CollaborativeTextSession, CollaborativeDocumentSession, type RichDocumentOperation, type RichDocumentSnapshot } from '${manifest.name}/collaboration';
import { fromPDF, PDFEditor, PDFEditorControl, type PDFTextInspection, type PDFTextEditResult, type PDFTextReplacementOptions, type PDFSourceTextReplaceOptions } from '${manifest.name}/pdf';
const document = new FlowDocument(new Paragraph(new Run('typed consumer')));
const engine = new RichTextEngine(document);
engine.ApplyProperty(TextElement.FontWeightProperty.Name, 'Bold');
const position: TextPointer = document.ContentStart;
const element = createElement(RichTextEditor, { document, onDocumentChange: next => console.log(next.Text) } satisfies RichTextEditorProps);
const reference: RichTextBox | null = null;
const html: string = toHTML(fromMarkdown('**typed**'));
const serialized: string = DocumentSerializer.Serialize(document);
const model = new ObservableObject({ Name: 'consumer' });
const command = new RelayCommand<string>(value => console.log(value));
const transport = new RichTextWebBridge(engine, (message: BridgeOutgoingMessage) => console.log(message.kind));
const figure = new Figure(new Paragraph('figure'));
figure.Width = new FigureLength(0.5, FigureUnitType.Content);
const floater = new Floater(new Paragraph('note')); floater.Width = 120;
class ConsumerObject extends DependencyObject {}
const typedProperty = DependencyProperty.Register<number>('TypedAmount', Number, ConsumerObject,
  new FrameworkPropertyMetadata<number>(1, FrameworkPropertyMetadataOptions.AffectsMeasure,
    (_owner, event: PropertyChangedEvent<number>) => console.log(event.NewValue), (_owner, value) => Math.max(0, value)));
typedProperty.OverrideMetadata(class DerivedConsumer extends ConsumerObject {}, new PropertyMetadata<number>(2));
const pagedRef = createRef<RichTextPageEditor>();
const pagedElement = createElement(RichTextPagedEditor, { document, ref: pagedRef, onReady: control => control.GoToPage(1) } satisfies RichTextPagedEditorProps & { ref: typeof pagedRef });
const standardRef = createRef<RichTextBox>();
const virtualElement = createElement(RichTextEditor, { document, ref: standardRef, enableVirtualization: true, virtualizationThreshold: 80, virtualizationOverscan: 4 } satisfies RichTextEditorProps & { ref: typeof standardRef });
function configureControl(control: RichTextPageEditor): Promise<number> {
  control.EnableVirtualization = true; control.VirtualizationThreshold = 80; control.VirtualizationOverscan = 4;
  const statistics: Readonly<VirtualizationStatistics> = control.VirtualizationStatistics;
  void statistics; return control.Repaginate().then(layout => layout.PageCount);
}
const richSession = new CollaborativeDocumentSession({ DocumentId: 'typed', ActorId: 'consumer', Document: document });
const snapshot: RichDocumentSnapshot = richSession.ExportSnapshot();
const resumed = CollaborativeDocumentSession.FromSnapshot(snapshot, 'consumer-2');
const operation: RichDocumentOperation | undefined = richSession.ReplaceText(document.Blocks.at(0)!.Children[0].Id, 0, 0, 'text');
if (operation) resumed.Receive(operation);
async function editOriginalPDF(editor: PDFEditor, control: PDFEditorControl): Promise<PDFTextEditResult> {
  const inspection: PDFTextInspection = await editor.GetTextOperators(0);
  const options: PDFTextReplacementOptions = { preserveAdvance: true, expectedText: inspection.operators[0].text ?? '' };
  const result = await editor.ReplaceTextOperator(0, inspection.operators[0].id, 'updated', options);
  const searchOptions: PDFSourceTextReplaceOptions = { pageIndices: [0], all: true, allowPartial: false };
  await editor.ReplaceSourceText('updated', 'final', searchOptions);
  await control.ReplaceTextOperator(0, inspection.operators[0].id, 'updated', options);
  await control.ReplaceSourceText('updated', 'final', searchOptions);
  return result;
}
void [position, element, reference, html, serialized, model, command, transport, Binding, BindingMode, pagedElement, virtualElement, configureControl, editOriginalPDF, figure, floater];
`;
  await writeFile(join(consumer, "consumer.mts"), typeConsumer);
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
        },
        files: ["consumer.mts"],
      },
      null,
      2,
    ),
  );
  run(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    consumer,
  );
  console.log(
    "Installed TypeScript consumer passed across all public entry points.",
  );

  const browserCode = await readFile(
    join(
      consumer,
      "node_modules",
      ...manifest.name.split("/"),
      "dist/richtextweb.global.js",
    ),
    "utf8",
  );
  const context = vm.createContext({
    EventTarget,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    console,
    atob,
    btoa,
    performance,
  });
  vm.runInContext(browserCode, context, {
    timeout: 10000,
    filename: "richtextweb.global.js",
  });
  assert.equal(typeof context.RichTextWeb?.FlowDocument, "function");
  const standalone = vm.runInContext(
    "new RichTextWeb.FlowDocument(new RichTextWeb.Paragraph('standalone')).Text",
    context,
  );
  assert.equal(standalone, "standalone");
  // A bare Node VM omits structuredClone. These standalone fixtures contain JSON values only.
  vm.runInContext(
    "globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));",
    context,
  );
  const standaloneFeatures = await vm.runInContext(
    `(async () => {
    const RT = RichTextWeb, figure = new RT.Figure(new RT.Paragraph('floating'));
    figure.Width = new RT.FigureLength(0.5, RT.FigureUnitType.Content);
    const floating = RT.FlowDocument.FromJSON(new RT.FlowDocument(new RT.Paragraph([figure, new RT.Floater(new RT.Paragraph('note'))])).ToJSON());
    class ConsumerOwner extends RT.DependencyObject {}
    const key = RT.DependencyProperty.RegisterReadOnly('StandaloneStatus', Number, ConsumerOwner, new RT.PropertyMetadata(0));
    const owner = new ConsumerOwner(); owner.SetValue(key, 5);
    const seed = new RT.FlowDocument(new RT.Paragraph('shared')).ToJSON();
    const a = new RT.CollaborativeDocumentSession({ DocumentId: 'standalone', ActorId: 'alice', Document: seed });
    const b = new RT.CollaborativeDocumentSession({ DocumentId: 'standalone', ActorId: 'bob', Document: seed });
    b.Receive(a.ReplaceText(seed.children[0].children[0].id, 0, 0, 'installed '));
    const pdf = await RT.PDFEditor.Create(); pdf.AddPage(240, 160); await pdf.AddText(0, 'Original', { x: 20, y: 80 });
    const inspected = await pdf.GetTextOperators(), op = inspected.operators.find(item => item.text === 'Original');
    await pdf.ReplaceTextOperator(0, op.id, 'Changed', { expectedText: 'Original' });
    const reopened = await RT.PDFEditor.Load(await pdf.Save());
    return { floatingText: floating.Text, width: floating.FindById(figure.Id).Width.FigureUnitType,
      readOnly: owner.GetValue(key.DependencyProperty), sharedText: b.Text,
      pageEditor: typeof RT.RichTextPageEditor, pdfText: (await reopened.GetTextOperators()).operators[0].text };
  })()`,
    context,
    { timeout: 10000 },
  );
  assert.equal(standaloneFeatures.floatingText, "\uFFFC\uFFFC");
  assert.equal(standaloneFeatures.width, "Content");
  assert.equal(standaloneFeatures.readOnly, 5);
  assert.equal(standaloneFeatures.sharedText, "installed shared");
  assert.equal(standaloneFeatures.pageEditor, "function");
  assert.equal(standaloneFeatures.pdfText, "Changed");
  console.log(
    `Standalone browser bundle passed without module resolution. Tarball: ${packed.files.length} files, ${packed.size.toLocaleString()} bytes compressed.`,
  );
} catch (error) {
  if (error?.stdout) process.stderr.write(String(error.stdout));
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
