# @fast-proj/utm

Fast UTM ↔ WGS84 conversion for JavaScript and TypeScript, with batch typed-array APIs.

- Krüger series to 6th order (Karney 2011). Accuracy: ≤4e-9 m / 1e-13° vs an exact reference; ≈6e-9 m / 1.3e-13° vs proj4.
- No per-point allocations in the batch APIs; optional output buffers, in-place conversion.
- No dependencies, ESM-only, tree-shakeable. Node ≥ 20 and modern browsers.

```sh
npm install @fast-proj/utm
```

```ts
import { utm, utmFor } from '@fast-proj/utm';
import { lineString } from '@fast-proj/utm/geojson';

const zone33 = utm({ zone: 33 }); // or utm(utmFor(lon, lat))

const { lon, lat } = zone33.toLonLat(xs, ys); // Float64Array out
zone33.toLonLatInterleaved(xy, xy); // [x0, y0, x1, y1, ...], in place
const [x, y] = zone33.fromLonLatPoint(15, 52);

map.getSource('track').setData(lineString(zone33, xy)); // MapLibre
```

Valid domain: within ~45° of the zone's central meridian (accuracy above holds to 30°); points 90° or more away
give `NaN`. Output longitudes are in [-180, 180]. Output buffers may be the input itself but must not otherwise
overlap it.

**[API reference](https://github.com/cdcxd/fast-proj/blob/main/docs/utm.md)**

## Benchmark

10k points in zone 33N, median of 31 samples (`bun run bench`), against a reused proj4 2.22 `proj4(from, to)`
converter:

|                                             |        Node 24 |        Bun 1.4 |   Chromium 156 |
| ------------------------------------------- | -------------: | -------------: | -------------: |
| UTM → WGS84, proj4                          |        5.06 ms |        2.59 ms |        5.24 ms |
| UTM → WGS84, `toLonLat`                     | 1.03 ms (4.9×) | 0.95 ms (2.7×) | 1.66 ms (3.2×) |
| WGS84 → UTM, proj4                          |        5.37 ms |        2.59 ms |        5.72 ms |
| WGS84 → UTM, `fromLonLat`                   | 1.05 ms (5.1×) | 0.76 ms (3.4×) | 1.56 ms (3.7×) |
| flat UTM → GeoJSON LineString, proj4        |        5.28 ms |        3.11 ms |        5.96 ms |
| flat UTM → GeoJSON LineString, `lineString` | 1.06 ms (5.0×) | 1.06 ms (2.9×) | 1.66 ms (3.6×) |

The point and interleaved variants run at the same speed as the array form. Single runs: `node bench/run.mjs`,
`bun bench/run.mjs`, `node bench/run.mjs --browser` (needs `bunx playwright install chromium`).

## License

MIT
