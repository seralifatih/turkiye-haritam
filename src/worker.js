// Cloudflare Pages advanced-mode Worker. build.js writes a one-line
// dist/_worker.js that re-exports this module, so Pages (not a local bundler)
// compiles it and resolves satori + yoga-wasm-web + @resvg/resvg-wasm.
//
// The two `.wasm` imports are turned into precompiled `WebAssembly.Module`
// values by the `[[rules]] type = "CompiledWasm"` entry in wrangler.toml. That
// is the crux: without it the wasm arrives as raw bytes and init would call
// WebAssembly.compile() at request time, which the Workers runtime forbids.
//
// Routes:
//   GET /og[?v=]      -> the 1200x630 share PNG (satori -> resvg)
//   GET / (or /index) -> index.html with OG/Twitter meta rewritten per ?v=
//   everything else    -> static assets (env.ASSETS)
//
// Turkish text uses an embedded Inter font. A missing/malformed ?v= yields an
// EMPTY map, never an error.

import satori, { init as initSatori } from "satori";
import initYoga from "yoga-wasm-web";
import yogaWasm from "yoga-wasm-web/dist/yoga.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

// Cloudflare's compiler provides these imports as precompiled
// `WebAssembly.Module` values, which the init functions can consume directly.
const resvgModule = resvgWasm;
const yogaModule = yogaWasm;

import { decode, emptyStates, PROVINCE_COUNT } from "./encoding.js";
import { LEVELS, colorForState, buildMapSvg } from "./geometry.js";

const WIDTH = 1200;
const HEIGHT = 630;

// --- one-time WASM init (cached per isolate) -------------------------------
let initReady = null;
function ensureInit() {
  if (!initReady) {
    initReady = Promise.all([
      initYoga(yogaModule).then((yoga) => initSatori(yoga)),
      initWasm(resvgModule).catch((e) => {
        if (!/already/i.test(String(e && e.message))) throw e;
      }),
    ]).catch((e) => {
      initReady = null; // let the next request retry a failed init
      throw e;
    });
  }
  return initReady;
}

// --- assets (topojson + fonts), cached across warm invocations -------------
let assetsCache = null;
async function loadAssets(env, origin) {
  if (!assetsCache) {
    const get = async (path) => {
      const res = await env.ASSETS.fetch(new URL(path, origin).toString());
      if (!res.ok) throw new Error("asset " + path + " -> " + res.status);
      return await res.arrayBuffer();
    };
    const [topoBuf, fontSemibold, fontRegular] = await Promise.all([
      get("/data/provinces.topo.json"),
      get("/assets/fonts/Inter-SemiBold.ttf"),
      get("/assets/fonts/Inter-Regular.ttf"),
    ]);
    const topology = JSON.parse(new TextDecoder().decode(topoBuf));
    assetsCache = { topology, fontSemibold, fontRegular };
  }
  return assetsCache;
}

function countVisited(states) {
  let n = 0;
  for (let p = 1; p <= PROVINCE_COUNT; p++) if (states[p] > 0) n++;
  return n;
}

// --- OG image ---------------------------------------------------------------
function mapImageDataUri(topology, states) {
  const fillFor = (plate) => colorForState(states[plate] || 0);
  const { svg } = buildMapSvg(topology, fillFor, {
    width: 1000, background: "transparent", stroke: "#94a3b8", strokeWidth: 0.9,
    showLabels: false, // no Turkish text in the embedded <img> (satori btoa fails on it)
  });
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// Minimal hyperscript (no JSX build step). satori accepts { type, props }.
// Leaf elements must omit `children` — an empty [] trips satori's flex check.
function h(type, props, ...children) {
  const flat = children.flat().filter((c) => c != null && c !== false);
  const p = { ...props };
  if (flat.length === 1) p.children = flat[0];
  else if (flat.length > 1) p.children = flat;
  return { type, props: p };
}

function buildTree(mapSrc, count) {
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
      background: "#f8fafc", padding: "40px 48px", fontFamily: "Inter",
    },
  },
    h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" } },
      h("div", { style: { fontSize: "40px", fontWeight: 600, color: "#0f172a" } }, "Türkiye Haritam"),
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", fontSize: "34px", color: "#334155" } },
        h("span", { style: { fontWeight: 600 } }, String(count) + "/81"),
        h("span", {}, "il gezildi")),
    ),
    h("div", { style: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", width: "100%" } },
      h("img", { src: mapSrc, width: 1040, height: 655, style: { objectFit: "contain" } }),
    ),
    h("div", { style: { display: "flex", gap: "48px", alignItems: "center" } }, ...legendItems),
  );
}

// A tiny valid 1x1 grey PNG — only if rendering itself throws, a crawler still
// gets an image, never an error page.
const FALLBACK_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

async function renderOg(request, env) {
  const url = new URL(request.url);
  try {
    const [{ topology, fontSemibold, fontRegular }] = await Promise.all([
      loadAssets(env, url.origin),
      ensureInit(),
    ]);

    const v = url.searchParams.get("v");
    const states = v ? decode(v) : emptyStates();
    const count = countVisited(states);

    const svg = await satori(buildTree(mapImageDataUri(topology, states), count), {
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
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    // Never surface an error page to a crawler — fall back to a blank PNG.
    return new Response(FALLBACK_PNG, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "public, max-age=60" },
    });
  }
}

// --- / with server-side OG rewrite -----------------------------------------
class SetContent {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute("content", this.value); }
}

async function renderIndex(request, env) {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");

  // Serve the static index.html.
  const response = await env.ASSETS.fetch(new URL("/index.html", url.origin).toString());
  const isHtml = (response.headers.get("content-type") || "").includes("text/html");
  if (!v || !isHtml) return response;

  const states = decode(v);
  const count = countVisited(states);
  const ogImage = new URL("/og?v=" + encodeURIComponent(v), url.origin).toString();
  const title = "Türkiye Haritam";
  const description = count + "/81 il gezdim. Sen de kendi haritanı yap.";

  return new HTMLRewriter()
    .on('meta[property="og:image"]', new SetContent(ogImage))
    .on('meta[name="twitter:image"]', new SetContent(ogImage))
    .on('meta[property="og:title"]', new SetContent(title))
    .on('meta[name="twitter:title"]', new SetContent(title))
    .on('meta[property="og:description"]', new SetContent(description))
    .on('meta[name="twitter:description"]', new SetContent(description))
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/og") return renderOg(request, env);
    if (path === "/" || path === "/index.html") return renderIndex(request, env);

    // Everything else: static assets.
    return env.ASSETS.fetch(request);
  },
};
