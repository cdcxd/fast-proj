---
'fast-proj': patch
---

Faster point methods (17-36% in Node and Chromium; Web Mercator's 36-53%) and the `'transform'`-mode GCJ-02 inverse (40-46%; Bun 15%), from kernels that no longer return through closure variables. Wasm interleaved batches of 256 points or more 3-7% faster in V8 (1-3% slower in Bun). The `.wasm` drops its bench-only exports: 78 to 72 kB. Finite results are bit-identical; the sign and payload of a NaN result may differ.
