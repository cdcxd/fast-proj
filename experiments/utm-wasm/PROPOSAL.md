# Proposal: Rust → wasm32+simd128 UTM batch kernel (experiment)

Status: **DRAFT — reviewed (approve-with-changes), awaiting owner decision.** Supersedes
`PLAN.md` (whose 3× target and coefficient-generator TODO are resolved or revised by
measurement). Review findings incorporated.

Branch: `experiment/utm-wasm` (smoke prototype committed at `b02191c`). Nothing here touches
`@fast-proj/utm`'s published TypeScript package.

## Question

Can a Rust → wasm32 + `simd128` (f64x2, 2 lanes) kernel beat the merged TypeScript kernel
(Node fwd 1.09 ms / inv 1.03 ms per 10k; Bun 0.76 / 0.92) for **large batch** UTM conversion,
by enough to justify an opt-in artifact — and at what accuracy/packaging cost?

## What is already built and measured (smoke phase)

Crate `experiments/utm-wasm`: bump allocator over exported wasm memory (JS holds zero-copy
`Float64Array` views — no copies across the boundary), batch exports (`sincos_batch`,
`atan_batch`, `exp_batch`, `log_batch`, `noop`, `copy_f64`), two builds from one source:
`+simd128` hand vector math, and a scalar build backed by the `libm` crate (musl port) as a
proven cross-check.

Vector math: minimax-quality coefficients from `tools/gen_coeffs.py` (mpmath Chebyshev fits at
60 dps, rounded to double): sin ≤4.5e-18, cos ≤8.9e-19, exp ≤2.8e-19, log ≤1.9e-19,
atan ≤1.5e-18 approximation error. Cody–Waite reduction (3-term π/2 split), polynomial atan
(no division), exponent bit-stuffing exp, [√½,√2) log.

**Accuracy** (20k-point domain sweeps, max ulp vs `Math.*`, both builds, Node + Bun):
sincos 1, atan 2–3, exp 1, log 2 — established on the sweep ranges (sincos ±π, atan ±8,
exp ±1.2, log [0.3, 2]). The prototype is gated on **extended sweeps first**: log across
binades (≈2^±20 plus mantissa-dense sampling), exp to ±200, atan to ±1e12 with dense sampling
at the tan(π/8) and |x| = 1 seams — the kernel's actual argument ranges (forward near-pole
`sc/ccl` reaches ~1e10; inverse diagnostics reach η ≈ 188).

**Performance** (median-of-samples, fresh inputs; ns/point; Ryzen 9 3900X):

| op            | Node 24, n=1e4 js→simd |                  Node 24, n=1e6 js→simd | Bun 1.4, n=1e4 js→simd |                  Bun 1.4, n=1e6 js→simd |
| ------------- | ---------------------: | --------------------------------------: | ---------------------: | --------------------------------------: |
| sincos        |      24.8 → 9.7 (2.6×) |                       28.0 → 9.7 (2.9×) |      22.3 → 9.0 (2.5×) |                       23.9 → 9.0 (2.6×) |
| atan          |     8.7 → 10.2 (0.85×) |                      21.2 → 10.9 (1.9×) |      8.9 → 9.8 (0.91×) |                       17.8 → 9.8 (1.8×) |
| exp           |      23.4 → 6.0 (3.9×) |                       26.9 → 6.0 (4.5×) |      5.2 → 5.5 (0.95×) |                       13.4 → 5.5 (2.4×) |
| log           |      30.4 → 8.3 (3.7×) |                       24.7 → 8.3 (3.0×) |      5.2 → 6.9 (0.76×) |                       13.4 → 7.0 (1.9×) |
| _scalar libm_ |                      — | sincos 20.0, atan 9.3, exp 8.9, log 7.7 |                      — | sincos 21.8, atan 9.5, exp 8.5, log 6.9 |

Boundary costs: wasm call 60–120 ns (amortizes to noise at n ≥ 1k); memcpy 0.17 ns/point.

Two facts matter for the decision:

1. **JS transcendental speed is working-set-dependent**: Bun's JIT-inlined `exp`/`log`/`atan`
   win at n=1e4 (L2-resident) but degrade 1.5–2.6× at n=1e6, where wasm simd wins every op on
   both runtimes. Large-batch users — the audience for this kernel — live at n ≥ 1e6.
