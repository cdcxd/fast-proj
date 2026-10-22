---
'fast-proj': patch
---

Faster batch conversions; results are unchanged within the documented bounds. JavaScript backend: the transverse Mercator kernels take atan, and asinh within about 6° of the central meridian, from inline polynomials and series instead of `Math.atan`/`Math.log1p`, and the Web Mercator inverse takes its latitude from an inline exp and atan instead of `Math.atan(Math.sinh(…))`. The batch loops also read their constants as literals: V8 reloads module constants on every use in a loop compiled while it runs. Batch calls are 17–42% faster in Node, 10–47% in Chromium (GCJ-02 `fromWgs84` and Web Mercator `fromLonLat` unchanged there) and up to 14% in Bun, except Web Mercator `toLonLat`, 10% slower there. WebAssembly backend: transverse Mercator and GCJ-02 batch calls are 7–12% faster, from sin/cos without the general range reduction and sinh/cosh/asinh from series near the central meridian.
