# Changelog

## 0.1.0 (2026-10-12)

First release.

- `utm()` and general transverse Mercator `tmerc()`, to and from WGS84 lon/lat. Krüger series to order n^6
  (Karney 2011), within 4e-9 m of an exact reference (6e-9 m near ±180°).
- Batch methods on separate or interleaved arrays, in place or into caller buffers, plus single-point methods.
- `zoneFor`, `utmFor`, and the `WGS84` and `GRS80` ellipsoids.
- `fast-proj/geojson`: `positions`, `positionsFromArrays`, `lineString`, `latLngs`.
- `fast-proj/wasm`: opt-in `loadWasm()` backend, SIMD with a scalar fallback.
- ESM only, no dependencies, Node 20 or later.
