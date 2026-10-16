---
'fast-proj': patch
---

`gcj02` inverse (`toWgs84`): two Newton steps replace four fixed-point steps, in JavaScript and WebAssembly. 25–46% faster and 3–20× more accurate: within 3e-12° of the exact inverse (was 2e-11°). Results move by up to 2e-11°.
