# UTM arithmetic optimization review

Comparison against `main` at `1a19065e741786d50d27cfe0c8e9f7a26acaab8e`.

The converter retains all six terms of the existing series. It precomputes the scalar and complex polynomial coefficients, evaluates the complex polynomial with a real recurrence, reuses forward normalization squares, and groups the small-angle polynomials in Horner form. Positive-denominator angle calculations use `atan`, with `atan2` retained for other quadrants and zero or NaN denominators. The inverse imaginary correction explicitly adds `+0` to preserve the old recurrence’s signed-zero behavior at the equator.

## Output identity and precision

Node v24.21.0. Each grid covers all 181 integer latitudes from −90° to 90°, six near-pole latitudes, and an additional signed-zero latitude. Eight zone/hemisphere combinations per row.

| Longitude range | Ellipsoid   | Points | Forward identical pairs | Inverse identical pairs | Max Δx (m) | Max Δy (m) | Max Δlon (°) | Max weighted Δlon (°) | Max Δlat (°) |
| --------------- | ----------- | -----: | ----------------------: | ----------------------: | ---------: | ---------: | -----------: | --------------------: | -----------: |
| ±30°            | sphere      |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | WGS84       |  91744 |    90896/91744 (99.08%) |    91720/91744 (99.97%) |  9.313e-10 |   1.863e-9 |    3.553e-15 |             3.165e-15 |    7.105e-15 |
| ±30°            | GRS80       |  91744 |    91132/91744 (99.33%) |    91499/91744 (99.73%) |  9.313e-10 |   1.863e-9 |    2.842e-14 |             7.356e-15 |    1.421e-14 |
| ±30°            | f=0.005     |  91744 |    91626/91744 (99.87%) |    91516/91744 (99.75%) |  9.313e-10 |   1.863e-9 |    2.842e-14 |             1.506e-14 |    1.421e-14 |
| ±30°            | f=0.0099999 |  91744 |    90656/91744 (98.81%) |    91103/91744 (99.30%) |  9.313e-10 |   1.863e-9 |    2.842e-14 |             2.687e-14 |    1.421e-14 |
| ±45°            | sphere      | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | WGS84       | 136864 |  135653/136864 (99.12%) |  136816/136864 (99.96%) |   1.397e-9 |   3.725e-9 |    3.553e-15 |             3.165e-15 |    7.105e-15 |
| ±45°            | GRS80       | 136864 |  135825/136864 (99.24%) |  136545/136864 (99.77%) |   1.397e-9 |   1.863e-9 |    2.842e-14 |             1.288e-14 |    1.421e-14 |
| ±45°            | f=0.005     | 136864 |  136660/136864 (99.85%) |  136553/136864 (99.77%) |   1.863e-9 |   1.863e-9 |    2.842e-14 |             1.506e-14 |    1.421e-14 |
| ±45°            | f=0.0099999 | 136864 |  135260/136864 (98.83%) |  135829/136864 (99.24%) |   1.863e-9 |   3.725e-9 |    2.842e-14 |             2.687e-14 |    1.421e-14 |

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

Independent fixture (91 points): candidate max Δx 1.397e-9 m, Δy 3.725e-9 m, weighted Δlon 1.421e-14°, Δlat 2.842e-14°. Strict 5 nm / 1e-13° thresholds: **PASS**.

Object.is identity applies only to these samples. Numerical differences are reported rather than treated as universal bit identity. The ±30° and ±45° grids overlap. The fixture checks independent accuracy; baseline agreement alone does not establish accuracy.

## Performance comparison

Elapsed milliseconds per 10,000 points using preallocated split output buffers. Each revision runs in a fresh process (Node/Bun) or page (Chromium), with 150 warmup calls and 51 samples of five calls. Each number is the median of three per-revision medians; revision order alternates between rounds. Runs were serial. Raw files include quartiles, every round, output checksums, timestamps, and SHA-256 hashes of both compiled kernels.

The UTM dataset covers longitude 12–18° and latitude 45–63° in zone 33. The wide dataset covers longitude −15–45° (±30° from the central meridian) and latitude −80–84°. Both revisions receive the same inputs; inverse coordinates are generated by the baseline outside the timed region.

Machine: AMD Ryzen 9 3900X, Linux x64. These measurements describe this machine and these runtimes; timings vary with the runtime, machine, and dataset.

| Runtime                 | Dataset | Direction | Baseline ms | Optimized ms | Less elapsed time |
| ----------------------- | ------- | --------- | ----------: | -----------: | ----------------: |
| Node v24.21.0           | UTM     | forward   |       1.558 |        1.171 |             24.8% |
| Node v24.21.0           | UTM     | inverse   |       1.319 |        1.079 |             18.2% |
| Node v24.21.0           | wide    | forward   |       1.526 |        1.172 |             23.2% |
| Node v24.21.0           | wide    | inverse   |       1.322 |        1.067 |             19.3% |
| Bun 1.4.2               | UTM     | forward   |       1.166 |        0.812 |             30.4% |
| Bun 1.4.2               | UTM     | inverse   |       1.358 |        0.932 |             31.4% |
| Bun 1.4.2               | wide    | forward   |       1.276 |        0.874 |             31.5% |
| Bun 1.4.2               | wide    | inverse   |       1.458 |        0.927 |             36.4% |
| Chromium 150.0.7871.124 | UTM     | forward   |       2.820 |        2.460 |             12.8% |
| Chromium 150.0.7871.124 | UTM     | inverse   |       2.260 |        1.960 |             13.3% |
| Chromium 150.0.7871.124 | wide    | forward   |       2.820 |        2.480 |             12.1% |
| Chromium 150.0.7871.124 | wide    | inverse   |       2.260 |        2.080 |              8.0% |

## Artifacts and validation

- [Full per-direction output matrix (CSV)](../packages/utm/bench/results/arithmetic-outputs.csv), including each zone, hemisphere, ellipsoid, ordinate identity count, signed-zero count, and maximum delta.
- [Output summary (JSON)](../packages/utm/bench/results/arithmetic-output-summary.json), including fixture accuracy, API checks, and exceptional-input diagnostics.
- Raw performance results: [Node](../packages/utm/bench/results/arithmetic-node.json), [Bun](../packages/utm/bench/results/arithmetic-bun.json), [Chromium](../packages/utm/bench/results/arithmetic-chromium.json).

`bun run check` passes, including 67 tests. A regression test covers inverse equator signed zeros. Two subagents independently reviewed the implementation before PR creation. Additional independent review covered four million random points through ±45° and 24,312 direct edge calls within the documented domain; no remaining classification or signed-zero mismatch was found there. These additional review sweeps are supplemental; the committed scripts reproduce the matrix and performance tables above.

## Reproduce

From the repository root, build both revisions with their installed dependencies:

```sh
git worktree add /tmp/fast-proj-arithmetic-base 1a19065
(cd /tmp/fast-proj-arithmetic-base && bun install --frozen-lockfile && bun run build)
bun run build

node packages/utm/bench/compare-outputs.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js \
  --candidate=packages/utm/dist/utm.js \
  --csv=/tmp/utm-output-matrix.csv --summary=/tmp/utm-output-summary.json

node packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js
bun packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js
CHROME=/usr/bin/google-chrome node packages/utm/bench/compare-performance.mjs \
  --base=/tmp/fast-proj-arithmetic-base/packages/utm/dist/utm.js --browser
```

`CHROME` is optional when Playwright’s Chromium is installed. All performance invocations print JSON to stdout. The output comparison also accepts `--json` to retain the full unaggregated JSON and `--markdown` to write its readable summary.
