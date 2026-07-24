// Pure TopoJSON -> SVG geometry, shared by the interactive map (src/map.js) and
// the OG image Pages Function (functions/og.js). No DOM, no dependencies —
// works in the browser and in the Cloudflare Workers runtime.

// --- palette (single source of truth) --------------------------------------
// 0 = gitmedim (unvisited), 1 = geçtim, 2 = gezdim, 3 = yaşadım.
export const LEVELS = [
  { value: 1, label: "Geçtim", color: "#fdba74" },
  { value: 2, label: "Gezdim", color: "#38bdf8" },
  { value: 3, label: "Yaşadım", color: "#15803f" },
];
export const UNVISITED_COLOR = "#e5e7eb";
export const STROKE_COLOR = "#94a3b8";

// state value -> fill color
export function colorForState(state) {
  const lvl = LEVELS.find((l) => l.value === state);
  return lvl ? lvl.color : UNVISITED_COLOR;
}

// Rebuild absolute coordinates from delta-encoded, quantized arcs.
export function decodeArcs(topology) {
  const { scale, translate } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

// Resolve a signed arc index into its point list (negatives are reversed arcs,
// referenced as ~i so that -1 => arc 0 reversed).
function arcPoints(arcs, idx) {
  if (idx >= 0) return arcs[idx];
  return arcs[~idx].slice().reverse();
}

// A ring is a list of arc indices; stitch them into one continuous point list.
function ringToPoints(arcs, ring) {
  const pts = [];
  for (const idx of ring) {
    const seg = arcPoints(arcs, idx);
    // drop the shared endpoint between consecutive arcs to avoid duplicates
    for (let i = pts.length ? 1 : 0; i < seg.length; i++) pts.push(seg[i]);
  }
  return pts;
}

// Build an SVG "d" string for one geometry (Polygon or MultiPolygon), applying
// the lon/lat -> screen projection passed in.
export function geometryToPath(arcs, geom, project) {
  const polygons = geom.type === "Polygon" ? [geom.arcs] : geom.arcs;
  let d = "";
  for (const poly of polygons) {
    for (const ring of poly) {
      const pts = ringToPoints(arcs, ring);
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length; i++) {
        const [sx, sy] = project(pts[i][0], pts[i][1]);
        d += (i === 0 ? "M" : "L") + sx.toFixed(1) + " " + sy.toFixed(1);
      }
      d += "Z";
    }
  }
  return d;
}

// Compute lon/lat bounds across all decoded arcs for the projection.
export function computeBounds(arcs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const arc of arcs) {
    for (const [x, y] of arc) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fit the map into `width`, returning { height, project } where project maps
 * lon/lat -> screen coords (Y flipped so screen grows downward).
 */
export function makeProjection(bounds, width, padRatio = 0.02) {
  const pad = width * padRatio;
  const s = (width - pad * 2) / (bounds.maxX - bounds.minX);
  const height = (bounds.maxY - bounds.minY) * s + pad * 2;
  const project = (lon, lat) => [
    (lon - bounds.minX) * s + pad,
    (bounds.maxY - lat) * s + pad,
  ];
  return { height, project, pad };
}

/**
 * Render the whole map as a standalone SVG string. `fillFor(plate)` returns the
 * fill color for a province; `opts` tweaks stroke and dimensions.
 *
 * Used by the OG function (embedded as an <img> data URI in satori) and usable
 * anywhere a static map image is needed.
 */
export function buildMapSvg(topology, fillFor, opts = {}) {
  const {
    width = 1000,
    stroke = "#94a3b8",
    strokeWidth = 0.75,
    background = "transparent",
  } = opts;

  const object = topology.objects[Object.keys(topology.objects)[0]];
  const arcs = decodeArcs(topology);
  const bounds = computeBounds(arcs);
  const { height, project } = makeProjection(bounds, width);

  let paths = "";
  for (const geom of object.geometries) {
    const plate = geom.properties.plate;
    const d = geometryToPath(arcs, geom, project);
    paths += `<path d="${d}" fill="${fillFor(plate)}" stroke="${stroke}" ` +
             `stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  }

  const bg = background === "transparent"
    ? ""
    : `<rect width="${width}" height="${height.toFixed(0)}" fill="${background}"/>`;

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" ` +
         `height="${height.toFixed(0)}" viewBox="0 0 ${width} ${height.toFixed(0)}">` +
         `${bg}${paths}</svg>`,
    width,
    height,
  };
}
