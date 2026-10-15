# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM and transverse Mercator ↔ WGS84, and WGS84 ↔
GCJ-02 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤4e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 4–13× faster than gcoord (11–26× with WebAssembly); the inverse is accurate to 2e-11°
  (gcoord: 1e-6°).
- No per-point allocations in the batch APIs; optional output buffers, in-place conversion.
- No dependencies, ESM-only, tree-shakeable. Node ≥ 20 and modern browsers.

```sh
npm install fast-proj
```

```ts
import { gcj02, tmerc, utm, utmFor } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

const zone33 = utm({ zone: 33 }); // or utm(utmFor(lon, lat))
const { lon, lat } = zone33.toLonLat(xs, ys); // Float64Array out
zone33.toLonLatInterleaved(xy, xy); // [x0, y0, x1, y1, ...] -> [lon0, lat0, ...], in place
const [x, y] = zone33.fromLonLatPoint(15, 52);
map.getSource('track').setData(lineString(xy)); // MapLibre

const gk = tmerc({ lon0: 117, falseEasting: 500000 }); // Gauss-Krüger, CM 117E
gcj02().fromWgs84Interleaved(lonlat, lonlat); // WGS84 -> GCJ-02 for AMap/Tencent basemaps, in place

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~31 kB
const wasm = await loadWasm();
wasm.utm({ zone: 33 }).toLonLatInterleaved(xy, xy);
```

Valid domain: within ~45° of the central meridian (accuracy above holds to 30°); points 90° or more away give `NaN`.
Output longitudes are in [-180, 180]. Output buffers may be the input itself but must not otherwise overlap it.

**[API reference](https://github.com/cdcxd/fast-proj/blob/main/docs/api.md)** ·
**[Coming from proj4](https://github.com/cdcxd/fast-proj/blob/main/docs/proj4.md)**

## Benchmark

10k points (`bun run bench`), the mean of three runs of the median of 31 samples. UTM: zone 33N, against a reused
proj4 2.22 `proj4(from, to)` converter.

| Operation                | Implementation                                    | Node 24         | Bun 1.4        | Chromium 156    |
| ------------------------ | ------------------------------------------------- | --------------- | -------------- | --------------- |
| WGS84 → UTM              | proj4                                             | 5.95 ms         | 2.59 ms        | 6.11 ms         |
|                          | `fromLonLat`, JavaScript                          | 1.09 ms (5.5×)  | 0.77 ms (3.3×) | 1.55 ms (4.0×)  |
|                          | `fromLonLat`, WebAssembly                         | 0.54 ms (11.0×) | 0.55 ms (4.7×) | 0.56 ms (10.9×) |
| UTM → WGS84              | proj4                                             | 5.55 ms         | 2.79 ms        | 5.62 ms         |
|                          | `toLonLat`, JavaScript                            | 1.07 ms (5.2×)  | 0.96 ms (2.9×) | 1.67 ms (3.4×)  |
|                          | `toLonLat`, WebAssembly                           | 0.59 ms (9.4×)  | 0.57 ms (4.9×) | 0.59 ms (9.6×)  |
| UTM → GeoJSON LineString | proj4                                             | 5.85 ms         | 2.97 ms        | 5.82 ms         |
|                          | `toLonLatInterleaved` + `lineString`, JavaScript  | 1.10 ms (5.3×)  | 1.09 ms (2.7×) | 1.69 ms (3.4×)  |
|                          | `toLonLatInterleaved` + `lineString`, WebAssembly | 0.70 ms (8.4×)  | 0.70 ms (4.3×) | 0.67 ms (8.6×)  |

GCJ-02: points in eastern China, against gcoord 1.0.7's `transform`.

| Operation      | Implementation           | Node 24         | Bun 1.4         | Chromium 156    |
| -------------- | ------------------------ | --------------- | --------------- | --------------- |
| WGS84 → GCJ-02 | gcoord                   | 10.13 ms        | 8.77 ms         | 7.50 ms         |
|                | `fromWgs84`, JavaScript  | 0.85 ms (12.0×) | 0.67 ms (13.0×) | 1.41 ms (5.3×)  |
|                | `fromWgs84`, WebAssembly | 0.39 ms (26.0×) | 0.37 ms (23.7×) | 0.40 ms (18.8×) |
| GCJ-02 → WGS84 | gcoord                   | 14.64 ms        | 15.01 ms        | 12.76 ms        |
|                | `toWgs84`, JavaScript    | 2.61 ms (5.6×)  | 2.19 ms (6.9×)  | 3.41 ms (3.7×)  |
|                | `toWgs84`, WebAssembly   | 1.11 ms (13.1×) | 1.14 ms (13.2×) | 1.11 ms (11.5×) |

The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mjs`, `bun bench/run.mjs`, `node bench/run.mjs --browser` (needs
`bunx playwright install chromium`).

## License

MIT
