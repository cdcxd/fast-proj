---
'fast-proj': patch
---

WebAssembly BD-09 kernels: a wasm context's `bd09()` batch methods run the BD-09 offset in wasm, bit for bit with the JavaScript kernel. GCJ-02 → BD-09 is 1.3–1.5× and BD-09 → GCJ-02 1.5–1.7× the JavaScript backend (Node, Bun, Chromium); WGS84 ↔ BD-09 run the wasm GCJ-02 kernel and the offset in one call, 1.3–1.6× the JavaScript backend (0.6.0's wasm context: 1.15–1.3×). `utm`/`tmerc` with `geographic: ctx.bd09()` run x/y → BD-09 as one call. The `.wasm` grows from 78 to 91 kB (24 to 28 kB gzipped).
