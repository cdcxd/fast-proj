---
'fast-proj': minor
---

New output arrays are typed `Float64Array<ArrayBuffer>`, so they type-check where TypeScript 5.7+ wants an `ArrayBuffer`-backed array (`Blob`, `fetch` bodies, WebGL); output buffers you pass come back with their own type. The types now need TypeScript ≥ 5.7. The wasm module is exported as `fast-proj/fast-proj.wasm`, for bundlers that need its URL imported explicitly.
