// Assemble the static site into ./dist for Cloudflare Pages.
//
// This is a pure static site — no server, no Functions, no dependencies. The
// only job here is to copy the servable files into dist/ so that node_modules
// (and anything else at the repo root) never gets served as an asset. That was
// what broke the very first deploy: wrangler tried to serve
// node_modules/workerd (122 MiB) and hit the asset size limit.

import { cp, rm, mkdir } from "node:fs/promises";

const OUT = "dist";

// Everything the browser needs at runtime.
const INCLUDE = ["index.html", "src", "data"];

// Tests don't need to ship.
const EXCLUDE = new Set(["encoding.test.js"]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of INCLUDE) {
  await cp(entry, `${OUT}/${entry}`, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(src.split(/[\\/]/).pop()),
  });
}

console.log(`Built ${OUT}/`);
