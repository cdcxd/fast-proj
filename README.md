# fast-proj

[![npm](https://img.shields.io/npm/v/fast-proj)](https://www.npmjs.com/package/fast-proj)
[![CI](https://github.com/cdcxd/fast-proj/actions/workflows/ci.yml/badge.svg)](https://github.com/cdcxd/fast-proj/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/fast-proj)](LICENSE)

Fast coordinate conversions for JavaScript and TypeScript. Optimized arithmetic and typed-array batching support
reusable output buffers and in-place conversion, with no per-point allocations in the batch APIs, and an optional
Rust/WebAssembly SIMD backend for large batches.

```sh
npm install fast-proj
```

| package                           | contents                                                           | docs                                             |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| [`fast-proj`](packages/fast-proj) | UTM and transverse Mercator ↔ WGS84, GCJ-02, GeoJSON helpers, wasm | [API](docs/api.md) · [from proj4](docs/proj4.md) |

## Performance

Batch speedups over a reused **proj4 2.22** converter, for 10,000 points in UTM zone 33N (median of 31 samples; higher
is faster), JavaScript / WebAssembly backend:

| Operation                |         Node 24 |         Bun 1.4 |     Chromium 156 |
| ------------------------ | --------------: | --------------: | ---------------: |
| WGS84 → UTM              | **4.8× / 9.7×** | **3.4× / 4.5×** | **3.6× / 10.4×** |
| UTM → WGS84              | **4.8× / 8.4×** | **2.7× / 4.5×** |  **3.2× / 8.7×** |
| UTM → GeoJSON LineString | **4.7× / 7.6×** | **2.7× / 4.4×** |  **3.2× / 8.1×** |

GCJ-02 against **gcoord 1.0.7**, 10,000 points, JavaScript:

| Operation      |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | **10.9×** | **11.7×** |     **4.9×** |
| GCJ-02 → WGS84 |  **5.1×** |  **6.2×** |     **3.5×** |

Timings vary with hardware, runtime and dataset. See the [full benchmark and reproduction commands](packages/fast-proj/README.md#benchmark).

## Development

Uses [Bun](https://bun.sh) workspaces (package manager), vitest, oxlint, oxfmt, TypeScript 7 and Rust 1.99 (for the
wasm build; `rustup target add wasm32-unknown-unknown`). A devcontainer is included.

```sh
bun install
bun run check    # format, lint, typecheck, build (TS + wasm), test
cd packages/fast-proj && bun run bench    # Node, Bun and Chromium
```

## License

MIT
