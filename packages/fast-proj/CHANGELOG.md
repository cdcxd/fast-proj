# Changelog

## Unreleased

- `gcj02()`: WGS84 ↔ GCJ-02 for maps of China, with an `outsideChina` option. The inverse is accurate to 2e-11°.
  Against gcoord 1.0.7 it is 4.9–11.7× faster forward and 3.5–6.2× faster inverse (Node, Bun, Chromium).

## 0.1.1 (2026-10-12)

- `fast-proj/wasm` ships only the SIMD module. Engines without wasm SIMD (Safari before 16.4) now get the JavaScript
  backend (`backend: 'js'`), also when a `source` is given that can't compile there; the removed scalar wasm build was
  no faster than it.
- Removed `dist/fast-proj-scalar.wasm`. If your build copies it or passes it as `source`, drop it.
- Releases are published with npm trusted publishing.

## 0.1.0 (2026-10-12)

First release.

- `utm()` and general transverse Mercator `tmerc()`, to and from WGS84 lon/lat. Krüger series to order n^6
  (Karney 2011), within 4e-9 m of an exact reference (6e-9 m near ±180°).
- Batch methods on separate or interleaved arrays, in place or into caller buffers, plus single-point methods.
- `zoneFor`, `utmFor`, and the `WGS84` and `GRS80` ellipsoids.
- `fast-proj/geojson`: `positions`, `positionsFromArrays`, `lineString`, `latLngs`.
- `fast-proj/wasm`: opt-in `loadWasm()` backend, SIMD with a scalar fallback.
- ESM only, no dependencies, Node 20 or later.
