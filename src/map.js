// Interactive province map: renders the TopoJSON as clickable SVG paths,
// cycles visit states on tap, persists to localStorage, and reads ?v= on load.
//
// The TopoJSON decoding + palette live in ./geometry.js, shared with the OG
// image Pages Function so both draw the map identically.

import { PROVINCES } from "./provinces.js";
import { encode, decode, emptyStates, PROVINCE_COUNT } from "./encoding.js";
import {
  LEVELS, UNVISITED_COLOR, STROKE_COLOR, colorForState,
  decodeArcs, geometryToPath, computeBounds, makeProjection, geometryLabelMetrics,
} from "./geometry.js";

export { LEVELS };

const STROKE = STROKE_COLOR;
const colorFor = colorForState;

const STORAGE_KEY = "turkeyvisited.v1";

// --- the map ---------------------------------------------------------------
export function createMap({ topology, mount, width = 1000, onChange }) {
  const object = topology.objects[Object.keys(topology.objects)[0]];
  const arcs = decodeArcs(topology);
  const b = computeBounds(arcs);

  // Fit the map into `width`, preserving aspect ratio; flip Y (screen grows down).
  const { height, project } = makeProjection(b, width);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height.toFixed(0)}`);
  svg.setAttribute("class", "map-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Türkiye il haritası");

  let states = emptyStates();
  const pathByPlate = new Map();
  const labelGroup = document.createElementNS(svgNS, "g");
  labelGroup.setAttribute("aria-hidden", "true");
  labelGroup.setAttribute("pointer-events", "none");

  for (const geom of object.geometries) {
    const plate = geom.properties.plate;
    const name = PROVINCES[plate] || "İl " + plate;
    const label = geometryLabelMetrics(arcs, geom, project);

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", geometryToPath(arcs, geom, project));
    path.setAttribute("stroke", STROKE);
    path.setAttribute("stroke-width", "0.75");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", UNVISITED_COLOR);
    path.setAttribute("class", "province");
    path.setAttribute("tabindex", "0");
    path.setAttribute("role", "button");
    path.dataset.plate = String(plate);
    path.setAttribute("aria-label", name);

    // Left click / tap -> advance; right click -> go back.
    path.addEventListener("click", () => cycle(plate, +1));
    path.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cycle(plate, -1);
    });

    // Long-press (touch) -> go back. Cancel the following click.
    let pressTimer = null;
    let longFired = false;
    path.addEventListener("touchstart", () => {
      longFired = false;
      pressTimer = setTimeout(() => {
        longFired = true;
        cycle(plate, -1);
      }, 500);
    }, { passive: true });
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    path.addEventListener("touchend", (e) => {
      clearPress();
      if (longFired) { e.preventDefault(); } // swallow the click after a long-press
    });
    path.addEventListener("touchmove", clearPress, { passive: true });
    path.addEventListener("touchcancel", clearPress);

    // Keyboard: Enter/Space advance, Backspace/Delete go back.
    path.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(plate, +1); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); cycle(plate, -1); }
    });

    svg.appendChild(path);
    pathByPlate.set(plate, path);

    if (label) {
      const text = document.createElementNS(svgNS, "text");
      const fontSize = Math.max(6.5, Math.min(12, label.width / Math.max(7, name.length * 0.8)));
      text.textContent = name;
      text.setAttribute("x", label.x.toFixed(1));
      text.setAttribute("y", label.y.toFixed(1));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
      text.setAttribute("font-size", fontSize.toFixed(1));
      text.setAttribute("font-weight", "700");
      text.setAttribute("fill", "#0f172a");
      text.setAttribute("stroke", "#ffffff");
      text.setAttribute("stroke-width", "3");
      text.setAttribute("paint-order", "stroke");
      labelGroup.appendChild(text);
    }
  }

  svg.appendChild(labelGroup);
  mount.appendChild(svg);

  function cycle(plate, dir) {
    // 4 states, wrapping both directions.
    states[plate] = (((states[plate] + dir) % 4) + 4) % 4;
    paint(plate);
    persist();
    emit();
  }

  function paint(plate) {
    const path = pathByPlate.get(plate);
    const state = states[plate];
    path.setAttribute("fill", colorFor(state));
    const name = PROVINCES[plate] || "İl " + plate;
    const lvl = LEVELS.find((l) => l.value === state);
    path.setAttribute("aria-label", name + ": " + (lvl ? lvl.label : "Gitmedim"));
  }

  function paintAll() {
    for (const plate of pathByPlate.keys()) paint(plate);
  }

  function visitedCount() {
    let n = 0;
    for (let p = 1; p <= PROVINCE_COUNT; p++) if (states[p] > 0) n++;
    return n;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, encode(states)); } catch (_) {}
  }

  function emit() {
    if (onChange) {
      const counts = { 1: 0, 2: 0, 3: 0 };
      for (let plate = 1; plate <= PROVINCE_COUNT; plate++) {
        const state = states[plate];
        if (state >= 1 && state <= 3) counts[state]++;
      }
      onChange({ states, count: visitedCount(), counts, code: encode(states) });
    }
  }

  // Load precedence: ?v= in the URL wins over localStorage.
  function load() {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("v");
    if (v) {
      states = decode(v);
    } else {
      let stored = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) {}
      states = stored ? decode(stored) : emptyStates();
    }
    paintAll();
    emit();
  }

  load();

  return {
    getStates: () => states.slice(),
    getCode: () => encode(states),
    getCount: visitedCount,
    reset() {
      states = emptyStates();
      paintAll();
      persist();
      emit();
    },
  };
}
