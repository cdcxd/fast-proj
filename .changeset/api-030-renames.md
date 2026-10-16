---
'fast-proj': minor
---

The one breaking release before 1.0. GCJ-02 can now be a projection's longitude/latitude system:
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
