# Wasm arithmetic follow-up

Baseline: merged PR #2, `main` at `91ca334` (source-equivalent to `2f6d564`).
Only the experimental Rust SIMD kernel changes; the published TypeScript package
and current wrapper API retain their behavior. The resource API direction is
recorded separately in [RESOURCE-LIFECYCLE.md](RESOURCE-LIFECYCLE.md).

## Changes

- `vlog1p` skips the unused full-log or small-argument formula when both lanes
  select the same path. Mixed and NaN pairs retain the previous blend. Selected
  arithmetic is unchanged.
- Six divisions by 120 or 24 in the small Taylor corrections become reciprocal
  multiplications. Intermediate rounding can change for arbitrary doubles; output
  identity below describes samples, not a universal bit-equivalence guarantee.
- A math-smoke `log1p_batch` export permits direct regression checks for every
  ordered pair of seam/exceptional values, both formula paths, signed zeros,
  subnormals, empty input and an odd tail.
- Accuracy gates now check classification and signed zeros in both inverse
  ordinates, and signed zeros in both forward ordinates.

## Final artifact performance

AMD Ryzen 9 3900X, Linux x64; Node 24.21.0, Bun 1.4.2, Rust 1.99.0 with
`simd128`. One million preallocated split-array points, zone 33, longitude 12–18°,
latitude 45–63°. Three alternating rounds, fresh process per revision, five
warmups and fifteen samples per direction. Speedups divide the median timings across
rounds; all comparisons ran serially. These are local measurements, not CI gates.

Against the merged **Wasm** kernel:

| Runtime | Forward baseline → candidate (ms) | Speedup | Inverse baseline → candidate (ms) | Speedup |
| ------- | --------------------------------: | ------: | --------------------------------: | ------: |
| Node    |                     69.09 → 59.43 |  1.163× |                     66.80 → 63.81 |  1.047× |
| Bun     |                     69.02 → 61.12 |  1.129× |                     65.13 → 62.86 |  1.036× |

A separate direct Bun comparison against **TypeScript**:

| Direction | TypeScript → candidate (ms) | Speedup |
| --------- | --------------------------: | ------: |
| Forward   |               85.85 → 60.98 |  1.408× |
| Inverse   |               98.96 → 62.69 |  1.579× |

Earlier isolated prototypes reached 1.173×/1.048× on Node and 1.185×/1.037× on
Bun versus merged Wasm. The table above measures the final artifact, including
its regression-test export. The difference illustrates run/build sensitivity;
the Bun forward shipping bar remains close, not a guarantee across workloads.
Small-call crossover and browser timings were not measured in this follow-up.

Raw rounds: [Node](results/arithmetic/node-performance.txt),
[Bun](results/arithmetic/bun-performance.txt),
[Bun vs TypeScript](results/arithmetic/bun-vs-ts.txt).

Artifact SHA-256 (not committed binaries):

- Baseline: `3fdf1835f579c96cc73877b2feaa89638efed046a61cc4466a8952dde9139d56`
- Candidate: `d9d3f23553c95c9a3662d47b4f012ffc6875a1e6231d94d1609f838895f43bdb` (21,178 bytes)

## Output matrix and correctness

[Readable matrix](results/arithmetic/outputs.md),
[per-zone/hemisphere CSV](results/arithmetic/outputs.csv),
[summary JSON](results/arithmetic/outputs.json).

- 1,143,040 forward and 1,143,040 inverse grid pairs: all `Object.is`-identical
  to the merged Wasm kernel, zero ordinate deltas. The ±30° and ±45° grids overlap.
- 280 exceptional pairs and 240 raw-equator pairs: all identical, no
  classification or signed-zero differences.
- 6,400 API ordinate comparisons: no differences or output-buffer identity failures.
- Independent 91-point fixture: max Δx 1.397e-9 m, Δy 1.863e-9 m,
  weighted Δlongitude 1.776e-14°, Δlatitude 2.842e-14°; passes 5 nm / 1e-13°.
- Fresh package checks: formatting, lint, types, build, all 67 tests.
  Native Rust: six tests. Artifact checks, wrapper checks and the three-way
  accuracy suite pass. Extended sweeps report at most 2 ulp; they are diagnostic,
  not an enforced gate.

One `check` CI job pins Node 24.21.0, Rust 1.99.0 and Bun 1.4.2
(Bun installs/builds; Node runs the checks). It runs the full package checks once,
then host Rust tests, artifact/allocator/math checks, wrapper checks that assert
the SIMD path, and numerical grids plus independent fixtures. Rust dependencies
and their build outputs are cached for the `experiments/utm-wasm` workspace;
SIMD/scalar artifacts are rebuilt from the checked-out source with locked dependencies.
There are no performance thresholds or runtime benchmark matrices.

The duplicate Node 22 job and PR-level Node 20 job are removed. The release
workflow runs the built-package smoke test on Node 20 before publishing, then
restores Node 24 for npm and development tools. This retains a release gate for
the package's advertised Node >=20 support. A prebuilt, digest-pinned toolchain
image is deferred: the measured setup cost is small (Rust setup about 7 seconds;
Bun dependency install 0–1 seconds), and an image adds download/rebuild overhead.

## Additional candidates explored

Both candidates were layered on the earlier log+reciprocal prototype, reviewed
independently, and preserved tested outputs. Neither earned inclusion:

| Candidate                                                     | Node forward / inverse speedup | Bun forward / inverse speedup |
| ------------------------------------------------------------- | -----------------------------: | ----------------------------: |
| Guard unused `atan` reciprocal/reduction divisions            |                1.002× / 0.993× |               0.999× / 1.001× |
| Guard `sincos` reduction when both lanes satisfy abs(x) < π/4 |                0.999× / 0.992× |               1.002× / 0.998× |

Future work should prioritize workspace lifetime and copies, coefficient caching,
and a separately leased direct-memory API before more arithmetic branches.

## Reproduce

Run from the candidate repository root, with Node 24.21.0 and Rust 1.99.0:

```sh
git worktree add --detach /tmp/fast-proj-wasm-baseline 91ca334
(cd /tmp/fast-proj-wasm-baseline && bash experiments/utm-wasm/scripts/build.sh && bash experiments/utm-wasm/scripts/embed-artifact.sh)
bun install --frozen-lockfile
bun run build
bash experiments/utm-wasm/scripts/build.sh
bash experiments/utm-wasm/scripts/embed-artifact.sh
node experiments/utm-wasm/bench/checks.mjs
node experiments/utm-wasm/bench/wrapper-checks.mjs
node experiments/utm-wasm/bench/accuracy.mjs
node packages/utm/bench/compare-outputs.mjs --base=/tmp/fast-proj-wasm-baseline/experiments/utm-wasm/utm.js --candidate=experiments/utm-wasm/utm.js --markdown=/tmp/outputs.md --csv=/tmp/outputs.csv --summary=/tmp/outputs.json
node experiments/utm-wasm/bench/perf-1e6.mjs --base=/tmp/fast-proj-wasm-baseline/experiments/utm-wasm/utm.js --repeats=3
node experiments/utm-wasm/bench/perf-1e6.mjs --runtime=bun --base=/tmp/fast-proj-wasm-baseline/experiments/utm-wasm/utm.js --repeats=3
node experiments/utm-wasm/bench/perf-1e6.mjs --runtime=bun --repeats=3
```

The output-comparison harness checks fixture/classification/zero/API correctness;
its grid deltas are reports. The separate `accuracy.mjs` suite enforces the grid
precision tolerances. Do not replace that CI gate with baseline agreement alone.
