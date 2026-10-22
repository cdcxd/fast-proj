# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM, transverse Mercator and Web Mercator ↔ WGS84,
and WGS84 ↔ GCJ-02 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤5e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 7–20× faster than gcoord (16–29× with WebAssembly); the inverse is accurate to 3e-12°
  (gcoord: 1e-6°).
- Web Mercator (EPSG:3857): within five ulps of an exact reference up to the poles; no clamping at ±85.05°.
- No per-point allocations in the batch APIs; optional output buffers, in-place conversion.
- No dependencies, ESM-only, tree-shakeable. Node ≥ 20 and modern browsers.

```sh
npm install fast-proj
```

```ts
import { GCJ02, tmerc, utm, utmFor, webMercator } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

const zone33 = utm({ zone: 33 }); // or utm(utmFor(lon, lat))
const { lon, lat } = zone33.toLonLat(xs, ys); // Float64Array out
zone33.toLonLatInterleaved(xy, xy); // [x0, y0, x1, y1, ...] -> [lon0, lat0, ...], in place
const [x, y] = zone33.fromLonLatPoint(15, 52);
map.getSource('track').setData(lineString(xy)); // MapLibre

const gk = tmerc({ centralMeridian: 117, falseEasting: 500000 }); // Gauss-Krüger, CM 117E
utm({ zone: 50, geographic: GCJ02 }).toLonLatInterleaved(xy, xy); // UTM -> GCJ-02 for AMap/Tencent basemaps
GCJ02.fromWgs84Interleaved(lonlat, lonlat); // WGS84 -> GCJ-02, in place
webMercator().fromLonLatInterleaved(lonlat, lonlat); // lon/lat -> EPSG:3857 x/y (on GCJ-02 lon/lat: AMap tiles)

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~53 kB
const wasm = await loadWasm();
wasm.utm({ zone: 33 }).toLonLatInterleaved(xy, xy);
```

Transverse Mercator's valid domain: within ~45° of the central meridian (accuracy above holds to 30°); points 90° or more away give `NaN`.
Output longitudes are in [-180, 180]. Output buffers may be the input itself but must not otherwise overlap it.

**[API reference](https://github.com/cdcxd/fast-proj/blob/main/docs/api.md)** ·
**[Coming from proj4](https://github.com/cdcxd/fast-proj/blob/main/docs/proj4.md)**

## Benchmark

10k points (`bun run bench`), the mean of three runs of the median of 31 samples. UTM: zone 33N, against a reused
proj4 2.22 `proj4(from, to)` converter.

| Operation                | Implementation                                    | Node 24         | Bun 1.4        | Chromium 156    |
| ------------------------ | ------------------------------------------------- | --------------- | -------------- | --------------- |
| WGS84 → UTM              | proj4                                             | 5.03 ms         | 2.46 ms        | 5.65 ms         |
|                          | `fromLonLat`, JavaScript                          | 0.84 ms (6.0×)  | 0.66 ms (3.7×) | 0.88 ms (6.4×)  |
|                          | `fromLonLat`, WebAssembly                         | 0.46 ms (10.9×) | 0.44 ms (5.6×) | 0.46 ms (12.3×) |
| UTM → WGS84              | proj4                                             | 4.76 ms         | 2.57 ms        | 5.24 ms         |
|                          | `toLonLat`, JavaScript                            | 0.87 ms (5.5×)  | 0.66 ms (3.9×) | 0.93 ms (5.6×)  |
|                          | `toLonLat`, WebAssembly                           | 0.51 ms (9.3×)  | 0.48 ms (5.3×) | 0.50 ms (10.5×) |
| UTM → GeoJSON LineString | proj4                                             | 5.14 ms         | 2.76 ms        | 5.37 ms         |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 0.83 ms (6.2×)  | 0.76 ms (3.7×) | 1.00 ms (5.4×)  |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.59 ms (8.7×)  | 0.59 ms (4.7×) | 0.58 ms (9.3×)  |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 24         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 9.63 ms         | 8.04 ms         | 6.79 ms         |
|                | `fromWgs84`, JavaScript  | 0.50 ms (19.1×) | 0.36 ms (22.3×) | 0.34 ms (20.0×) |
|                | `fromWgs84`, WebAssembly | 0.33 ms (29.5×) | 0.33 ms (24.4×) | 0.32 ms (21.2×) |
| GCJ-02 → WGS84 | gcoord                   | 13.91 ms        | 14.05 ms        | 11.63 ms        |
|                | `toWgs84`, JavaScript    | 1.24 ms (11.2×) | 1.13 ms (12.4×) | 1.00 ms (11.6×) |
|                | `toWgs84`, WebAssembly   | 0.72 ms (19.4×) | 0.86 ms (16.4×) | 0.70 ms (16.6×) |

UTM ↔ GCJ-02: `utm({ zone: 50, geographic: GCJ02 })`, against proj4 then gcoord (or gcoord then proj4).

| Operation    | Implementation            | Node 24         | Bun 1.4         | Chromium 156    |
| ------------ | ------------------------- | --------------- | --------------- | --------------- |
| UTM → GCJ-02 | proj4 + gcoord            | 16.07 ms        | 11.07 ms        | 12.16 ms        |
|              | `toLonLat`, JavaScript    | 1.16 ms (13.9×) | 1.02 ms (10.8×) | 1.38 ms (8.8×)  |
|              | `toLonLat`, WebAssembly   | 0.70 ms (23.0×) | 0.70 ms (15.8×) | 0.70 ms (17.4×) |
| GCJ-02 → UTM | proj4 + gcoord            | 20.37 ms        | 17.19 ms        | 18.11 ms        |
|              | `fromLonLat`, JavaScript  | 1.90 ms (10.7×) | 1.76 ms (9.8×)  | 1.95 ms (9.3×)  |
|              | `fromLonLat`, WebAssembly | 1.16 ms (17.6×) | 1.29 ms (13.3×) | 1.15 ms (15.7×) |

Web Mercator: `webMercator()`, points in eastern China, against proj4's `EPSG:3857`.

| Operation            | Implementation            | Node 24         | Bun 1.4        | Chromium 156    |
| -------------------- | ------------------------- | --------------- | -------------- | --------------- |
| WGS84 → Web Mercator | proj4                     | 3.59 ms         | 0.76 ms        | 2.84 ms         |
|                      | `fromLonLat`, JavaScript  | 0.48 ms (7.5×)  | 0.25 ms (3.1×) | 0.26 ms (10.9×) |
|                      | `fromLonLat`, WebAssembly | 0.26 ms (13.8×) | 0.25 ms (3.1×) | 0.26 ms (10.9×) |
| Web Mercator → WGS84 | proj4                     | 3.70 ms         | 0.69 ms        | 2.98 ms         |
|                      | `toLonLat`, JavaScript    | 0.38 ms (9.7×)  | 0.29 ms (2.4×) | 0.45 ms (6.7×)  |
|                      | `toLonLat`, WebAssembly   | 0.22 ms (16.8×) | 0.21 ms (3.3×) | 0.22 ms (13.5×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).

## License

MIT
