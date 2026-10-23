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
| WGS84 → UTM              | JavaScript  |  **8.6×** | **4.2×** |    **10.1×** |
|                          | WebAssembly | **12.8×** | **6.0×** |    **14.7×** |
| UTM → WGS84              | JavaScript  |  **7.3×** | **4.1×** |     **8.4×** |
|                          | WebAssembly | **11.2×** | **5.9×** |    **11.9×** |
| UTM → GeoJSON LineString | JavaScript  |  **6.9×** | **3.8×** |     **7.3×** |
|                          | WebAssembly |  **9.4×** | **5.2×** |    **10.1×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **29.3×** | **22.6×** |    **21.0×** |
|                | WebAssembly | **32.2×** | **27.1×** |    **22.4×** |
| GCJ-02 → WGS84 | JavaScript  | **14.5×** | **12.8×** |    **13.2×** |
|                | WebAssembly | **21.1×** | **17.1×** |    **17.8×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **16.6×** | **11.1×** |    **12.9×** |
|              | WebAssembly | **24.4×** | **17.3×** |    **18.5×** |
| GCJ-02 → UTM | JavaScript  | **13.2×** | **10.4×** |    **11.8×** |
|              | WebAssembly | **18.6×** | **14.6×** |    **17.1×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |   Node 24 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | --------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  | **12.9×** | **3.0×** |    **11.1×** |
|                      | WebAssembly | **13.9×** | **3.1×** |    **11.1×** |
| Web Mercator → WGS84 | JavaScript  | **15.9×** | **2.5×** |    **13.6×** |
|                      | WebAssembly | **17.4×** | **3.3×** |    **13.6×** |

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
