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
| WGS84 → UTM              | JavaScript  | **3.9×** | **3.9×** |     **5.7×** |
|                          | WebAssembly | **6.5×** | **5.7×** |     **8.7×** |
| UTM → WGS84              | JavaScript  | **3.0×** | **3.4×** |     **4.3×** |
|                          | WebAssembly | **4.2×** | **4.9×** |     **6.0×** |
| UTM → GeoJSON LineString | JavaScript  | **3.1×** | **3.2×** |     **4.2×** |
|                          | WebAssembly | **4.0×** | **4.5×** |     **5.5×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **18.4×** | **22.2×** |    **21.2×** |
|                | WebAssembly | **25.0×** | **28.6×** |    **28.3×** |
| GCJ-02 → WGS84 | JavaScript  | **10.8×** | **12.6×** |    **12.9×** |
|                | WebAssembly | **17.2×** | **16.8×** |    **20.0×** |

BD-09 against **gcoord 1.0.7** (GCJ-02 ↔ BD-09 runs in JavaScript in both backends):

| Operation      | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → BD-09  | JavaScript  | **11.8×** | **13.9×** |    **13.2×** |
|                | WebAssembly | **13.6×** | **16.0×** |    **15.7×** |
| BD-09 → WGS84  | JavaScript  |  **7.3×** |  **8.8×** |     **9.0×** |
|                | WebAssembly |  **9.5×** | **10.5×** |    **11.6×** |
| GCJ-02 → BD-09 | JavaScript  | **18.9×** | **21.1×** |    **20.2×** |
| BD-09 → GCJ-02 | JavaScript  |  **8.6×** | **10.6×** |     **8.4×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 26 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  |  **8.7×** | **10.6×** |    **10.0×** |
|              | WebAssembly | **12.6×** | **16.5×** |    **14.3×** |
| GCJ-02 → UTM | JavaScript  |  **7.9×** | **10.0×** |    **10.1×** |
|              | WebAssembly | **12.9×** | **13.6×** |    **15.6×** |

Web Mercator (EPSG:3857) against proj4:

| Operation            | Backend     |  Node 26 |  Bun 1.4 | Chromium 156 |
| -------------------- | ----------- | -------: | -------: | -----------: |
| WGS84 → Web Mercator | JavaScript  | **4.0×** | **3.0×** |     **4.2×** |
|                      | WebAssembly | **4.4×** | **3.0×** |     **4.2×** |
| Web Mercator → WGS84 | JavaScript  | **5.0×** | **2.8×** |     **6.9×** |
|                      | WebAssembly | **5.9×** | **3.8×** |     **6.9×** |

Single-point calls (`toLonLatPoint`, `fromWgs84Point`, ...; the JavaScript kernel in both backends):

| Operation            | Baseline       |   Node 26 |   Bun 1.4 | Chromium 156 |
| -------------------- | -------------- | --------: | --------: | -----------: |
| UTM → WGS84          | proj4          |  **2.6×** |  **2.8×** |     **3.7×** |
| WGS84 → GCJ-02       | gcoord         | **13.8×** | **19.1×** |    **15.4×** |
| GCJ-02 → WGS84       | gcoord         |  **9.7×** | **11.6×** |    **11.6×** |
| WGS84 → BD-09        | gcoord         |  **8.7×** | **10.1×** |     **9.8×** |
| BD-09 → WGS84        | gcoord         |  **6.3×** |  **7.0×** |     **7.7×** |
| GCJ-02 → BD-09       | gcoord         | **12.3×** | **13.4×** |    **12.8×** |
| BD-09 → GCJ-02       | gcoord         |  **6.9×** |  **7.6×** |     **6.5×** |
| UTM → GCJ-02         | proj4 + gcoord |  **7.6×** |  **8.8×** |     **8.9×** |
| GCJ-02 → UTM         | proj4 + gcoord |  **6.5×** |  **8.5×** |     **8.4×** |
| WGS84 → Web Mercator | proj4          |  **2.2×** |  **2.4×** |     **2.5×** |
| Web Mercator → WGS84 | proj4          |  **3.6×** |  **1.9×** |     **4.0×** |

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
