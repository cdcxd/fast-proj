---
'fast-proj': patch
---

`loadWasm()`: the batch `toLonLat` methods of `tmerc`/`utm` are 14–16% faster. Results move by a few ulp and stay within the documented 6e-14° of the JavaScript backend.
