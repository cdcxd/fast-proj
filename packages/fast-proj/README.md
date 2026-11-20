# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM, transverse Mercator and Web Mercator ↔ WGS84,
and WGS84 ↔ GCJ-02 ↔ BD-09 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤5e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 11–22× faster than gcoord (17–29× with WebAssembly); the inverse is accurate to 3e-12°
  (gcoord: 1e-6°).
- BD-09 (Baidu), from WGS84 or directly from GCJ-02: 7–14× faster than gcoord through WGS84 (10–16× with
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

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~72 kB
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
| WGS84 → UTM              | proj4                                             | 2.42 ms        | 2.23 ms        | 3.31 ms        |
|                          | `fromLonLat`, JavaScript                          | 0.62 ms (3.9×) | 0.57 ms (3.9×) | 0.58 ms (5.7×) |
|                          | `fromLonLat`, WebAssembly                         | 0.37 ms (6.5×) | 0.39 ms (5.7×) | 0.38 ms (8.7×) |
| UTM → WGS84              | proj4                                             | 1.88 ms        | 2.12 ms        | 2.65 ms        |
|                          | `toLonLat`, JavaScript                            | 0.62 ms (3.0×) | 0.62 ms (3.4×) | 0.62 ms (4.3×) |
|                          | `toLonLat`, WebAssembly                           | 0.45 ms (4.2×) | 0.43 ms (4.9×) | 0.44 ms (6.0×) |
| UTM → GeoJSON LineString | proj4                                             | 2.15 ms        | 2.35 ms        | 2.84 ms        |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 0.69 ms (3.1×) | 0.73 ms (3.2×) | 0.68 ms (4.2×) |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.54 ms (4.0×) | 0.53 ms (4.5×) | 0.52 ms (5.5×) |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 26         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 6.07 ms         | 8.01 ms         | 6.78 ms         |
|                | `fromWgs84`, JavaScript  | 0.33 ms (18.4×) | 0.36 ms (22.2×) | 0.32 ms (21.2×) |
|                | `fromWgs84`, WebAssembly | 0.24 ms (25.0×) | 0.28 ms (28.6×) | 0.24 ms (28.3×) |
| GCJ-02 → WGS84 | gcoord                   | 10.04 ms        | 13.86 ms        | 11.62 ms        |
|                | `toWgs84`, JavaScript    | 0.93 ms (10.8×) | 1.10 ms (12.6×) | 0.90 ms (12.9×) |
|                | `toWgs84`, WebAssembly   | 0.58 ms (17.2×) | 0.82 ms (16.8×) | 0.58 ms (20.0×) |

BD-09: the same points, against gcoord 1.0.7's `transform`. GCJ-02 ↔ BD-09 runs in JavaScript in both backends.

| Operation      | Implementation           | Node 26         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → BD-09  | gcoord                   | 6.86 ms         | 9.44 ms         | 7.64 ms         |
|                | `fromWgs84`, JavaScript  | 0.58 ms (11.8×) | 0.68 ms (13.9×) | 0.58 ms (13.2×) |
|                | `fromWgs84`, WebAssembly | 0.50 ms (13.6×) | 0.59 ms (16.0×) | 0.49 ms (15.7×) |
| BD-09 → WGS84  | gcoord                   | 11.08 ms        | 15.29 ms        | 13.37 ms        |
|                | `toWgs84`, JavaScript    | 1.52 ms (7.3×)  | 1.73 ms (8.8×)  | 1.48 ms (9.0×)  |
|                | `toWgs84`, WebAssembly   | 1.16 ms (9.5×)  | 1.46 ms (10.5×) | 1.15 ms (11.6×) |
| GCJ-02 → BD-09 | gcoord                   | 4.91 ms         | 6.75 ms         | 4.85 ms         |
|                | `fromGcj02`              | 0.26 ms (18.9×) | 0.32 ms (21.1×) | 0.24 ms (20.2×) |
| BD-09 → GCJ-02 | gcoord                   | 4.99 ms         | 6.68 ms         | 4.85 ms         |
|                | `toGcj02`                | 0.58 ms (8.6×)  | 0.63 ms (10.6×) | 0.58 ms (8.4×)  |

UTM ↔ GCJ-02: `utm({ zone: 50, geographic: GCJ02 })`, against proj4 then gcoord (or gcoord then proj4).

| Operation    | Implementation            | Node 26         | Bun 1.4         | Chromium 156    |
| ------------ | ------------------------- | --------------- | --------------- | --------------- |
| UTM → GCJ-02 | proj4 + gcoord            | 8.18 ms         | 10.58 ms        | 9.41 ms         |
|              | `toLonLat`, JavaScript    | 0.94 ms (8.7×)  | 1.00 ms (10.6×) | 0.94 ms (10.0×) |
|              | `toLonLat`, WebAssembly   | 0.65 ms (12.6×) | 0.64 ms (16.5×) | 0.66 ms (14.3×) |
| GCJ-02 → UTM | proj4 + gcoord            | 12.29 ms        | 16.52 ms        | 15.27 ms        |
|              | `fromLonLat`, JavaScript  | 1.56 ms (7.9×)  | 1.66 ms (10.0×) | 1.51 ms (10.1×) |
|              | `fromLonLat`, WebAssembly | 0.95 ms (12.9×) | 1.21 ms (13.6×) | 0.98 ms (15.6×) |

Web Mercator: `webMercator()`, points in eastern China, against proj4's `EPSG:3857`.

| Operation            | Implementation            | Node 26        | Bun 1.4        | Chromium 156   |
| -------------------- | ------------------------- | -------------- | -------------- | -------------- |
| WGS84 → Web Mercator | proj4                     | 1.15 ms        | 0.75 ms        | 1.09 ms        |
|                      | `fromLonLat`, JavaScript  | 0.28 ms (4.0×) | 0.25 ms (3.0×) | 0.26 ms (4.2×) |
|                      | `fromLonLat`, WebAssembly | 0.26 ms (4.4×) | 0.25 ms (3.0×) | 0.26 ms (4.2×) |
| Web Mercator → WGS84 | proj4                     | 1.21 ms        | 0.77 ms        | 1.37 ms        |
|                      | `toLonLat`, JavaScript    | 0.24 ms (5.0×) | 0.28 ms (2.8×) | 0.20 ms (6.9×) |
|                      | `toLonLat`, WebAssembly   | 0.20 ms (5.9×) | 0.20 ms (3.8×) | 0.20 ms (6.9×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).

## License

MIT
