import { build } from "esbuild";
import { rm, mkdir, readdir, readFile, writeFile, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
  stdio: "inherit",
});
// Public declarations must not require private build-only renderer dependencies.
for (const name of await readdir("dist/types")) {
  if (!name.endsWith(".d.ts")) continue;
  const declaration = await readFile(`dist/types/${name}`, "utf8");
  if (/from\s+["']mathjax-full|import\s+["']mathjax-full/.test(declaration))
    throw new Error(`Private math dependency leaked into ${name}`);
}
const entries = (await readdir("src"))
  .filter((x) => x.endsWith(".ts"))
  .map((x) => `src/${x}`);
await build({
  entryPoints: entries,
  outdir: "dist/esm",
  bundle: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  packages: "external",
});
await build({
  entryPoints: entries,
  outdir: "dist/cjs",
  bundle: false,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  packages: "external",
});
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/richtextweb.global.js",
  bundle: true,
  format: "iife",
  globalName: "RichTextWeb",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
// Preserve public constructor identity while privately bundling the audited math renderer.
// Neither MathJax's speech-rule engine nor its XML dependencies belong in consumers.
for (const format of ["esm", "cjs"]) {
  const math = await build({
    entryPoints: ["src/equations.ts"],
    outfile: `dist/${format}/equations.js`,
    bundle: true,
    format,
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: true,
    legalComments: "linked",
    metafile: true,
    external: ["./formats-markup.js", "./model.js"],
  });
  if (
    Object.keys(math.metafile.inputs).some((path) =>
      /speech-rule-engine|xmldom/.test(path),
    )
  )
    throw new Error(
      "Unexpected speech/XML dependency in the equation renderer",
    );
}
await mkdir("dist/licenses", { recursive: true });
await cp("node_modules/mathjax-full/LICENSE", "dist/licenses/mathjax.txt");
await cp(
  "node_modules/mhchemparser/LICENSE.txt",
  "dist/licenses/mhchemparser.txt",
);
await writeFile("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }));
await build({
  entryPoints: ["src/pdf.ts"],
  outfile: "dist/richtextweb.pdf.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await mkdir("dist/pdf-assets", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "dist/pdf-assets/pdf.worker.mjs",
);
for (const directory of ["cmaps", "wasm", "iccs"])
  await cp(
    `node_modules/pdfjs-dist/${directory}`,
    `dist/pdf-assets/${directory}`,
    { recursive: true },
  );
await cp("node_modules/pdfjs-dist/LICENSE", "dist/pdf-assets/LICENSE");
console.log(
  "Built ESM, CommonJS, declarations, and standalone browser bundle.",
);
