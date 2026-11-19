---
'fast-proj': patch
---

Faster point methods (17-36% in Node and Chromium; Web Mercator's 36-53%) and the `'transform'`-mode GCJ-02 inverse (40-46%; Bun 15%), from kernels that no longer return through closure variables. Wasm interleaved batches 2-7% faster in V8. The `.wasm` drops its bench-only exports: 78 to 72 kB. Results are bit-identical.
