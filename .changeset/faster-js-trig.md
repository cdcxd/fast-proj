---
'fast-proj': patch
---

JavaScript backend: the `tmerc`/`utm`, GCJ-02 and Web Mercator forward kernels take sin/cos from inline polynomials instead of `Math.sin`/`Math.cos`, and the transverse Mercator inverse takes sinh/cosh from a series instead of `Math.exp`. Batch calls are 15–62% faster in Chromium and 4–38% in Bun; in Node, whose `Math.sin` is about twice as fast as Chromium's, they range from 8% faster to 7% slower. Results move by a few ulps: Web Mercator y is now within five ulps of the correctly rounded value, as in wasm (three before), GCJ-02 `fromWgs84` within one. The documented transverse Mercator forward bound is now 5e-9 m (from 4e-9 m), which the wasm backend already needed (it reaches 4.7e-9 m within 30° of the central meridian), and the two backends agree within 5e-9 m, or 7.5e-9 m above 2^24 m.
