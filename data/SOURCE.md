# Data source & attribution

`provinces.topo.json` — TopoJSON of Turkey's 81 provinces, keyed by plate number
(`plate`, 1–81).

## Source

- **Repository:** https://github.com/alpers/Turkey-Maps-GeoJSON
- **File:** `tr-cities.json` (FeatureCollection, 81 features with `number` + `name`)
- **License:** Apache-2.0 — permissively licensed, attribution retained here.

Apache-2.0 is not public domain; this file is redistributed under its terms with
attribution to the upstream repository above.

## Processing

Fetched on **2026-07-24** and processed with mapshaper 0.7.48:

```sh
mapshaper tr-cities.json \
  -clean \
  -simplify visvalingam 50% keep-shapes \
  -each 'plate=number, delete number, delete name' \
  -o format=topojson data/provinces.topo.json
```

Then the TopoJSON object was renamed from `tr-cities` to `provinces`.

Notes:
- `-clean` removed 541 slivers and repaired 2 self-intersections.
- Only the `plate` property is kept; province names live in `src/provinces.js`,
  not in the geometry, to keep this file lean.
- Simplification preserves shared arcs (topology), so neighboring provinces keep
  identical boundaries — verified 219 shared interior arcs and 0 gaps (a dissolve
  of all 81 provinces yields the Turkish landmass with no interior holes).
- Plate 3's name was corrected from the source's "Afyon" to the official
  "Afyonkarahisar" (name change applied in `src/provinces.js`, not here).
