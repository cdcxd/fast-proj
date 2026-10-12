# Superseded by PROPOSAL.md (measured data, revised decision bar).

# Handoff: Rust + WASM SIMD UTM kernel experiment

Status: PLAN ONLY (nothing built). Started 2026-10-11. Owner resumes after context compact.

## Goal

Quantify whether a Rust → wasm32 + `simd128` (f64x2, 2 lanes) kernel beats the TypeScript kernel for **large batch** UTM conversion, by how much, and at what packaging/accuracy cost. Experimental prototype in this worktree — NOT integrated into `@fast-proj/utm`, no changes to the published package.

Baseline to beat (PR #1 head `2aea9e8`, Ryzen 9 3900X, ms per 10k points, split buffers):

| Runtime      | forward | inverse |
| ------------ | ------: | ------: |
| Node 24      |    1.07 |    1.13 |
| Bun 1.4      |    0.76 |    0.98 |
| Chromium 150 |    2.16 |    1.88 |

TS ceiling context: transcendentals are ~75% of remaining time (Node ns/pt: sin 12.9, cos 13.5, exp 12.0, atan 8.6, atan2 17.7, asinh 19.0; Bun roughly half that; sqrt ~1). A wasm scalar build isolates the "Rust/no-JIT" win; the simd build adds the vector-math win.

## Environment (already prepared)

- Worktree: `/tmp/fp-rust` at `main` (`1a19065`); crate dir `experiments/utm-wasm/` (empty `src/`).
- Rust 1.97.1, target `wasm32-unknown-unknown` installed.
- Python venv `/tmp/fpvenv` with mpmath, numpy, scipy.
- Coefficient generator: `/tmp/gen_coeffs.py` (v2, Chebyshev-basis fits + mpmath validation, atan rational via scipy). **Not yet run successfully** — expected fits: sin `r+r³S(r²)` ≤3e-17 ✓, cos `1+r²C(r²)` (deg-7 in r², conditioning fixed via Chebyshev basis — verify ≤1e-17), exp `1+r+r²E(r)` ≤3e-17 ✓, log `2s+2s³L(s²)` ≤3e-18 ✓, atan `u+u³P(u²)/Q(u²)` rational (needs the v2 run). If cos still fails, split range or raise degree to 9.
- JS kernel for comparison: build `/tmp/fp-rust/packages/utm` (or import from the PR repo `packages/utm/dist` if merged).

## Crate design

`experiments/utm-wasm/Cargo.toml`: `[lib] crate-type = ["cdylib"]`, no dependencies, `[profile.release] opt-level=3, lto=true, codegen-units=1`. Build twice:
cargo build --release --target wasm32-unknown-unknown # scalar.wasm
RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown # simd.wasm

```

Exports (C ABI, `#[no_mangle] pub extern "C"`): `alloc(n: usize) -> *mut f64` (bump allocator, memory exported by default), `forward_batch(lonp, latp, xp, yp, n, zone: u8, south: u32, a: f64, f: f64)`, `inverse_batch(xp, yp, lonp, latp, n, ...)`. Compute `tmSeries` coefficients inside per call (negligible for n ≥ 10k). Port the **PR-head kernel** (`packages/utm/src/utm.ts` at `2aea9e8`, including the `log1p` eta′ form and guarded `atan`) formula-for-formula; coefficients via the same `tmSeries` expressions (`ellipsoid.ts`).

Vector math (`core::arch::wasm32`, f64x2, behind `#[target_feature(enable = "simd128")]`):
- `vsin/vcos`: Cody–Waite 3-term π/2 reduction (`k = nearest(x·2/π)`, quadrant `k&3`, select swap/negate), polys above, |r| ≤ π/4. NaN must propagate through selects (test it).
- `vatan`: `a=|x|`; `t = a > 1 ? 1/a : a` (select; keeps quadrant via `x > 1`); then `t > tan(π/8) ? (t−c)/(1+tc) + π/8` branch via select; rational P/Q. Constants: π/2, π/8, c = tan(π/8) split hi/lo as needed.
- `vlog`: exponent strip via `i64x2` bit ops, m ∈ [√½, √2), `s=(m−1)/(m+1)`, poly L; `e·ln2` with hi/lo split.
- `vexp`: `k = nearest(x·log2e)`, 2-part r, poly E, scale by bit-stuffing exponent (clamp k to ±1000; NaN in → NaN out).
- eta′ (forward): prefer `atanh` identity `etap = 0.5·(vlog(1+z) − vlog(1−z))`, `z = cc·sl` (|z|<1 always) — avoids vector log1p entirely. Validate vs the TS `log1p(she + she²/(ir+1))` form on the accuracy harness; both are within ~2 ulp of each other.
- sqrt/div: native `f64x2.sqrt`, `f64x2.div`.
- Tail (odd n): process final point with both lanes splatted, store lane 0 only.

## Acceptance

1. Accuracy vs TS kernel (PR head) on the PR-style grids (5 ellipsoids incl. sphere/f=0.0099999, ±30° and ±45°, zones 1/33/60 both hemispheres, integer lats + near-poles + signed-zero lat): max |Δx|, |Δy| ≤ 3e-9 m; max Δlat ≤ 3e-14°; Δlon·cos(lat) ≤ 3e-15°; zero NaN-classification diffs inside the guarded domain (|λ| < 90°); fixture `packages/utm/test/fixtures/reference.json` within 5e-9 m / 1e-13° (zone 31, CM = 3°E — note: NOT 15).
2. Signed zeros at equator inverse (166000/−0 → −0 etc.) and forward (15, ±0) match TS exactly (Object.is).
3. Speed, Node + Bun, PR-style protocol (150 warmups, 51 samples × 5 calls, median of 3 fresh-process rounds, alternating): report ns/pt and speedup vs TS at n = 10k and n = 1M, forward and inverse, `simd.wasm` and `scalar.wasm`. Also measure per-call boundary overhead at n = 1 (call cost) to state the break-even batch size.
4. Numbers land in `experiments/utm-wasm/RESULTS.md` (machine, runtimes, tables) — not in package docs.

## Known pitfalls

- `f64x2` splat/extract boilerplate; write helpers (`spl`, `mul`, `add`, `fma` via `f64x2.mul`+`add` — wasm has no f64x2 fma; account for it in accuracy, not just speed).
- No `f64x2.min/max` — use `pmin/pmax` or select; NaN semantics differ from scalar `min`.
- Chromium/Bun both support simd128 (baseline since ~2021) — verify with a feature detect in the harness anyway.
- Don't let the tail lane store garbage into `out[n]`.
- `#[target_feature]` unsafe fns: keep the whole batch fn `unsafe` internally, expose safe wrapper.
- Benchmark JS→wasm calls with buffers allocated ON wasm memory (`new Float64Array(memory.buffer, ptr, n)`) to avoid copies; that's the realistic integration shape.

## Decision criteria (for the final report)

- If simd.wasm ≥ 3× TS on Node+Bun at 10k and accuracy holds: recommend a `@fast-proj/utm/wasm` opt-in subpath (async init, ~10-20 kB wasm) for large-batch users; keep TS default.
- If 1.5–3×: report numbers, recommend staying TS unless users convert ≥1e7 pts.
- If < 1.5×: document why (boundary overhead / f64 lane count), close.
```
