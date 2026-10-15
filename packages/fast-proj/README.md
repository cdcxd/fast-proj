# fast-proj

Fast batch coordinate conversions for JavaScript and TypeScript: UTM and transverse Mercator ↔ WGS84, and WGS84 ↔
GCJ-02 for maps of China, with typed-array APIs and an optional WebAssembly backend.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤4e-9 m (6e-9 m near ±180°) / 1e-13° vs an exact reference;
  ≈6e-9 m / 1.3e-13° vs proj4.
- GCJ-02: the published formula, 3.5–12× faster than gcoord; the inverse is accurate to 2e-11° (gcoord: 1e-6°).
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

import { loadWasm } from 'fast-proj/wasm'; // opt-in, ~21 kB
const wasm = await loadWasm();
wasm.utm({ zone: 33 }).toLonLatInterleaved(xy, xy);
```

Valid domain: within ~45° of the central meridian (accuracy above holds to 30°); points 90° or more away give `NaN`.
Output longitudes are in [-180, 180]. Output buffers may be the input itself but must not otherwise overlap it.

**[API reference](https://github.com/cdcxd/fast-proj/blob/main/docs/api.md)** ·
**[Coming from proj4](https://github.com/cdcxd/fast-proj/blob/main/docs/proj4.md)**

## Benchmark

10k points in zone 33N, median of 31 samples (`bun run bench`), against a reused proj4 2.22 `proj4(from, to)`
converter. JavaScript backend / WebAssembly SIMD backend:

|                                      | Node 24                   | Bun 1.4                   | Chromium 156               |
| ------------------------------------ | ------------------------- | ------------------------- | -------------------------- |
| UTM → WGS84, proj4                   | 4.86 ms                   | 2.56 ms                   | 5.22 ms                    |
| UTM → WGS84, `toLonLat`              | 1.01 (4.8×) / 0.58 (8.4×) | 0.95 (2.7×) / 0.57 (4.5×) | 1.64 (3.2×) / 0.60 (8.7×)  |
| WGS84 → UTM, proj4                   | 5.16 ms                   | 2.54 ms                   | 5.64 ms                    |
| WGS84 → UTM, `fromLonLat`            | 1.07 (4.8×) / 0.53 (9.7×) | 0.76 (3.4×) / 0.57 (4.5×) | 1.56 (3.6×) / 0.54 (10.4×) |
| flat UTM → GeoJSON LineString, proj4 | 5.05 ms                   | 2.84 ms                   | 5.36 ms                    |
| flat UTM → `lineString`              | 1.07 (4.7×) / 0.67 (7.6×) | 1.05 (2.7×) / 0.65 (4.4×) | 1.68 (3.2×) / 0.66 (8.1×)  |

GCJ-02, 10k points in eastern China, against gcoord 1.0.7's `transform` (JavaScript only):

|                         | Node 24      | Bun 1.4      | Chromium 156 |
| ----------------------- | ------------ | ------------ | ------------ |
| WGS84 → GCJ-02, gcoord  | 9.55 ms      | 7.97 ms      | 6.85 ms      |
| WGS84 → GCJ-02, `gcj02` | 0.88 (10.9×) | 0.68 (11.7×) | 1.40 (4.9×)  |
| GCJ-02 → WGS84, gcoord  | 13.63 ms     | 13.98 ms     | 11.63 ms     |
| GCJ-02 → WGS84, `gcj02` | 2.65 (5.1×)  | 2.25 (6.2×)  | 3.32 (3.5×)  |

Figures are the mean of three runs. The interleaved variants run at the same speed as the array form. Single-point methods use the JavaScript kernel in
both backends. Single runs: `node bench/run.mjs`, `bun bench/run.mjs`, `node bench/run.mjs --browser` (needs
`bunx playwright install chromium`).

## License

MIT
