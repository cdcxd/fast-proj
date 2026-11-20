# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM, transverse Mercator and Web Mercator ↔ WGS84,
and WGS84 ↔ GCJ-02 ↔ BD-09 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤5e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 11–23× faster than gcoord (17–29× with WebAssembly); the inverse is accurate to 3e-12°
  (gcoord: 1e-6°).
- BD-09 (Baidu), from WGS84 or directly from GCJ-02: 7–14× faster than gcoord through WGS84 (10–17× with
  WebAssembly); both directions within 1.5e-14° of the formula (gcoord's inverse: 2e-6°).
- Web Mercator (EPSG:3857): within five ulps of the correctly rounded exact value up to the poles; no clamping at ±85.05°.
- No per-point allocations in the batch APIs; optional output buffers, in-place conversion.
- No dependencies, ESM-only, tree-shakeable. Node ≥ 20 and modern browsers.

```sh
npm install fast-proj
```

```ts
import { BD09, GCJ02, tmerc, utm, utmFor, webMercator } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

const zone33 = utm({ zone: 33 }); // or utm(utmFor(lon, lat))
const { lon, lat } = zone33.toLonLat(xs, ys); // Float64Array out
zone33.toLonLatInterleaved(xy, xy); // [x0, y0, x1, y1, ...] -> [lon0, lat0, ...], in place
const [x, y] = zone33.fromLonLatPoint(15, 52);
map.getSource('track').setData(lineString(xy)); // MapLibre

const gk = tmerc({ centralMeridian: 117, falseEasting: 500000 }); // Gauss-Krüger, CM 117E
utm({ zone: 50, geographic: GCJ02 }).toLonLatInterleaved(xy, xy); // UTM -> GCJ-02 for AMap/Tencent basemaps
GCJ02.fromWgs84Interleaved(lonlat, lonlat); // WGS84 -> GCJ-02, in place
BD09.fromGcj02Interleaved(lonlat, lonlat); // GCJ-02 -> BD-09 for Baidu (or BD09.fromWgs84Interleaved)
webMercator().fromLonLatInterleaved(lonlat, lonlat); // lon/lat -> EPSG:3857 x/y (on GCJ-02 lon/lat: AMap tiles)

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~78 kB
const wasm = await loadWasm();
wasm.utm({ zone: 33 }).toLonLatInterleaved(xy, xy);
```

Transverse Mercator's valid domain: within ~45° of the central meridian (accuracy above holds to 30°); points 90° or more away give `NaN`.
Output longitudes are in [-180, 180]. Output buffers may be the input itself but must not otherwise overlap it.

**[API reference](https://github.com/cdcxd/fast-proj/blob/main/docs/api.md)** ·
**[Coming from proj4](https://github.com/cdcxd/fast-proj/blob/main/docs/proj4.md)**

## Benchmark

10k points (`bun run bench`), the mean of three runs of the median of 31 samples. UTM: zone 33N, against a reused
proj4 2.23 `proj4(from, to)` converter.

| Operation                | Implementation                                    | Node 26        | Bun 1.4        | Chromium 156   |
| ------------------------ | ------------------------------------------------- | -------------- | -------------- | -------------- |
| WGS84 → UTM              | proj4                                             | 2.42 ms        | 2.28 ms        | 3.31 ms        |
|                          | `fromLonLat`, JavaScript                          | 0.63 ms (3.9×) | 0.57 ms (4.0×) | 0.58 ms (5.7×) |
|                          | `fromLonLat`, WebAssembly                         | 0.37 ms (6.5×) | 0.39 ms (5.8×) | 0.38 ms (8.7×) |
| UTM → WGS84              | proj4                                             | 1.82 ms        | 2.09 ms        | 2.65 ms        |
|                          | `toLonLat`, JavaScript                            | 0.62 ms (2.9×) | 0.62 ms (3.4×) | 0.62 ms (4.3×) |
|                          | `toLonLat`, WebAssembly                           | 0.45 ms (4.0×) | 0.43 ms (4.9×) | 0.44 ms (6.0×) |
| UTM → GeoJSON LineString | proj4                                             | 2.09 ms        | 2.32 ms        | 2.81 ms        |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 0.69 ms (3.0×) | 0.72 ms (3.2×) | 0.68 ms (4.1×) |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.54 ms (3.9×) | 0.53 ms (4.4×) | 0.52 ms (5.4×) |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 26         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 6.05 ms         | 8.15 ms         | 6.76 ms         |
|                | `fromWgs84`, JavaScript  | 0.33 ms (18.3×) | 0.36 ms (22.6×) | 0.33 ms (20.3×) |
|                | `fromWgs84`, WebAssembly | 0.24 ms (25.2×) | 0.28 ms (29.1×) | 0.24 ms (28.2×) |
| GCJ-02 → WGS84 | gcoord                   | 10.04 ms        | 14.01 ms        | 11.61 ms        |
|                | `toWgs84`, JavaScript    | 0.93 ms (10.8×) | 1.10 ms (12.7×) | 0.89 ms (13.0×) |
|                | `toWgs84`, WebAssembly   | 0.58 ms (17.3×) | 0.82 ms (17.1×) | 0.58 ms (20.0×) |

BD-09: the same points, against gcoord 1.0.7's `transform`. GCJ-02 ↔ BD-09 runs in JavaScript in both backends.

| Operation      | Implementation           | Node 26         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → BD-09  | gcoord                   | 6.99 ms         | 9.42 ms         | 7.90 ms         |
|                | `fromWgs84`, JavaScript  | 0.58 ms (12.1×) | 0.67 ms (14.1×) | 0.56 ms (14.1×) |
|                | `fromWgs84`, WebAssembly | 0.50 ms (13.9×) | 0.58 ms (16.2×) | 0.48 ms (16.5×) |
| BD-09 → WGS84  | gcoord                   | 11.12 ms        | 15.20 ms        | 13.31 ms        |
|                | `toWgs84`, JavaScript    | 1.51 ms (7.4×)  | 1.73 ms (8.8×)  | 1.45 ms (9.2×)  |
|                | `toWgs84`, WebAssembly   | 1.15 ms (9.6×)  | 1.45 ms (10.5×) | 1.12 ms (11.9×) |
| GCJ-02 → BD-09 | gcoord                   | 4.93 ms         | 6.78 ms         | 4.91 ms         |
|                | `fromGcj02`              | 0.26 ms (18.9×) | 0.31 ms (21.9×) | 0.22 ms (22.3×) |
| BD-09 → GCJ-02 | gcoord                   | 4.93 ms         | 6.73 ms         | 4.89 ms         |
|                | `toGcj02`                | 0.58 ms (8.5×)  | 0.63 ms (10.7×) | 0.55 ms (8.8×)  |

UTM ↔ GCJ-02: `utm({ zone: 50, geographic: GCJ02 })`, against proj4 then gcoord (or gcoord then proj4).

| Operation    | Implementation            | Node 26         | Bun 1.4         | Chromium 156    |
| ------------ | ------------------------- | --------------- | --------------- | --------------- |
| UTM → GCJ-02 | proj4 + gcoord            | 8.40 ms         | 10.78 ms        | 9.05 ms         |
|              | `toLonLat`, JavaScript    | 0.94 ms (8.9×)  | 0.99 ms (10.8×) | 0.94 ms (9.6×)  |
|              | `toLonLat`, WebAssembly   | 0.65 ms (12.9×) | 0.64 ms (16.8×) | 0.66 ms (13.7×) |
| GCJ-02 → UTM | proj4 + gcoord            | 11.93 ms        | 16.55 ms        | 15.20 ms        |
|              | `fromLonLat`, JavaScript  | 1.56 ms (7.6×)  | 1.65 ms (10.0×) | 1.52 ms (10.0×) |
|              | `fromLonLat`, WebAssembly | 0.95 ms (12.5×) | 1.21 ms (13.7×) | 0.95 ms (15.9×) |

Web Mercator: `webMercator()`, points in eastern China, against proj4's `EPSG:3857`.

| Operation            | Implementation            | Node 26        | Bun 1.4        | Chromium 156   |
| -------------------- | ------------------------- | -------------- | -------------- | -------------- |
| WGS84 → Web Mercator | proj4                     | 1.12 ms        | 0.77 ms        | 1.05 ms        |
|                      | `fromLonLat`, JavaScript  | 0.28 ms (4.0×) | 0.25 ms (3.1×) | 0.26 ms (4.0×) |
|                      | `fromLonLat`, WebAssembly | 0.26 ms (4.3×) | 0.25 ms (3.1×) | 0.26 ms (4.0×) |
| Web Mercator → WGS84 | proj4                     | 1.31 ms        | 0.72 ms        | 1.29 ms        |
|                      | `toLonLat`, JavaScript    | 0.24 ms (5.5×) | 0.27 ms (2.6×) | 0.20 ms (6.4×) |
|                      | `toLonLat`, WebAssembly   | 0.20 ms (6.6×) | 0.20 ms (3.6×) | 0.20 ms (6.4×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).

## License

MIT
