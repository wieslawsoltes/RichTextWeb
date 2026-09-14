import { build } from "esbuild";
import { mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
await rm("site", { recursive: true, force: true });
await mkdir("site", { recursive: true });
await cp("sample", "site", { recursive: true });
await build({
  entryPoints: ["sample/app.js"],
  outfile: "site/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  keepNames: true, // Dockyard persists public layout class names.
  sourcemap: true,
  legalComments: "linked",
});
await build({
  entryPoints: ["src/pdf.ts"],
  outfile: "site/richtextweb.pdf.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await mkdir("site/pdf-assets", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "site/pdf-assets/pdf.worker.mjs",
);
for (const directory of ["cmaps", "wasm", "iccs"])
  await cp(
    `node_modules/pdfjs-dist/${directory}`,
    `site/pdf-assets/${directory}`,
    { recursive: true },
  );
await cp("node_modules/pdfjs-dist/LICENSE", "site/pdf-assets/LICENSE");
const samplePackages = [
  ["ribbon-web", "RibbonWeb", "MIT"],
  ["dockyard", "Dockyard", "MIT"],
  ["treedatagridweb", "TreeDataGridWeb", "MIT"],
  ["dynamicdataweb", "DynamicDataWeb", "MIT"],
  ["reactiveweb", "ReactiveWeb", "MIT"],
  ["rbushweb", "RBushWeb", "MIT"],
  ["quikgraphweb", "QuikGraphWeb", "MS-PL"],
];
await mkdir("site/licenses", { recursive: true });
const manifest = [];
for (const [name, repository, license] of samplePackages) {
  const directory = `node_modules/@wieslawsoltes/${name}`;
  const metadata = JSON.parse(
    await readFile(`${directory}/package.json`, "utf8"),
  );
  await cp(`${directory}/LICENSE`, `site/licenses/${name}.txt`);
  manifest.push({
    Name: metadata.name,
    Version: metadata.version,
    License: license,
    Repository: `https://github.com/wieslawsoltes/${repository}`,
    LicenseFile: `licenses/${name}.txt`,
  });
}
await cp("node_modules/rxjs/LICENSE.txt", "site/licenses/rxjs.txt");
const rxjs = JSON.parse(
  await readFile("node_modules/rxjs/package.json", "utf8"),
);
manifest.push({
  Name: "rxjs",
  Version: rxjs.version,
  License: "Apache-2.0",
  LicenseFile: "licenses/rxjs.txt",
});
for (const [name, license] of [
  ["mathjax-full", "Apache-2.0"],
  ["mhchemparser", "Apache-2.0"],
]) {
  await cp(
    `node_modules/${name}/${name === "mhchemparser" ? "LICENSE.txt" : "LICENSE"}`,
    `site/licenses/${name}.txt`,
  );
  const metadata = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  manifest.push({
    Name: name,
    Version: metadata.version,
    License: license,
    LicenseFile: `licenses/${name}.txt`,
  });
}
await writeFile(
  "site/sample-dependencies.json",
  JSON.stringify(manifest, null, 2),
);
await writeFile("site/.nojekyll", "");
console.log("GitHub Pages sample built in site/.");
