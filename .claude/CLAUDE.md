# CLAUDE.md

Project guidance for Claude Code. Read this before touching any file.

## What this is

A single-page map of Turkey's 81 provinces. You tap a province, it cycles through
three visit levels, and you get a shareable link whose preview image is your map.

**This is a hobby project.** No monetization, no analytics, no accounts, no
backend database. If a feature would create an ongoing maintenance or support
obligation, it does not belong here. The whole thing should be finishable in a
weekend and then left alone.

Inspired by [turkeyvisited](https://github.com/seralifatih/turkeyvisited) — same
core idea, two things it didn't do: visit depth, and link-preview sharing.

Interface language is Turkish. Province names, level labels, and share text are
all Turkish. No i18n layer — this is for people in Turkey.

## Scope

**In:**
- 81 provinces, click to cycle visit level
- Three levels: `yaşadım` / `gezdim` / `geçtim` (plus unvisited)
- Legend showing the three levels with their colors
- Share button producing a URL that renders a map preview on X and WhatsApp
- localStorage so the map survives a refresh

**Out — do not build these:**
- District (ilçe) level
- Timeline, animation, GIF/video export
- Statistics beyond a simple visited count (no population %, no area %)
- User accounts, saved profiles, backend storage
- Comparing two users' maps
- Any analytics or tracking

## Architecture

Everything on Cloudflare Pages. One platform, one deploy, zero cost.

```
Static site        Cloudflare Pages
                   map, painting, localStorage

Share link         /?v=<encoded-state>

HTML rendering     Pages Function on /
                   reads ?v=, injects correct <meta property="og:image">

OG image           Pages Function on /og
                   satori (JSX → SVG) → resvg-wasm (SVG → PNG)
```

**The critical constraint:** X and WhatsApp crawlers do not run JavaScript. The
`og:image` meta tag must be present in the HTML that comes off the server. This
is the entire reason for the Pages Function on `/` — if the meta tag is injected
client-side, sharing silently does nothing.

## State encoding

81 provinces × 4 states (unvisited + 3 levels) = 2 bits each = 162 bits.
Base64url-encoded, roughly 28 characters. Fits comfortably in a URL.

- Province order is fixed by plate number (1–81). Never reorder — old links break.
- Encoding lives in `src/encoding.js`, used by both the client and the Functions.
- Include a single-character version prefix (`1`) so the format can change later
  without breaking existing links.
- Decoding must tolerate garbage input: a malformed `?v=` renders an empty map,
  never an error page.

## Data

Province boundaries: any permissively licensed (Apache-2.0, attributed in
data/SOURCE.md) Turkey GeoJSON keyed by plate number.
Simplify with mapshaper to roughly 100–150KB and commit the result as TopoJSON.
Do not fetch boundaries at runtime.

The province list (plate number → name) is a hardcoded array. It does not change.

## Visual

Three levels need three distinguishable colors plus an unvisited base. Pick a
palette that survives being scaled down to a preview thumbnail — that is the main
viewing context, not the full-size map. Check it at 400px wide before committing.

The share image is map + legend only. No stats, no username, no watermark.

## Tech

- Plain JS, no framework. This is one page.
- SVG for the map. 81 paths is nothing — no canvas or WebGL needed.
- `satori` + `@resvg/resvg-wasm` in the Pages Function
- No build step if avoidable. If a bundler becomes necessary, Vite.

## Style

- Turkish in the UI, English in the code and comments
- No dependencies beyond what OG image generation genuinely needs
- Few enough files that the whole thing can be read in one sitting

## Done means

You can paint your provinces, hit share, paste the link into WhatsApp, and see
your own map in the preview. That's it. Anything past that is scope creep.
