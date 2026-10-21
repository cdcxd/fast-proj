---
'fast-proj': patch
---

JavaScript backend: the `tmerc`/`utm`, GCJ-02 and Web Mercator forward kernels take sin/cos from inline polynomials instead of `Math.sin`/`Math.cos`, and the transverse Mercator inverse takes sinh/cosh from a series instead of `Math.exp`. Batch calls are 15–54% faster in Chromium and 7–35% in Bun; in Node, whose `Math.sin` is about twice as fast as Chromium's, they are 0–10% slower. Results move by a few ulps: Web Mercator y is now within four ulps of the exact value (three before), GCJ-02 `fromWgs84` within one.