2. **2 lanes cap the per-op ceiling at 1.8–4.5×** at the decision size: atan is the floor
   (1.8–1.9×, and the inverse calls it twice), exp the top (4.5×).

## Kernel budget and expectation

From `packages/utm/src/utm.ts` @ `bb3620d`: forward = **two** sincos pairs (φ and λ) + one
`atan` (ξ′) + `log1p` (η′) + sqrt/normalization + polynomial recurrences; inverse = one sincos
pair (ξ) + `exp` (η) + **two** `atan` (λ, χ) + sqrt + recurrences. At n=1e6 (Node per-op
table) the transcendental share is ≈ 102 of ≈ 130 ns/pt ≈ **75–80%**. Replacing with simd
per-op costs gives ≈ 39 ns of math + ≈ 28 ns of the rest ≈ 67 ns/pt → **≈ 1.9× forward**,
similar or better inverse (exp 4.5×, atan 1.9× floor twice); if the tight wasm loop also
compounds gains in the polynomial part, **≈ 2–2.4×** is reachable. Estimate band:
**1.7–2.4× end-to-end at n ≥ 1e6**. This is an estimate to be settled by measurement.

**Decision bar (replaces PLAN.md's 3×):** ship an opt-in `@fast-proj/utm/wasm` subpath if the
prototype reaches **≥ 1.4× on both Node and Bun at n = 1e6, forward and inverse**, with
accuracy acceptance below. 1.25–1.4×: judgment call, default no. < 1.25×: close, publish
RESULTS.md, keep the smoke crate as the record. Chromium is **report-only** in the perf
protocol (same V8 as Node); a Chromium regression does not block shipping.

## Options

- **A. Build the full prototype now (recommended).** The risk is now measured, not guessed:
  the vector math exists and passes; the kernel port is mechanical (the TS source is the spec),
  and the PR #1 comparison harness (grids, fixture, signed-zero, classification) is reusable
  with the wasm kernel swapped in. Estimated one working session. Produces a definitive
  go/no-go with numbers, and the PR-ready experiment if it passes.
- **B. Close now.** Justified only if a 1.7–2.4× ceiling for large batches is already below the
  product bar. Costs nothing further; the smoke crate remains the evidence.

## Prototype spec (option A)

### Kernel

- Exports (C ABI): `forward_batch(lonp, latp, xp, yp, n, zone, south, a, f)` and
  `inverse_batch(xp, yp, lonp, latp, n, zone, south, a, f)`; tmSeries coefficients computed
  per call (negligible at n ≥ 1e4). Port the merged kernel formula-for-formula
  (`packages/utm/src/utm.ts` @ `bb3620d`).
- eta′ vector form: port the TS `log1p(she + she²/(ir+1))` as `vlog1p` (log poly on the exact
  argument) rather than the atanh identity — keeps the same rounding shape as TS, minimizing
  acceptance deltas.
- Guards, ported verbatim per site (do not generalize): forward η′ falls back to `asinh` when
  `|she| > 1024`; inverse λ uses `atan2` unless `cx > 0 && isFinite(she)`; inverse χ uses
  `atan2` unless `h > 0 && isFinite(sx)`. Vectorized via select for the arithmetic, but hoist
  a scalar "any lane needs the guard" test per batch chunk and branch — simd has no lane
  predication, so select-only vectorization would pay the fallback chain on every iteration;
  in-domain data never fires the guards, so the hoisted branch is the fast path.
- `vexp` must saturate correctly beyond the current ±1000 k-clamp (finite ≈2^1000 where libm
  gives ±Inf): select ±Inf/±0 on the overflow mask (|k| ≥ 1075) so classification parity holds
  for the extreme diagnostics.
- Signed zeros: inverse `+0` correction and forward equator behavior ported verbatim; verified
  with `Object.is` on the equator suite from PR #1.

### Memory contract

The bump allocator never frees. Contract: the JS wrapper allocates every buffer **once** and
reuses it across calls (including a persistent n=1 pair for point-API routing); harnesses
reuse the same scratch. The allocator bounds check becomes a release-mode trap (checked panic,
not `debug_assert`), and `heap_reset()` is exported for multi-phase harnesses. Heap static
gets `#[repr(align(8))]` so f64 pointers are formally aligned.

### Accuracy acceptance

Harness: `packages/utm/bench/compare-outputs.mjs` pattern against the TS kernel, with the wasm
wrapper implementing the full `Utm` API surface (point/interleaved/batch forms, buffer
identity, RangeError behavior) so point-API grid loops exercise the kernel.

Thresholds (calibrated to the repo's TS-vs-TS envelope — max Δlon 2.84e-14°, Δy 3.7e-9 m —
plus 2–3 output-ulp headroom; sub-ulp absolute thresholds would demand bit-identity, which
non-identical atan/log1p implementations cannot deliver):

- PR grids (5 ellipsoids incl. sphere and f=0.0099999, ±30°/±45°, zones 1/31/33/60, both
  hemispheres, integer lats + near-poles + signed-zero lat): max |Δx|, |Δy| ≤ **5e-9 m**;
  max Δlat ≤ **1e-13°**; max Δlon·cos φ ≤ **1e-13°**.
- Fixture: ≤ 5e-9 m and ≤ 1e-13° (the harness's own gate).
- Zero classification discrepancies inside |λ| < 90° (guards included); equator signed zeros
  identical (`Object.is`); out-of-domain: NaN/Inf classification matches the TS head for the
  PR diagnostics suite.

### Performance protocol

PR-style (150 warmups, 51×5 samples, 3 fresh processes, alternating), n = 1e4 and 1e6,
Node + Bun (+ Chromium, report-only), simd.wasm vs TS kernel. Results in
`experiments/utm-wasm/RESULTS.md`.

### Testing

- Host `cargo test` for target-independent pieces: constants decode-asserted against computed
  values (a wrong hex π/8 cost an hour this week), pure f64 logic. Requires restructuring:
  `#![cfg_attr(not(test), no_std)]`, panic handler behind `#[cfg(not(test))]`.
- Simd-path tests run under wasm (a no_std test export driven from Node, reusing the bench
  harness pattern): quadrant masks 64-bit-lane-aligned, atan seams at tan(π/8) and |x| = 1,
  log halving seams at powers of two, exp negative k and overflow saturation, NaN/Inf/±0
  propagation, odd-n tails.

### Packaging (only if the bar is met)

Ship `simd.wasm` (3.3 kB today; ~12–18 kB with the kernel, base64 ≈ +33%) behind a
TLA-initialized `@fast-proj/utm/wasm` module exporting the full `Utm` interface, wasm-backed
for all forms. Feature-detect via a simd128 probe module; fall back to the **TS kernel** when
absent (V8/SpiderMonkey: 2021; JavaScriptCore: Safari 16.4, 2023 — detection makes the dates
moot). No scalar wasm artifact, no changes to the default package.

## Pitfalls already paid for (encoded as tests above)

i32-lane masks from `trunc_sat_f64x2_zero` do not align with f64 lanes (compute quadrant masks
in f64 space); no f64→i64 lane conversion exists (demote→i32→extend path for exp k);
`bitselect(v1, v2, c)` picks `v1` where `c` bits are 1; `π/2` compensation and `+π/8` belong
on the _result_, not the poly argument; log mantissa must be normalized into [√½, √2) for the
fit domain; select-based "branches" execute on all lanes (hoist real branches); edition-2024
needs `#[unsafe(no_mangle)]`; `f64::round` doesn't exist in `no_std` core (use
`f64x2_nearest` / a 2^52 trick).

## Environment / reproducibility

- Stable Rust 1.99 + `wasm32-unknown-unknown` + `rust-src`; devcontainer bundles the toolchain
  (`.devcontainer/devcontainer.json`). Nightly + `std::simd` was considered and is **not**
  useful here: wasm32 simd128 exposes exactly 2 f64 lanes regardless; `core::arch::wasm32`
  intrinsics on stable already emit them precisely.
- Coefficients: `tools/gen_coeffs.py` (checked in) regenerates all five fits with validation;
  mpmath required.

## Timeline

One session: kernel port + unit tests (½), extended sweeps + harness runs + perf (¼),
RESULTS.md + PR draft (¼).
