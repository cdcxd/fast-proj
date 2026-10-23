---
'fast-proj': patch
---

Faster WebAssembly batches in V8 (Node, Chromium, Deno): the GCJ-02 kernels and the transverse Mercator forward take two coordinate pairs at a time through the same code, so their dependency chains overlap. GCJ-02 `toWgs84` is 13% faster, GCJ-02 → UTM 11%, UTM `fromLonLat` 7% and GCJ-02 `fromWgs84` 6%; Bun is within 2%. Output is unchanged, bit for bit. The `.wasm` grows from 57 to 75 kB (18 to 23 kB gzipped). Both backends' Web Mercator inverse multiplies by 1/R instead of dividing, 2–3% faster, with the latitude within an ulp of before.
