# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM, transverse Mercator and Web Mercator ↔ WGS84,
and WGS84 ↔ GCJ-02 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤5e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 7–20× faster than gcoord (16–29× with WebAssembly); the inverse is accurate to 3e-12°
  (gcoord: 1e-6°).
- Web Mercator (EPSG:3857): within five ulps of the correctly rounded exact value up to the poles; no clamping at ±85.05°.
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

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~57 kB
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
| WGS84 → UTM              | proj4                                             | 5.23 ms         | 2.45 ms        | 5.69 ms         |
|                          | `fromLonLat`, JavaScript                          | 0.60 ms (8.8×)  | 0.57 ms (4.3×) | 0.58 ms (9.8×)  |
|                          | `fromLonLat`, WebAssembly                         | 0.41 ms (12.8×) | 0.40 ms (6.1×) | 0.42 ms (13.5×) |
| UTM → WGS84              | proj4                                             | 4.86 ms         | 2.60 ms        | 5.30 ms         |
|                          | `toLonLat`, JavaScript                            | 0.66 ms (7.4×)  | 0.63 ms (4.1×) | 0.62 ms (8.5×)  |
|                          | `toLonLat`, WebAssembly                           | 0.45 ms (10.8×) | 0.43 ms (6.0×) | 0.44 ms (12.0×) |
| UTM → GeoJSON LineString | proj4                                             | 5.06 ms         | 2.84 ms        | 5.41 ms         |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 0.73 ms (7.0×)  | 0.73 ms (3.9×) | 0.68 ms (8.0×)  |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.54 ms (9.4×)  | 0.53 ms (5.3×) | 0.53 ms (10.1×) |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 24         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 9.70 ms         | 8.21 ms         | 6.81 ms         |
|                | `fromWgs84`, JavaScript  | 0.33 ms (29.1×) | 0.36 ms (22.8×) | 0.33 ms (20.8×) |
|                | `fromWgs84`, WebAssembly | 0.27 ms (35.9×) | 0.27 ms (30.4×) | 0.28 ms (24.3×) |
| GCJ-02 → WGS84 | gcoord                   | 13.87 ms        | 14.14 ms        | 11.61 ms        |
|                | `toWgs84`, JavaScript    | 0.96 ms (14.4×) | 1.10 ms (12.9×) | 0.90 ms (12.9×) |
|                | `toWgs84`, WebAssembly   | 0.66 ms (21.0×) | 0.81 ms (17.4×) | 0.67 ms (17.4×) |

UTM ↔ GCJ-02: `utm({ zone: 50, geographic: GCJ02 })`, against proj4 then gcoord (or gcoord then proj4).

| Operation    | Implementation            | Node 24         | Bun 1.4         | Chromium 156    |
| ------------ | ------------------------- | --------------- | --------------- | --------------- |
| UTM → GCJ-02 | proj4 + gcoord            | 16.06 ms        | 10.97 ms        | 12.27 ms        |
|              | `toLonLat`, JavaScript    | 0.96 ms (16.7×) | 0.99 ms (11.1×) | 0.96 ms (12.8×) |
|              | `toLonLat`, WebAssembly   | 0.65 ms (24.6×) | 0.64 ms (17.1×) | 0.66 ms (18.6×) |
| GCJ-02 → UTM | proj4 + gcoord            | 20.36 ms        | 17.24 ms        | 18.24 ms        |
|              | `fromLonLat`, JavaScript  | 1.56 ms (13.1×) | 1.69 ms (10.2×) | 1.51 ms (12.1×) |
|              | `fromLonLat`, WebAssembly | 1.08 ms (18.8×) | 1.21 ms (14.2×) | 1.08 ms (16.9×) |

Web Mercator: `webMercator()`, points in eastern China, against proj4's `EPSG:3857`.

| Operation            | Implementation            | Node 24         | Bun 1.4        | Chromium 156    |
| -------------------- | ------------------------- | --------------- | -------------- | --------------- |
| WGS84 → Web Mercator | proj4                     | 3.64 ms         | 0.76 ms        | 2.86 ms         |
|                      | `fromLonLat`, JavaScript  | 0.28 ms (13.0×) | 0.25 ms (3.0×) | 0.26 ms (11.0×) |
|                      | `fromLonLat`, WebAssembly | 0.26 ms (14.0×) | 0.25 ms (3.0×) | 0.26 ms (11.0×) |
| Web Mercator → WGS84 | proj4                     | 3.74 ms         | 0.71 ms        | 2.96 ms         |
|                      | `toLonLat`, JavaScript    | 0.24 ms (15.4×) | 0.29 ms (2.4×) | 0.22 ms (13.5×) |
|                      | `toLonLat`, WebAssembly   | 0.21 ms (17.8×) | 0.20 ms (3.6×) | 0.21 ms (14.3×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).

## License

MIT
