# UTM arithmetic optimization review

Comparison against `main` at `1a19065e741786d50d27cfe0c8e9f7a26acaab8`.

The converter retains all six terms of the existing series. It precomputes the scalar and complex polynomial coefficients, evaluates the complex polynomial with a real recurrence, reuses forward normalization squares, groups the small-angle polynomials in Horner form, and computes `eta'` with `log1p` instead of `asinh`. Positive-denominator angle calculations use `atan`, with `atan2` retained for other quadrants and zero or NaN denominators. The inverse imaginary correction explicitly adds `+0` to preserve the old recurrence’s signed-zero behavior at the equator.

The `log1p` form uses the identity `asinh(s) = log(s + sqrt(1 + s²))` with `sqrt(1 + s²) = cosh(eta')`, which equals the already-computed normalization factor `ir = 1/sqrt(sin²(chi) + cos²(chi)cos²(lam))` up to rounding, so `eta' = log1p(she + she²/(ir + 1))` replaces a transcendental call with one `log1p` plus three multiplications on data already in registers. This shifts rounding in the easting only (northing is unchanged): identical forward pairs drop from ~99% to ~80% on the grids below, with maxima still within the envelope already documented for the polynomial recurrences.

## Output identity and precision

Node v24.21.0. Each grid covers all 181 integer latitudes from −90° to 90°, six near-pole latitudes, and an additional signed-zero latitude. Eight zone/hemisphere combinations per row.

| Longitude range | Ellipsoid   | Points | Forward identical pairs | Inverse identical pairs | Max Δx (m) | Max Δy (m) | Max Δlon (°) | Max weighted Δlon (°) | Max Δlat (°) |
| --------------- | ----------- | -----: | ----------------------: | ----------------------: | ---------: | ---------: | -----------: | --------------------: | -----------: |
| ±30°            | sphere      |  91744 |    75280/91744 (82.05%) |   91744/91744 (100.00%) |   1.397e-9 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | WGS84       |  91744 |    74880/91744 (81.62%) |    91720/91744 (99.97%) |   1.397e-9 |   1.863e-9 |    3.553e-15 |             3.165e-15 |    7.105e-15 |
| ±30°            | GRS80       |  91744 |    75350/91744 (82.13%) |    91499/91744 (99.73%) |   1.397e-9 |   1.863e-9 |    2.842e-14 |             7.356e-15 |    1.421e-14 |
| ±30°            | f=0.005     |  91744 |    75421/91744 (82.21%) |    91516/91744 (99.75%) |   2.328e-9 |   1.863e-9 |    2.842e-14 |             1.506e-14 |    1.421e-14 |
| ±30°            | f=0.0099999 |  91744 |    71784/91744 (78.24%) |    91103/91744 (99.30%) |   1.863e-9 |   1.863e-9 |    2.842e-14 |             2.687e-14 |    1.421e-14 |
| ±45°            | sphere      | 136864 |  110956/136864 (81.07%) | 136864/136864 (100.00%) |   2.794e-9 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | WGS84       | 136864 |  110207/136864 (80.52%) |  136816/136864 (99.96%) |   2.794e-9 |   3.725e-9 |    3.553e-15 |             3.165e-15 |    7.105e-15 |
| ±45°            | GRS80       | 136864 |  110058/136864 (80.41%) |  136545/136864 (99.77%) |   2.794e-9 |   1.863e-9 |    2.842e-14 |             1.288e-14 |    1.421e-14 |
| ±45°            | f=0.005     | 136864 |  110266/136864 (80.57%) |  136553/136864 (99.77%) |   2.794e-9 |   1.863e-9 |    2.842e-14 |             1.506e-14 |    1.421e-14 |
| ±45°            | f=0.0099999 | 136864 |  100672/136864 (73.56%) |  135829/136864 (99.24%) |   2.794e-9 |   3.725e-9 |    2.842e-14 |             2.687e-14 |    1.421e-14 |

The CSV includes separate x/y and lon/lat identity counts, signed-zero differences, classification discrepancies, circular longitude deltas, and every zone/hemisphere row. The summary JSON includes aggregate rows, fixture results, API checks, and every nonidentical exceptional case. Inverse comparisons use identical baseline-projected inputs. Longitude weighting uses the original latitude; unweighted longitude can be ill-conditioned near a pole.

Grid classification discrepancies: 0.
Exceptional inputs: 280 cases; 276 identical pairs; 0 ordinate classification discrepancies; 0 signed-zero differences.

Nonidentical exceptional inputs (signed zeros are preserved as strings):

| Zone | Direction | Input          | Baseline                   | Candidate                  | Absolute deltas            |
| ---: | --------- | -------------- | -------------------------- | -------------------------- | -------------------------- |
|    1 | forward   | [-87.000001,0] | [2.4327934381888516e+86,0] | [2.4327934381888483e+86,0] | [3.3128382464594706e+71,0] |
|   31 | forward   | [92.999999,0]  | [2.4327930667825174e+86,0] | [2.4327930667825188e+86,0] | [1.3803492693581128e+71,0] |
|   33 | forward   | [104.999999,0] | [2.4327934381888516e+86,0] | [2.4327934381888483e+86,0] | [3.3128382464594706e+71,0] |
|   60 | forward   | [266.999999,0] | [2.4327930667825174e+86,0] | [2.4327930667825188e+86,0] | [1.3803492693581128e+71,0] |

