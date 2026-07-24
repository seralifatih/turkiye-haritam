// Assemble the static site into ./dist for Cloudflare Pages.
//
// Pages serves ONLY the build-output directory (dist/), so node_modules and
// other build-time files never end up as servable assets — that was what broke
// the first deploy (wrangler tried to serve node_modules/workerd, 122 MiB).
//
// The Pages Functions in ./functions are compiled separately by Pages and are
// NOT copied here. They import from ../src and fetch /data + /assets over HTTP
// at runtime, so those directories must ship in dist/.

import { cp, rm, mkdir } from "node:fs/promises";

const OUT = "dist";

// Files/dirs the browser (or the Functions, via origin fetch) need at runtime.
const INCLUDE = [
  "index.html",
  "src",      // ES modules imported by index.html AND by the Functions
  "data",     // provinces.topo.json (fetched by client and /og)
  "assets",   // fonts (fetched by /og)
];

// Keep test files out of the shipped bundle.
const EXCLUDE = new Set(["encoding.test.js"]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of INCLUDE) {
  await cp(entry, `${OUT}/${entry}`, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(src.split(/[\\/]/).pop()),
  });
}

console.log(`Built ${OUT}/ from: ${INCLUDE.join(", ")}`);
