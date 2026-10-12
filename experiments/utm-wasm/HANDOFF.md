# HANDOFF: wasm simd UTM kernel experiment — resume after compact

Status at handoff (2026-10-11): kernel ported and **math-gated 3-way**; preliminary perf
measured; full perf protocol + RESULTS.md + PR draft remain. Branch
`experiment/utm-wasm` on top of `main` (`bb3620d`); commits through the accuracy gate.
Work dir: `/home/cdong/Code/fast-proj/experiments/utm-wasm` (work in place; PR from this
branch when done — main requires PRs).

## Decisions locked (user)

- 3-way correctness: wasm vs TS kernel vs **proj4 as independent truth** (implemented in
  `bench/accuracy.mjs`; catches "our impl wrong, proj4 right" on either side).
- Rust unit tests gate target-independent logic (`cargo test`), JS suites gate the wasm
  artifact. Nightly `std::simd` NOT used (2 f64 lanes regardless; typed masks would help
  ergonomics — consider a bounded spike only if the kernel ships).
- Decision bar (PROPOSAL.md): ship opt-in `@fast-proj/utm/wasm` iff **≥1.4× on Node AND
  Bun at n=1e6, fwd+inv**; 1.25–1.4× judgment call (default no); <1.25× close.
  Chromium report-only.

## State: DONE

- Crate split: `src/math.rs` (coeffs/constants/libm wrappers), `src/simd.rs` (f64x2
  primitives: vsincos/vatan/vatan2/vexp/vlog/vlog1p + pair load/store), `src/kernel.rs`
  (tmSeries `make_k`, scalar kernel via libm — **bit-exact vs TS**), `src/vkernel.rs`
  (f64x2 kernel twin), `src/alloc.rs` (bump arena, release trap, `heap_reset`),
  `src/lib.rs` (ABI exports + dispatch + `#[cfg(test)]` host tests). Deps: `libm`
  (runtime), `serde_json` (dev-only). `scripts/build.sh` builds scalar+simd into `build/`.
- Host tests (6, passing): constants decode, series sanity (kA ≈ 6364902, sphere-zero
  series), scalar kernel vs fixture (5e-9 m, 1e-13° cos-weighted), guard NaN.
- JS gates (passing Node+Bun): `bench/sweeps.mjs` (extended math sweeps ≤2 ulp),
  `bench/checks.mjs` (quadrants, atan/log/exp seams incl. atan2(±Inf,±Inf)=±π/4, tails,
  allocator, equator signed zeros Object.is, guard classification, out-of-domain
  diagnostics parity, grid sweep), `bench/accuracy.mjs` (**3-way gate: PASS**).
- 3-way results: wasm-vs-TS fwd ≤3.73e-9 m, inv ≤5.7e-14° cos-weighted; both wasm and TS
  within 7.5e-9 m of proj4 on identical worst rows (equal accuracy, no shared error);
  fixture 1.9e-9 m / 2.8e-14°; 0 classification/signed-zero diffs on all 160 grid combos
  (±30/±45 × 5 ellipsoids × zones 1/31/33/60 × hemispheres × 188 lats).
- Wrapper `wasm-utm.mjs`: full `Utm` API surface (batch/interleaved/point, RangeErrors),
  simd feature-detect with TS fallback, allocate-once scratch.

## State: MEASURED, PRELIMINARY (single process, median; `bench/perf-quick.mjs`)

Node 24: raw wasm vs TS — fwd 1.34× @1e4, 1.47× @1e6; inv 1.04× @1e4, 1.25× @1e6.
Bun 1.4: ~parity @1e4 (0.99×); @1e6 fwd 1.13×, inv 1.10×. Wrapper (realistic API):
Node 0.90–1.06×, Bun 0.98–1.00× — **wrapper overhead eats the win**; the per-chunk
element-wise JS copy loops and 16384 CAP are the cause.

