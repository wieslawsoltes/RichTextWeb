import installedTypeScript from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Declaration inventory only. Presence is not semantic or behavioral coverage.
const root = fileURLToPath(new URL("../", import.meta.url));
let ts = installedTypeScript,
  api,
  snapshot,
  program;
try {
  if (!ts.createSourceFile) {
    ts = await import("typescript/unstable/ast");
    const { API } = await import("typescript/unstable/sync");
    api = new API({ cwd: root });
    snapshot = api.updateSnapshot({
      openProjects: [path.join(root, "tsconfig.json")],
    });
    program = snapshot.getProject(path.join(root, "tsconfig.json")).program;
  }
  const exported = (node) =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const hidden = (node) =>
    node.modifiers?.some(
      (m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword,
    );
  const inventory = [];
  for (const file of (await readdir(path.join(root, "src")))
    .filter((f) => f.endsWith(".ts"))
    .sort()) {
    const text = await readFile(path.join(root, "src", file), "utf8");
    const source = program
      ? program.getSourceFile(path.join(root, "src", file))
      : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!source) throw new Error(`Cannot parse ${file}`);
    const declarations = [];
    for (const node of source.statements) {
      if (ts.isExportDeclaration(node)) {
        declarations.push({ Kind: "Reexport", Text: node.getText(source) });
        continue;
      }
      if (!exported(node)) continue;
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations)
          declarations.push({
            Kind: "Variable",
            Name: declaration.name.getText(source),
          });
        continue;
      }
      const name = node.name?.getText(source);
      if (!name) continue;
      const entry = {
        Kind: ts.SyntaxKind[node.kind],
        Name: name,
        Line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      };
      if (ts.isClassDeclaration(node)) {
        entry.DeclaredPublicMembers = node.members
          .filter(
            (member) =>
              !hidden(member) &&
              (!member.name || !ts.isPrivateIdentifier(member.name)),
          )
          .map((member) => ({
            Kind: ts.SyntaxKind[member.kind],
            Name: ts.isConstructorDeclaration(member)
              ? "constructor"
              : member.name?.getText(source),
            Line:
              source.getLineAndCharacterOfPosition(member.getStart(source))
                .line + 1,
          }));
      }
      declarations.push(entry);
    }
    inventory.push({ Path: `src/${file}`, Declarations: declarations });
  }
  const tests = (await readdir(path.join(root, "tests")))
    .filter((file) => /\.(?:test\.ts|browser\.mjs)$/.test(file))
    .sort();
  console.log(
    JSON.stringify(
      {
        SchemaVersion: 1,
        Qualification:
          "Declaration inventory, not behavioral coverage or Word parity. Inherited members are not repeated.",
        SourceModules: inventory.length,
        Modules: inventory,
        Tests: tests.map((file) => `tests/${file}`),
      },
      null,
      2,
    ),
  );
} finally {
  snapshot?.dispose();
  api?.close();
}
