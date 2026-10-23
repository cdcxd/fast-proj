---
'fast-proj': patch
---

Faster batch conversions; results are unchanged within the documented bounds. JavaScript backend: the transverse Mercator kernels take atan, and asinh within about 6° of the central meridian, from inline polynomials and series instead of `Math.atan`/`Math.log1p`, and the Web Mercator inverse takes its latitude from an inline exp and atan instead of `Math.atan(Math.sinh(…))`. The batch loops also read their constants as literals: V8 reloads module constants on every use in a loop compiled while it runs. Batch calls are 17–42% faster in Node, 10–51% in Chromium (GCJ-02 `fromWgs84` and Web Mercator `fromLonLat` unchanged there), and Bun stays within about 8% of 0.5.0 either way. WebAssembly backend: transverse Mercator and GCJ-02 batch calls are 7–12% faster, from sin/cos without the general range reduction and sinh/cosh/asinh from series near the central meridian; the `.wasm` grows by 4.5 kB (53,194 → 57,711 bytes).
