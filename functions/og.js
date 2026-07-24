// Cloudflare Pages Function: GET /og?v=<code>
//
// Renders the shared map + legend as a 1200x630 PNG for link previews on X,
// WhatsApp, etc. satori turns an element tree into SVG, @resvg/resvg-wasm turns
// that SVG into a PNG. Turkish text uses an embedded Inter font (never a system
// font — the Workers runtime has none).
//
// Two WASM modules must be initialized explicitly (the Workers runtime forbids
// eager, import-time WebAssembly instantiation):
//   - satori's layout engine, via yoga-wasm-web (yoga.wasm)
//   - resvg's rasterizer (@resvg/resvg-wasm)
// Both .wasm files ship with the deployment and are imported as WebAssembly
// modules, then handed to their init functions.
//
// A missing or malformed ?v= renders an EMPTY map, never an error page: crawlers
// must always get a valid image.

import satori, { init as initSatori } from "satori";
import initYoga from "yoga-wasm-web";
import yogaWasm from "yoga-wasm-web/dist/yoga.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

import { decode, emptyStates, PROVINCE_COUNT } from "../src/encoding.js";
import { LEVELS, colorForState, buildMapSvg } from "../src/geometry.js";

const WIDTH = 1200;
const HEIGHT = 630;

// Both WASM modules are initialized once per isolate and cached across warm
// invocations. initSatori() must run before the first satori() call.
let initReady = null;
function ensureInit() {
  if (!initReady) {
    initReady = Promise.all([
      initYoga(yogaWasm).then((yoga) => initSatori(yoga)),
      initWasm(resvgWasm).catch((e) => {
        // A second initWasm throws "already initialized" — that's fine.
        if (!/already/i.test(String(e && e.message))) throw e;
      }),
    ]).catch((e) => {
      initReady = null; // let the next request retry a failed init
      throw e;
    });
  }
  return initReady;
}

// Fetch a static asset from this same deployment (fonts, topojson) as bytes.
async function fetchBytes(origin, path) {
  const res = await fetch(new URL(path, origin).toString());
  if (!res.ok) throw new Error("asset " + path + " -> " + res.status);
  return await res.arrayBuffer();
}

// Cache the heavy immutable assets across warm invocations.
let assetsCache = null;
async function loadAssets(origin) {
  if (!assetsCache) {
    const [topoBuf, fontSemibold, fontRegular] = await Promise.all([
      fetchBytes(origin, "/data/provinces.topo.json"),
      fetchBytes(origin, "/assets/fonts/Inter-SemiBold.ttf"),
      fetchBytes(origin, "/assets/fonts/Inter-Regular.ttf"),
    ]);
    const topology = JSON.parse(new TextDecoder().decode(topoBuf));
    assetsCache = { topology, fontSemibold, fontRegular };
  }
  return assetsCache;
}

// Build a data-URI <img> src for the colored map SVG.
function mapImageDataUri(topology, states) {
  const fillFor = (plate) => colorForState(states[plate] || 0);
  const { svg } = buildMapSvg(topology, fillFor, {
    width: 1000,
    background: "transparent",
    stroke: "#94a3b8",
    strokeWidth: 0.9,
  });
  // encodeURIComponent keeps the Turkish-free SVG markup valid in a data URI.
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// Minimal hyperscript so we can write the tree without a JSX build step.
// satori accepts React-element-shaped objects: { type, props }.
// Leaf elements must omit `children` entirely — an empty `children: []` trips
// satori's "must have display: flex if it has more than one child" check.
function h(type, props, ...children) {
  const flat = children.flat().filter((c) => c != null && c !== false);
  const p = { ...props };
  if (flat.length === 1) p.children = flat[0];
  else if (flat.length > 1) p.children = flat;
  return { type, props: p };
}

function countVisited(states) {
  let n = 0;
  for (let p = 1; p <= PROVINCE_COUNT; p++) if (states[p] > 0) n++;
  return n;
}

function buildTree(mapSrc, count) {
  // Legend row: three levels with swatch + Turkish label.
  const legendItems = LEVELS.map((lvl) =>
    h("div", { style: { display: "flex", alignItems: "center", gap: "12px" } },
      h("div", { style: { width: "34px", height: "34px", borderRadius: "8px",
        background: lvl.color, border: "1px solid rgba(0,0,0,0.15)" } }),
      h("span", { style: { fontSize: "30px", color: "#0f172a" } }, lvl.label),
    )
  );

  return h("div", {
    style: {
      width: WIDTH + "px", height: HEIGHT + "px", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "space-between",
      background: "#f8fafc", padding: "40px 48px",
      fontFamily: "Inter",
    },
  },
    // Header: title + counter.
    h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" } },
      h("div", { style: { fontSize: "40px", fontWeight: 600, color: "#0f172a" } }, "Türkiye Haritam"),
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", fontSize: "34px", color: "#334155" } },
        h("span", { style: { fontWeight: 600 } }, String(count) + "/81"),
        h("span", {}, "il gezildi")),
    ),
    // The map fills the middle.
    h("div", { style: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", width: "100%" } },
      h("img", { src: mapSrc, width: 1040, height: 655, style: { objectFit: "contain" } }),
    ),
    // Legend.
    h("div", { style: { display: "flex", gap: "48px", alignItems: "center" } }, ...legendItems),
  );
}

// A tiny valid 1x1 grey PNG, used only if rendering itself blows up — a crawler
// still gets an image, never an error page.
const FALLBACK_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

export async function onRequest(context) {
  const { request } = context;
  const origin = new URL(request.url).origin;

  try {
    const [{ topology, fontSemibold, fontRegular }] = await Promise.all([
      loadAssets(origin),
      ensureInit(),
    ]);

    // decode() already tolerates garbage: bad/missing ?v= -> empty map.
    const v = new URL(request.url).searchParams.get("v");
    const states = v ? decode(v) : emptyStates();
    const count = countVisited(states);

    const mapSrc = mapImageDataUri(topology, states);
    const tree = buildTree(mapSrc, count);

    const svg = await satori(tree, {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: "Inter", data: fontRegular, weight: 400, style: "normal" },
        { name: "Inter", data: fontSemibold, weight: 600, style: "normal" },
      ],
    });

    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: WIDTH },
      background: "#f8fafc",
    }).render().asPng();

    return new Response(png, {
      headers: {
        "content-type": "image/png",
        // Immutable per ?v=: cache hard at the edge and in browsers.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    // Never surface an error page to a crawler.
    return new Response(FALLBACK_PNG, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=60",
      },
    });
  }
}
