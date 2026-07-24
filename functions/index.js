// Cloudflare Pages Function: GET /
//
// Serves index.html, but when ?v=<state> is present it rewrites the Open Graph
// and Twitter meta tags SERVER-SIDE so link crawlers (X, WhatsApp, Telegram,
// Slack — none run JS) see a preview of THAT shared map.
//
//   og:image / twitter:image -> /og?v=<same state> (the PNG Pages Function)
//   og:title / og:description / twitter:* -> reflect the shared map's count
//
// No ?v= -> the static defaults in index.html stand (a generic empty-map
// preview at /og). Rewriting happens on the HTML stream via HTMLRewriter, so
// the tags are in the bytes off the server, never injected by client JS.

import { decode, PROVINCE_COUNT } from "../src/encoding.js";

function countVisited(states) {
  let n = 0;
  for (let p = 1; p <= PROVINCE_COUNT; p++) if (states[p] > 0) n++;
  return n;
}

// Rewrites a single meta tag's `content` attribute to a fixed value.
class SetContent {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute("content", this.value); }
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const v = url.searchParams.get("v");

  // Pull the static index.html from the asset pipeline.
  const response = await next();

  // Only touch HTML; and only bother rewriting when there's a shared state.
  const isHtml = (response.headers.get("content-type") || "").includes("text/html");
  if (!v || !isHtml) return response;

  // decode() tolerates garbage -> empty map; a bad ?v= just yields count 0.
  const states = decode(v);
  const count = countVisited(states);

  // The share image for exactly this state. Absolute URL: crawlers need it
  // fully qualified, not relative.
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
