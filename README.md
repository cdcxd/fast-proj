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
| WGS84 → UTM              | JavaScript  |  **6.0×** | **3.7×** |     **6.4×** |
|                          | WebAssembly | **10.9×** | **5.6×** |    **12.3×** |
| UTM → WGS84              | JavaScript  |  **5.5×** | **3.9×** |     **5.6×** |
|                          | WebAssembly |  **9.3×** | **5.3×** |    **10.5×** |
| UTM → GeoJSON LineString | JavaScript  |  **6.2×** | **3.7×** |     **5.4×** |
|                          | WebAssembly |  **8.7×** | **4.7×** |     **9.3×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **19.1×** | **22.3×** |    **20.0×** |
|                | WebAssembly | **29.5×** | **24.4×** |    **21.2×** |
| GCJ-02 → WGS84 | JavaScript  | **11.2×** | **12.4×** |    **11.6×** |
|                | WebAssembly | **19.4×** | **16.4×** |    **16.6×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **13.9×** | **10.8×** |     **8.8×** |
|              | WebAssembly | **23.0×** | **15.8×** |    **17.4×** |
| GCJ-02 → UTM | JavaScript  | **10.7×** |  **9.8×** |     **9.3×** |
|              | WebAssembly | **17.6×** | **13.3×** |    **15.7×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |   Node 24 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | --------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  |  **7.5×** | **3.1×** |    **10.9×** |
|                      | WebAssembly | **13.8×** | **3.1×** |    **10.9×** |
| Web Mercator → WGS84 | JavaScript  |  **9.7×** | **2.4×** |     **6.7×** |
|                      | WebAssembly | **16.8×** | **3.3×** |    **13.5×** |

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
