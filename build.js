// Assemble the static site + a lightweight Worker entrypoint into ./dist for Cloudflare Pages.
//
// Three jobs:
//   1. Copy the servable static files (index.html, src/, data/, assets/) so
//      node_modules never ends up as a served asset — that broke the first
//      deploy (wrangler tried to serve node_modules/workerd, 122 MiB).
//   2. Emit a tiny dist/_worker.js wrapper that points Pages at src/worker.js.
//   3. Let Cloudflare's compiler handle the wasm imports natively so they stay
//      as precompiled WebAssembly.Module values instead of raw bytes.
//
// _worker.js intercepts /og and / (OG rewrite) and passes everything else to
// static assets via env.ASSETS, so the static files below still ship.

import { cp, rm, mkdir, writeFile } from "node:fs/promises";

const OUT = "dist";

// Files/dirs the browser needs at runtime. (The Worker reaches data/ + assets/
// via env.ASSETS, so they must be present too.)
const INCLUDE = ["index.html", "src", "data", "assets"];

// Keep tests out of the shipped static tree.
const EXCLUDE = new Set(["encoding.test.js"]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of INCLUDE) {
  await cp(entry, `${OUT}/${entry}`, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(src.split(/[\\/]/).pop()),
  });
}

// Keep the root entry tiny so Pages compiles the actual worker source and its
// wasm imports directly.
await writeFile(
  `${OUT}/_worker.js`,
  `export { default } from "./src/worker.js";\n`,
);

console.log(`Built ${OUT}/ (static + _worker.js)`);
