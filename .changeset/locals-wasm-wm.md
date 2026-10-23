---
'fast-proj': patch
---

Faster batch conversions in Bun and in WebAssembly. JavaScript backend: the transverse Mercator batch loops read the projection's coefficients as locals, 7–10% faster in Bun (unchanged in Node and Chromium, output bit-identical). WebAssembly backend: GCJ-02 `fromWgs84` batches are 10% faster; the Web Mercator inverse takes the JavaScript kernel's formulas, 3% faster and within four ulps of the exact latitude instead of seven (worst 2.1e-14° instead of 2.8e-14°), with a slightly smaller `.wasm`.
