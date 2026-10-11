# fast-utm

Fast UTM ↔ WGS84 conversion for JavaScript and TypeScript, with batch typed-array APIs.

- Krüger series to 6th order (Karney 2011): agrees with proj4 to ~6e-9 m and ~1e-13° (a few ULP), up to 30° from the central meridian.
- No per-point allocations in the batch APIs; optional output buffers.
- No dependencies, ESM, tree-shakeable.

```ts
import { utm, zoneFor } from 'fast-utm';

const zone33 = utm({ zone: 33 }); // { zone, south?, ellipsoid? }

const { lon, lat } = zone33.toLonLat(xs, ys); // Float64Array in, Float64Array out
zone33.toLonLat(xs, ys, lonOut, latOut); // write into existing buffers
zone33.toLonLatInterleaved(xy, xy); // [x0, y0, x1, y1, ...], in place
const [x, y] = zone33.fromLonLatPoint(15, 52);

zoneFor(5, 60); // 32 (Norway exception)
```

## Benchmark

10k points in zone 33N, median of 31 samples (`bun run bench`). proj4 2.22 uses a reused `proj4(from, to)` converter.

|                           |        Node 24 |        Bun 1.4 |   Chromium 156 |
| ------------------------- | -------------: | -------------: | -------------: |
| UTM → WGS84, proj4        |        5.06 ms |        2.67 ms |        5.36 ms |
| UTM → WGS84, `toLonLat`   | 1.14 ms (4.5×) | 1.30 ms (2.1×) | 1.92 ms (2.8×) |
| WGS84 → UTM, proj4        |        5.25 ms |        2.74 ms |        5.80 ms |
| WGS84 → UTM, `fromLonLat` | 1.27 ms (4.1×) | 1.20 ms (2.3×) | 1.86 ms (3.1×) |

The point and interleaved variants run at the same speed as the array form. Single runs: `node bench/run.mjs`, `bun bench/run.mjs`, `node bench/run.mjs --browser` (needs `bunx playwright install chromium`).

## Development

Uses [Bun](https://bun.sh) as the package manager. A devcontainer with Bun and Node is included.

```sh
bun install
bun run test
bun run typecheck
bun run lint     # oxlint
bun run format   # oxfmt
bun run bench    # Node, Bun and Chromium
```

Tests compare against proj4 as the reference implementation.

## References

C. F. F. Karney, _Transverse Mercator with an accuracy of a few nanometers_, J. Geodesy 85 (2011) 475–485. [arXiv:1002.1417](https://arxiv.org/abs/1002.1417)

## License

MIT
