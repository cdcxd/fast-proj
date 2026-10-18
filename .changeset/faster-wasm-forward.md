---
'fast-proj': patch
---

`loadWasm()`: the batch `fromLonLat` methods of `tmerc`/`utm` are 17–24% faster in Node, Bun and Chromium. Results move by a few ulp and stay within the documented 4e-9 m of the JavaScript backend.
