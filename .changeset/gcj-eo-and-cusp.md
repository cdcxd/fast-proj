---
'fast-proj': patch
---

`loadWasm()`: the batch GCJ-02 conversions are faster in Node, Bun and Chromium: `fromWgs84` by 5–11%, `toWgs84` by 3–8%, GCJ-02 `fromLonLat` by 1–3%. The docs now note that just west of longitude 105° the formula folds over, so a GCJ-02 point within 2.6e-12° of it can have three exact WGS84 inverses; `toWgs84` is within 3e-12° of one of them.
