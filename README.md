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

| package                           | contents                                                                         | docs                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`fast-proj`](packages/fast-proj) | UTM, transverse Mercator and Web Mercator ↔ WGS84, GCJ-02, GeoJSON helpers, wasm | [API](docs/api.md) · [from proj4](docs/proj4.md) · [changelog](packages/fast-proj/CHANGELOG.md) |

## Performance

Batch speedups for 10,000 points (median of 31 samples, mean of three runs; higher is faster). UTM zone 33N against a
reused **proj4 2.22** converter:

| Operation                | Backend     |   Node 24 |  Bun 1.4 | Chromium 156 |
| ------------------------ | ----------- | --------: | -------: | -----------: |
| WGS84 → UTM              | JavaScript  |  **5.2×** | **3.8×** |     **6.6×** |
|                          | WebAssembly | **11.0×** | **5.5×** |    **12.3×** |
| UTM → WGS84              | JavaScript  |  **5.3×** | **3.9×** |     **5.8×** |
|                          | WebAssembly |  **9.6×** | **5.3×** |    **10.7×** |
| UTM → GeoJSON LineString | JavaScript  |  **5.5×** | **3.7×** |     **5.4×** |
|                          | WebAssembly |  **8.3×** | **4.9×** |     **9.6×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **19.2×** | **22.6×** |    **14.4×** |
|                | WebAssembly | **29.6×** | **24.6×** |    **21.6×** |
| GCJ-02 → WGS84 | JavaScript  | **11.6×** | **12.6×** |    **10.3×** |
|                | WebAssembly | **20.3×** | **16.9×** |    **16.5×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **13.6×** | **10.9×** |     **8.9×** |
|              | WebAssembly | **22.9×** | **16.0×** |    **17.7×** |
| GCJ-02 → UTM | JavaScript  | **10.0×** |  **9.9×** |     **8.5×** |
|              | WebAssembly | **17.9×** | **13.4×** |    **16.0×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |   Node 24 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | --------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  |  **7.3×** | **2.9×** |    **11.1×** |
|                      | WebAssembly | **13.8×** | **3.0×** |    **11.1×** |
| Web Mercator → WGS84 | JavaScript  |  **9.8×** | **2.4×** |     **6.7×** |
|                      | WebAssembly | **16.9×** | **3.3×** |    **13.4×** |

Timings vary with hardware, runtime and dataset. See the [full benchmark and reproduction commands](packages/fast-proj/README.md#benchmark).

## Development

Uses [Bun](https://bun.sh) workspaces (package manager), vitest, oxlint, oxfmt, TypeScript 7 and Rust 1.99 (for the
wasm build; `rustup target add wasm32-unknown-unknown`). A devcontainer is included.

```sh
bun install
bun run check    # format, lint, typecheck, build (TS + wasm), test
cd packages/fast-proj && bun run bench    # Node, Bun and Chromium
bun changeset    # describe a user-facing change for the CHANGELOG
```

Releases: see [`.changeset/README.md`](.changeset/README.md).

## License

MIT
