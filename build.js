// Assemble the static site + the bundled Worker into ./dist for Cloudflare Pages.
//
// Two jobs:
//   1. Copy the servable static files (index.html, src/, data/, assets/) so
//      node_modules never ends up as a served asset — that broke the first
//      deploy (wrangler tried to serve node_modules/workerd, 122 MiB).
//   2. Pre-bundle src/worker.js into dist/_worker.js with esbuild, inlining the
//      wasm as bytes. Pages runs this _worker.js directly (advanced mode) rather
//      than compiling a functions/ dir — its bundler can't handle satori +
//      yoga-wasm-web + @resvg/resvg-wasm.
//
// _worker.js intercepts /og and / (OG rewrite) and passes everything else to
// static assets via env.ASSETS, so the static files below still ship.

import { cp, rm, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const OUT = "dist";

// Files/dirs the browser needs at runtime. (The Worker reaches data/ + assets/
// via env.ASSETS, so they must be present too.)
const INCLUDE = ["index.html", "src", "data", "assets"];

// Keep tests and the server-only worker source out of the shipped static tree.
const EXCLUDE = new Set(["encoding.test.js", "worker.js"]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of INCLUDE) {
  await cp(entry, `${OUT}/${entry}`, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(src.split(/[\\/]/).pop()),
  });
}

// Bundle the Worker. `.wasm` -> binary (Uint8Array), which initWasm()/initYoga()
// accept directly. Target the Workers runtime (esm, browser conditions).
await build({
  entryPoints: ["src/worker.js"],
  outfile: `${OUT}/_worker.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".wasm": "binary" },
  legalComments: "none",
});

console.log(`Built ${OUT}/ (static + _worker.js)`);