The near-90° forward cases have enormous finite series outputs outside both grids. The raw equator suite below separately checks both northing zero signs, including ordinary eastings west of the central meridian.
Raw equator inputs: 240 cases; 240 identical pairs; 0 classification differences; 0 signed-zero differences. Southern equator northing is 10000000 m, where a distinct negative-zero offset is not representable.

Out-of-domain diagnostics (reported independently of the success criteria):

| Case                                             | Input               | Baseline                  | Candidate     | Classification differences |
| ------------------------------------------------ | ------------------- | ------------------------- | ------------- | -------------------------: |
| high-flattening extreme easting                  | [100000000,0]       | [-75,"NaN"]               | [-75,"NaN"]   |                          0 |
| high-flattening extreme easting/nonzero northing | [100000000,1000000] | [59.99999999999999,"NaN"] | ["NaN","NaN"] |                          1 |
| sphere extreme easting                           | [1200000000,0]      | [105,0]                   | ["NaN","NaN"] |                          2 |
| sphere negative extreme easting                  | [-1200000000,0]     | [-75,0]                   | ["NaN","NaN"] |                          2 |

Candidate API forms: 6400 ordinate comparisons; 0 differences; 0 output-buffer identity failures.

Independent fixture (91 points): candidate max Δx 9.313e-10 m, Δy 3.725e-9 m, weighted Δlon 1.421e-14°, Δlat 2.842e-14° (baseline maxima: Δx 1.397e-9 m, Δy 3.725e-9 m). Strict 5 nm / 1e-13° thresholds: **PASS**.

Object.is identity applies only to these samples. Numerical differences are reported rather than treated as universal bit identity. The ±30° and ±45° grids overlap. The fixture checks independent accuracy; baseline agreement alone does not establish accuracy.

## Performance comparison

Elapsed milliseconds per 10,000 points using preallocated split output buffers. Each revision runs in a fresh process (Node/Bun) or page (Chromium), with 150 warmup calls and 51 samples of five calls. Each number is the median of three per-revision medians; revision order alternates between rounds. Runs were serial. Raw files include quartiles, every round, output checksums, timestamps, and SHA-256 hashes of both compiled kernels.

The UTM dataset covers longitude 12–18° and latitude 45–63° in zone 33. The wide dataset covers longitude −15–45° (±30° from the central meridian) and latitude −80–84°. Both revisions receive the same inputs; inverse coordinates are generated by the baseline outside the timed region.

Machine: AMD Ryzen 9 3900X, Linux x64. These measurements describe this machine and these runtimes; timings vary with the runtime, machine, and dataset.

| Runtime                 | Dataset | Direction | Baseline ms | Optimized ms | Less elapsed time |
| ----------------------- | ------- | --------- | ----------: | -----------: | ----------------: |
| Node v24.21.0           | UTM     | forward   |       1.418 |        1.065 |             24.9% |
| Node v24.21.0           | UTM     | inverse   |       1.345 |        1.132 |             15.8% |
| Node v24.21.0           | wide    | forward   |       1.472 |        1.085 |             26.3% |
| Node v24.21.0           | wide    | inverse   |       1.298 |        1.033 |             20.4% |
| Bun 1.4.2               | UTM     | forward   |       1.135 |        0.760 |             33.1% |
| Bun 1.4.2               | UTM     | inverse   |       1.407 |        0.979 |             30.4% |
| Bun 1.4.2               | wide    | forward   |       1.218 |        0.806 |             33.9% |
| Bun 1.4.2               | wide    | inverse   |       1.396 |        0.920 |             34.1% |
| Chromium 150.0.7871.124 | UTM     | forward   |       2.580 |        2.160 |             16.3% |
| Chromium 150.0.7871.124 | UTM     | inverse   |       2.300 |        1.880 |             18.3% |
| Chromium 150.0.7871.124 | wide    | forward   |       2.720 |        2.160 |             20.6% |
| Chromium 150.0.7871.124 | wide    | inverse   |       2.260 |        1.920 |             15.0% |

## Artifacts and validation

- [Full per-direction output matrix (CSV)](../packages/utm/bench/results/arithmetic-outputs.csv), including each zone, hemisphere, ellipsoid, ordinate identity count, signed-zero count, and maximum delta.
- [Output summary (JSON)](../packages/utm/bench/results/arithmetic-output-summary.json), including fixture accuracy, API checks, and exceptional-input diagnostics.
- Raw performance results: [Node](../packages/utm/bench/results/arithmetic-node.json), [Bun](../packages/utm/bench/results/arithmetic-bun.json), [Chromium](../packages/utm/bench/results/arithmetic-chromium.json).

`bun run check` passes, including 67 tests. A regression test covers inverse equator signed zeros. Two subagents independently reviewed the implementation before PR creation, and the final revision (adding the `log1p` form) was re-reviewed against the recurrence identities and re-validated against the full matrix above.

## Reproduce

From the repository root, build both revisions with their installed dependencies:

```sh
git worktree add /tmp/fast-proj-arithmetic-base 1a19065
(cd /tmp/fast-proj-arithmetic-base && bun install --frozen-lockfile && bun run build)
bun run build

node packages/utm/bench/compare-outputs.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js \
  --candidate=packages/utm/dist/utm.js \
  --csv=packages/utm/bench/results/arithmetic-outputs.csv \
  --summary=packages/utm/bench/results/arithmetic-output-summary.json

node packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js
bun packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js
CHROME=/usr/bin/google-chrome node packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js --browser
```

`CHROME` is optional when Playwright’s Chromium is installed. All performance invocations print JSON to stdout. The output comparison also accepts `--json` to retain the full unaggregated JSON and `--markdown` to write its readable summary.
