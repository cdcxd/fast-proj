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
| WGS84 → UTM              | JavaScript  |  **8.8×** | **4.3×** |     **9.8×** |
|                          | WebAssembly | **12.8×** | **6.1×** |    **13.5×** |
| UTM → WGS84              | JavaScript  |  **7.4×** | **4.1×** |     **8.5×** |
|                          | WebAssembly | **10.8×** | **6.0×** |    **12.0×** |
| UTM → GeoJSON LineString | JavaScript  |  **7.0×** | **3.9×** |     **8.0×** |
|                          | WebAssembly |  **9.4×** | **5.3×** |    **10.1×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **29.1×** | **22.8×** |    **20.8×** |
|                | WebAssembly | **35.9×** | **30.4×** |    **24.3×** |
| GCJ-02 → WGS84 | JavaScript  | **14.4×** | **12.9×** |    **12.9×** |
|                | WebAssembly | **21.0×** | **17.4×** |    **17.4×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **16.7×** | **11.1×** |    **12.8×** |
|              | WebAssembly | **24.6×** | **17.1×** |    **18.6×** |
| GCJ-02 → UTM | JavaScript  | **13.1×** | **10.2×** |    **12.1×** |
|              | WebAssembly | **18.8×** | **14.2×** |    **16.9×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |   Node 24 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | --------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  | **13.0×** | **3.0×** |    **11.0×** |
|                      | WebAssembly | **14.0×** | **3.0×** |    **11.0×** |
| Web Mercator → WGS84 | JavaScript  | **15.4×** | **2.4×** |    **13.5×** |
|                      | WebAssembly | **17.8×** | **3.6×** |    **14.3×** |

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
