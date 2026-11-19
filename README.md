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

| Operation                | Backend     |  Node 26 |  Bun 1.4 | Chromium 156 |
| ------------------------ | ----------- | -------: | -------: | -----------: |
| WGS84 → UTM              | JavaScript  | **3.9×** | **4.0×** |     **5.7×** |
|                          | WebAssembly | **6.5×** | **5.8×** |     **8.7×** |
| UTM → WGS84              | JavaScript  | **2.9×** | **3.4×** |     **4.3×** |
|                          | WebAssembly | **4.0×** | **4.9×** |     **6.0×** |
| UTM → GeoJSON LineString | JavaScript  | **3.0×** | **3.2×** |     **4.1×** |
|                          | WebAssembly | **3.9×** | **4.4×** |     **5.4×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **18.3×** | **22.6×** |    **20.3×** |
|                | WebAssembly | **25.2×** | **29.1×** |    **28.2×** |
| GCJ-02 → WGS84 | JavaScript  | **10.8×** | **12.7×** |    **13.0×** |
|                | WebAssembly | **17.3×** | **17.1×** |    **20.0×** |

BD-09 against **gcoord 1.0.7** (GCJ-02 ↔ BD-09 runs in JavaScript in both backends):

| Operation      | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → BD-09  | JavaScript  | **12.1×** | **14.1×** |    **14.1×** |
|                | WebAssembly | **13.9×** | **16.2×** |    **16.5×** |
| BD-09 → WGS84  | JavaScript  |  **7.4×** |  **8.8×** |     **9.2×** |
|                | WebAssembly |  **9.6×** | **10.5×** |    **11.9×** |
| GCJ-02 → BD-09 | JavaScript  | **18.9×** | **21.9×** |    **22.3×** |
| BD-09 → GCJ-02 | JavaScript  |  **8.5×** | **10.7×** |     **8.8×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  |  **8.9×** | **10.8×** |     **9.6×** |
|              | WebAssembly | **12.9×** | **16.8×** |    **13.7×** |
| GCJ-02 → UTM | JavaScript  |  **7.6×** | **10.0×** |    **10.0×** |
|              | WebAssembly | **12.5×** | **13.7×** |    **15.9×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |  Node 26 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | -------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  | **4.0×** | **3.1×** |     **4.0×** |
|                      | WebAssembly | **4.3×** | **3.1×** |     **4.0×** |
| Web Mercator → WGS84 | JavaScript  | **5.5×** | **2.6×** |     **6.4×** |
|                      | WebAssembly | **6.6×** | **3.6×** |     **6.4×** |

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
