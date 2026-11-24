# Benchmarks

Speedups are charted in the [README](../README.md#performance); the charts are generated from the tables on this page
(`bun run bench:charts` in `packages/fast-proj`).

Run in `packages/fast-proj`: `bun run bench` builds, then runs Node, Bun and Chromium.

## Batch

10k points, the mean of three runs of the median of 31 samples. UTM: zone 33N, against a reused
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

## Single points

10k calls of the point method (`toLonLatPoint`, `fromWgs84Point`, ...) on the same points, against the
same baselines, which convert one point per call too. Point methods run the JavaScript kernel in both backends.

| Operation            | Baseline       | Node 26                 | Bun 1.4                  | Chromium 156             |
| -------------------- | -------------- | ----------------------- | ------------------------ | ------------------------ |
| UTM → WGS84          | proj4          | 0.73 ms vs 1.88 (2.6×)  | 0.75 ms vs 2.12 (2.8×)   | 0.72 ms vs 2.65 (3.7×)   |
| WGS84 → GCJ-02       | gcoord         | 0.44 ms vs 6.07 (13.8×) | 0.42 ms vs 8.01 (19.1×)  | 0.44 ms vs 6.78 (15.4×)  |
| GCJ-02 → WGS84       | gcoord         | 1.04 ms vs 10.04 (9.7×) | 1.20 ms vs 13.86 (11.6×) | 1.00 ms vs 11.62 (11.6×) |
| WGS84 → BD-09        | gcoord         | 0.79 ms vs 6.86 (8.7×)  | 0.93 ms vs 9.44 (10.1×)  | 0.78 ms vs 7.64 (9.8×)   |
| BD-09 → WGS84        | gcoord         | 1.75 ms vs 11.08 (6.3×) | 2.18 ms vs 15.29 (7.0×)  | 1.73 ms vs 13.37 (7.7×)  |
| GCJ-02 → BD-09       | gcoord         | 0.40 ms vs 4.91 (12.3×) | 0.50 ms vs 6.75 (13.4×)  | 0.38 ms vs 4.85 (12.8×)  |
| BD-09 → GCJ-02       | gcoord         | 0.72 ms vs 4.99 (6.9×)  | 0.88 ms vs 6.68 (7.6×)   | 0.74 ms vs 4.85 (6.5×)   |
| UTM → GCJ-02         | proj4 + gcoord | 1.07 ms vs 8.18 (7.6×)  | 1.20 ms vs 10.58 (8.8×)  | 1.06 ms vs 9.41 (8.9×)   |
| GCJ-02 → UTM         | proj4 + gcoord | 1.90 ms vs 12.29 (6.5×) | 1.94 ms vs 16.52 (8.5×)  | 1.82 ms vs 15.27 (8.4×)  |
| WGS84 → Web Mercator | proj4          | 0.52 ms vs 1.15 (2.2×)  | 0.31 ms vs 0.75 (2.4×)   | 0.44 ms vs 1.09 (2.5×)   |
| Web Mercator → WGS84 | proj4          | 0.33 ms vs 1.21 (3.6×)  | 0.40 ms vs 0.77 (1.9×)   | 0.34 ms vs 1.37 (4.0×)   |

## Leaflet

`FastPolyline` against `L.Polyline` on Leaflet's canvas renderer (`bun run bench:leaflet`): a 1M-point drive (one fix
per second over about 11 days of driving), 1024×768 at DPR 2, Chromium 156. Times are the work of each step, including
canvas rasterization, without the wait for the next frame; `add` includes building `L.Polyline`'s `[lat, lng]` arrays.

| Leaflet | Step               | L.Polyline | FastPolyline | Speedup |
| ------- | ------------------ | ---------: | -----------: | ------: |
| 1.9.4   | add                |   413.6 ms |      88.2 ms |    4.7× |
|         | pan (whole track)  |    32.2 ms |      15.4 ms |    2.1× |
|         | zoom in 2-3 levels |   436.3 ms |      12.5 ms |   34.9× |
|         | pan (zoomed in)    |     6.4 ms |       6.6 ms |    1.0× |
|         | zoom out           |   389.6 ms |      13.7 ms |   28.4× |
| 2.0 β5  | add                |   454.7 ms |      84.6 ms |    5.4× |
|         | pan (whole track)  |    32.9 ms |      15.6 ms |    2.1× |
|         | zoom in 2-3 levels |   397.1 ms |      13.0 ms |   30.5× |
|         | pan (zoomed in)    |     9.0 ms |       6.6 ms |    1.4× |
|         | zoom out           |   363.7 ms |      12.1 ms |   30.1× |

Leaflet re-projects every point on each zoom; `FastPolyline` projects once and only rescales. Pans are close because
Leaflet only clips and simplifies on a pan (no re-projection), and both spend most of a pan stroking the canvas.

## Notes

The interleaved variants run at the same speed as the array form. Single runs: `node bench/run.mts`, `bun bench/run.mts`, `node bench/run.mts --browser` (needs
`bunx playwright install chromium`).
