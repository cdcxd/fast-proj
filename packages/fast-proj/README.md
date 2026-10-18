# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM, transverse Mercator and Web Mercator ↔ WGS84,
and WGS84 ↔ GCJ-02 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤4e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 4–13× faster than gcoord (11–26× with WebAssembly); the inverse is accurate to 3e-12°
  (gcoord: 1e-6°).
- Web Mercator (EPSG:3857): within three ulps of an exact reference up to the poles; no clamping at ±85.05°.
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

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~31 kB
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

| Operation                | Implementation                                    | Node 24        | Bun 1.4        | Chromium 156    |
| ------------------------ | ------------------------------------------------- | -------------- | -------------- | --------------- |
| WGS84 → UTM              | proj4                                             | 5.10 ms        | 2.44 ms        | 5.69 ms         |
|                          | `fromLonLat`, JavaScript                          | 0.91 ms (5.6×) | 0.67 ms (3.6×) | 1.23 ms (4.6×)  |
|                          | `fromLonLat`, WebAssembly                         | 0.54 ms (9.4×) | 0.55 ms (4.4×) | 0.54 ms (10.5×) |
| UTM → WGS84              | proj4                                             | 4.83 ms        | 2.51 ms        | 5.27 ms         |
|                          | `toLonLat`, JavaScript                            | 0.91 ms (5.3×) | 0.80 ms (3.1×) | 1.35 ms (3.9×)  |
|                          | `toLonLat`, WebAssembly                           | 0.51 ms (9.5×) | 0.48 ms (5.2×) | 0.50 ms (10.5×) |
| UTM → GeoJSON LineString | proj4                                             | 5.06 ms        | 2.81 ms        | 5.41 ms         |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 0.96 ms (5.3×) | 0.90 ms (3.1×) | 1.47 ms (3.7×)  |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.61 ms (8.2×) | 0.58 ms (4.9×) | 0.58 ms (9.3×)  |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 24         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 9.59 ms         | 8.13 ms         | 6.72 ms         |
|                | `fromWgs84`, JavaScript  | 0.48 ms (20.0×) | 0.51 ms (15.9×) | 0.89 ms (7.5×)  |
|                | `fromWgs84`, WebAssembly | 0.35 ms (27.4×) | 0.35 ms (23.0×) | 0.35 ms (19.4×) |
| GCJ-02 → WGS84 | gcoord                   | 13.89 ms        | 13.86 ms        | 11.66 ms        |
|                | `toWgs84`, JavaScript    | 1.17 ms (11.9×) | 1.19 ms (11.6×) | 1.55 ms (7.5×)  |
|                | `toWgs84`, WebAssembly   | 0.72 ms (19.3×) | 0.88 ms (15.8×) | 0.72 ms (16.2×) |

UTM ↔ GCJ-02: `utm({ zone: 50, geographic: GCJ02 })`, against proj4 then gcoord (or gcoord then proj4).

| Operation    | Implementation            | Node 24         | Bun 1.4         | Chromium 156    |
| ------------ | ------------------------- | --------------- | --------------- | --------------- |
| UTM → GCJ-02 | proj4 + gcoord            | 16.09 ms        | 10.97 ms        | 12.15 ms        |
|              | `toLonLat`, JavaScript    | 1.11 ms (14.5×) | 1.12 ms (9.8×)  | 1.62 ms (7.5×)  |
|              | `toLonLat`, WebAssembly   | 0.70 ms (23.0×) | 0.70 ms (15.7×) | 0.70 ms (17.4×) |
| GCJ-02 → UTM | proj4 + gcoord            | 20.49 ms        | 17.04 ms        | 18.27 ms        |
|              | `fromLonLat`, JavaScript  | 1.89 ms (10.8×) | 1.83 ms (9.3×)  | 2.75 ms (6.7×)  |
|              | `fromLonLat`, WebAssembly | 1.26 ms (16.2×) | 1.43 ms (11.9×) | 1.25 ms (14.7×) |

Web Mercator: `webMercator()`, points in eastern China, against proj4's `EPSG:3857`.

| Operation            | Implementation            | Node 24         | Bun 1.4        | Chromium 156    |
| -------------------- | ------------------------- | --------------- | -------------- | --------------- |
| WGS84 → Web Mercator | proj4                     | 3.60 ms         | 0.76 ms        | 2.81 ms         |
|                      | `fromLonLat`, JavaScript  | 0.46 ms (7.8×)  | 0.40 ms (1.9×) | 0.56 ms (5.0×)  |
|                      | `fromLonLat`, WebAssembly | 0.26 ms (13.9×) | 0.25 ms (3.0×) | 0.26 ms (10.8×) |
| Web Mercator → WGS84 | proj4                     | 3.77 ms         | 0.69 ms        | 2.95 ms         |
|                      | `toLonLat`, JavaScript    | 0.38 ms (9.9×)  | 0.29 ms (2.4×) | 0.44 ms (6.7×)  |
|                      | `toLonLat`, WebAssembly   | 0.22 ms (17.2×) | 0.21 ms (3.3×) | 0.22 ms (13.4×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).

## License

MIT
