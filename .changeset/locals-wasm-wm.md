---
'fast-proj': patch
---

Faster WebAssembly GCJ-02 and Web Mercator batches, steadier Bun transverse Mercator batches. JavaScript backend: the transverse Mercator batch loops read the projection's coefficients as locals, which removes a case where Bun ran them 7–10% slower (a converter timed on its own; the README benchmark already got the fast code), with Node and Chromium unchanged and output bit-identical. WebAssembly backend: GCJ-02 `fromWgs84` batches are 10% faster; the Web Mercator inverse takes the JavaScript kernel's formulas, 3% faster and within four ulps of the exact latitude instead of seven (worst 2.1e-14° instead of 2.8e-14°), with a slightly smaller `.wasm`.
