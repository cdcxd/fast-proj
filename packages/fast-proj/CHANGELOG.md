# Changelog

## 0.3.1

### Patch Changes

- abbbe52: `gcj02` inverse (`toWgs84`): two Newton steps replace four fixed-point steps, in JavaScript and WebAssembly. 25–46% faster and 3–20× more accurate: within 3e-12° of the exact inverse (was 2e-11°). Results move by up to 2e-11°.
- 709257f: Faster JavaScript batch methods, with identical results: `utm`/`tmerc` 23–37% and `gcj02` 28–89% (Node, Bun, Chromium).

## 0.3.0

### Minor Changes

- 14b5595: The one breaking release before 1.0. GCJ-02 can now be a projection's longitude/latitude system:
  `utm({ zone: 50, geographic: GCJ02 })` gives x/y on the UTM grid and GCJ-02 longitude/latitude, for AMap and Tencent
  basemaps. `GCJ02` is `gcj02()` with the default options.

  | 0.2                                                      | 0.3                                                                                       |
  | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
  | `tmerc({ lon0, k0 })`                                    | `tmerc({ centralMeridian, scaleFactor })`; the old names throw naming the new ones        |
  | `t.lon0`, `t.k0`                                         | `t.centralMeridian`, `t.scaleFactor`                                                      |
  | `GeographicTransform` type                               | `Geographic`                                                                              |
  | `gcj02()` then `fromWgs84Interleaved` after a projection | `utm({ zone, geographic: GCJ02 })`, or `GCJ02.fromWgs84Interleaved`                       |
  | `gcj02()` returned a new object per call                 | one shared frozen converter per mode: `gcj02() === GCJ02`; per context for `wasm.gcj02()` |
  | `zoneFor(lon, lat)`                                      | `utmZoneFor(lon, lat)`                                                                    |
  | `centralMeridian(zone)`                                  | `zone * 6 - 183` (zone 33 → 15); `.centralMeridian` of a converter you already have       |
  | `MAX_FLATTENING`                                         | `0.01`                                                                                    |
  | `positionsFromArrays(lon, lat)`                          | `positions(lon, lat)`; `lineString` and `latLngs` take `(lon, lat)` too                   |
  | `wasm.utm(...).dispose()` (converters)                   | dispose the context; converters have no `dispose`                                         |
  | `WasmDisposable` type                                    | removed; `WasmContext` extends `Disposable`                                               |
  | `backend === 'wasm-simd'`                                | `'wasm'`; a non-SIMD custom build gives `'js'`                                            |
  | unknown option keys ignored, also by `loadWasm`          | `TypeError`                                                                               |
  | `loadWasm({ source: 123 })` failed inside the engine     | `TypeError`                                                                               |
  | `utm({ zone: '50' })` threw `RangeError`                 | `TypeError`: wrong types throw `TypeError`, bad values `RangeError`                       |
  | error messages                                           | prefixed `fast-proj:`                                                                     |
  | converters were mutable objects                          | frozen; a custom ellipsoid is copied                                                      |

  `latitudeOfOrigin` is accepted when 0; other values throw until supported. The wasm module no longer exports the
  unused zone-based `forward_batch`/`inverse_batch`.

### Patch Changes

- 0d209e4: Add a WebAssembly GCJ-02 kernel: `loadWasm().gcj02()` batch methods run about 1.9–4× faster in `'passthrough'` mode.

## 0.2.0

### Minor Changes

- `gcj02()`: WGS84 ↔ GCJ-02 for maps of China, with an `outsideChina` option. The inverse is accurate to 2e-11°.
  Against gcoord 1.0.7 it is 4.9–11.7× faster forward and 3.5–6.2× faster inverse (Node, Bun, Chromium).
  The `fast-proj/wasm` context has it too, running the JavaScript kernel.

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