Honest read: current raw numbers sit at/under the 1.4× bar (fwd 1.47× @1e6 Node passes;
inverse 1.25× does not). Not yet a ship decision — optimization levers below are
untried and cheap.

## Next steps, in order

1. **Wrapper fast path** (biggest lever, ~zero risk): use `.set()` for all copies (native
   memcpy, replaces per-element loops in `forwardChunk`/`inverseChunk`/interleaved),
   cache `Float64Array` views per buffer instead of per call, and size CAP to the batch
   (allocate-once up to n; heap is 256 MiB — cap at e.g. 2^20 and chunk only beyond).
   Expect wrapper ≈ raw + ~5%.
2. **Kernel guard-path pruning**: in `vkernel.rs` the lam/chi selects evaluate BOTH
   `vatan(ratio)` and `vatan2(...)` unconditionally; hoist an any-lane scalar test like
   the existing eta′ guard so the atan2 body only runs when some lane needs it (in-domain
   never does). Same idea for `vlog1p` (lm/lg both computed). Inverse is the weak
   direction (1.25×) and carries both costs.
3. **Full PR-style perf protocol**: fresh processes, 150 warmups, 51×5 samples, 3 rounds
   alternating TS/wasm, n=1e4 and 1e6, Node + Bun (+ Chromium report-only via the
   `--browser` pattern from `packages/utm/bench/compare-performance.mjs`). Candidate =
   the wrapper (the shipping shape), TS = `packages/utm/dist`. Then decide vs the bar.
4. **RESULTS.md**: machine/runtimes, 3-way accuracy tables, perf tables, artifact sizes
   (simd.wasm 16.6 kB with kernel; base64 +33%), the `vexp` ±1000 k-clamp scope note
   (classification parity holds for |x| ≤ ~4.4e9 m = the diagnostics suite; beyond,
   vexp returns finite ~2^1000 where libm gives Inf), and the `std::simd` note.
5. **PR draft** from `experiment/utm-wasm` (title/summary per PROPOSAL.md; include
   RESULTS tables, decision, and the devcontainer toolchain note already committed).

## Gotchas paid for (do not relearn)

- `i32x4_trunc_sat_f64x2_zero` masks are i32-lane — NOT f64-lane aligned; quadrant masks
  must be computed in f64 space with an **unsigned** residue (signed −1 took the q==1
  pattern and flipped sin signs for k≡−1 mod 4).
- `v128_bitselect(v1, v2, c)` returns **v1 where c=1** (twice had branches swapped).
- No f64→i64 lane conversion; exp k goes f64→f32 (exact for |k|≤1000)→i32→i64-extend.
- `#[repr(align)]` cannot apply to statics (wrap in a struct); `addr_of_mut!` for the
  base pointer (2024 denies `&mut static`); edition-2024 needs `#[unsafe(no_mangle)]`;
  `f64::round` absent in no_std core.
- cargo test needs `#![cfg_attr(not(test), no_std)]` + `#[cfg(not(test))]` panic handler;
  integration tests in `tests/` are a separate crate (kept tests inline in lib.rs).
- proj4 `+rf` must be full precision (`String(1/f)`, NOT toFixed — a rounded rf moved the
  ellipsoid by 3.7e-5 m and failed BOTH kernels "equally").
- Build dispatch gotcha: `cargo build` exit-code grep patterns can copy stale artifacts;
  always verify `Compiling` appeared, or use `scripts/build.sh`.
- Wrapper import depth: from `experiments/utm-wasm/*.mjs` the package is
  `../../packages/...`; from `bench/` it is `../../../packages/...`.

## Environment

Rust 1.99.0 stable + `wasm32-unknown-unknown` + `rust-src`; `cargo test --release` for
host tests; `scripts/build.sh` for artifacts; Node 24.21 / Bun 1.4.2; proj4 2.22 from the
repo root node_modules; fixture `packages/utm/test/fixtures/reference.json` (zone 31,
CM 3°E, decimal strings). Devcontainer bundles the toolchain (already committed).
