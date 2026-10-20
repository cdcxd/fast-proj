---
'fast-proj': patch
---

`loadWasm()`: the batch GCJ-02 conversions are faster in Node, Bun and Chromium: `fromWgs84` by 5–11%, `toWgs84` by 3–8%, GCJ-02 `fromLonLat` by 1–3%. The docs now note that the formula folds over just west of longitude 105°: GCJ-02 points within about 6e-13° of the fold's tip (105.0054° at latitude 55.8°) can have three exact WGS84 inverses, up to 2.6e-12° west of 105°; `toWgs84` is within 3e-12° of one of them.
