---
'fast-proj': minor
---

Add `webMercator()`, Web Mercator (EPSG:3857), in both backends (`loadWasm().webMercator()` runs a wasm kernel). Within three ulps of an exact reference up to the poles; latitudes beyond ±85.05° are not clamped, and the poles give `NaN`. Takes the `geographic` option like `tmerc`/`utm`; see the API docs for placing points on AMap/Tencent tiles, which are Web Mercator of GCJ-02 coordinates.
