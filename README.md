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

| package                           | contents                                                                                | docs                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`fast-proj`](packages/fast-proj) | UTM, transverse Mercator and Web Mercator ↔ WGS84, GCJ-02, BD-09, GeoJSON helpers, wasm | [API](docs/api.md) · [from proj4](docs/proj4.md) · [changelog](packages/fast-proj/CHANGELOG.md) |

## Performance

Batch speedups for 10,000 points (median of 31 samples, mean of three runs; higher is faster). UTM zone 33N against a
reused **proj4 2.23** converter:

| Operation                | Backend     |  Node 24 |  Bun 1.4 | Chromium 156 |
| ------------------------ | ----------- | -------: | -------: | -----------: |
| WGS84 → UTM              | JavaScript  | **4.3×** | **4.0×** |     **5.7×** |
|                          | WebAssembly | **6.9×** | **5.8×** |     **8.7×** |
| UTM → WGS84              | JavaScript  | **2.8×** | **3.4×** |     **4.3×** |
|                          | WebAssembly | **4.1×** | **4.9×** |     **6.0×** |
| UTM → GeoJSON LineString | JavaScript  | **2.8×** | **3.2×** |     **4.1×** |
|                          | WebAssembly | **3.5×** | **4.4×** |     **5.4×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **29.6×** | **22.6×** |    **20.3×** |
|                | WebAssembly | **39.0×** | **29.1×** |    **28.2×** |
| GCJ-02 → WGS84 | JavaScript  | **14.8×** | **12.7×** |    **13.0×** |
|                | WebAssembly | **24.5×** | **17.1×** |    **20.0×** |

BD-09 against **gcoord 1.0.7** (GCJ-02 ↔ BD-09 runs in JavaScript in both backends):

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → BD-09  | JavaScript  | **19.6×** | **14.1×** |    **14.1×** |
|                | WebAssembly | **22.8×** | **16.2×** |    **16.5×** |
| BD-09 → WGS84  | JavaScript  | **10.2×** |  **8.8×** |     **9.2×** |
|                | WebAssembly | **13.2×** | **10.5×** |    **11.9×** |
| GCJ-02 → BD-09 | JavaScript  | **37.4×** | **21.9×** |    **22.3×** |
| BD-09 → GCJ-02 | JavaScript  | **15.5×** | **10.7×** |     **8.8×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **12.2×** | **10.8×** |     **9.6×** |
|              | WebAssembly | **17.9×** | **16.8×** |    **13.7×** |
| GCJ-02 → UTM | JavaScript  | **10.5×** | **10.0×** |    **10.0×** |
|              | WebAssembly | **17.0×** | **13.7×** |    **15.9×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |  Node 24 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | -------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  | **4.5×** | **3.1×** |     **4.0×** |
|                      | WebAssembly | **4.8×** | **3.1×** |     **4.0×** |
| Web Mercator → WGS84 | JavaScript  | **5.9×** | **2.6×** |     **6.4×** |
|                      | WebAssembly | **6.8×** | **3.6×** |     **6.4×** |

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
