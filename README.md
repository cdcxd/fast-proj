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

| package                           | contents                                                           | docs                                                                                            |
| --------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`fast-proj`](packages/fast-proj) | UTM and transverse Mercator ↔ WGS84, GCJ-02, GeoJSON helpers, wasm | [API](docs/api.md) · [from proj4](docs/proj4.md) · [changelog](packages/fast-proj/CHANGELOG.md) |

## Performance

Batch speedups for 10,000 points (median of 31 samples, mean of three runs; higher is faster). UTM zone 33N against a
reused **proj4 2.22** converter:

| Operation                | Backend     |  Node 24 |  Bun 1.4 | Chromium 156 |
| ------------------------ | ----------- | -------: | -------: | -----------: |
| WGS84 → UTM              | JavaScript  | **5.7×** | **3.6×** |     **4.6×** |
|                          | WebAssembly | **9.7×** | **4.4×** |    **10.4×** |
| UTM → WGS84              | JavaScript  | **5.3×** | **3.2×** |     **3.9×** |
|                          | WebAssembly | **8.3×** | **4.5×** |     **9.0×** |
| UTM → GeoJSON LineString | JavaScript  | **5.3×** | **3.1×** |     **3.9×** |
|                          | WebAssembly | **7.5×** | **4.2×** |     **8.2×** |

GCJ-02 against **gcoord 1.0.7**:

| Operation      | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| -------------- | ----------- | --------: | --------: | -----------: |
| WGS84 → GCJ-02 | JavaScript  | **20.7×** | **15.9×** |     **7.7×** |
|                | WebAssembly | **28.2×** | **23.0×** |    **19.5×** |
| GCJ-02 → WGS84 | JavaScript  | **12.0×** | **11.8×** |     **7.3×** |
|                | WebAssembly | **19.4×** | **15.9×** |    **16.1×** |

UTM zone 50 with `geographic: GCJ02` against proj4 + gcoord:

| Operation    | Backend     |   Node 24 |   Bun 1.4 | Chromium 156 |
| ------------ | ----------- | --------: | --------: | -----------: |
| UTM → GCJ-02 | JavaScript  | **14.6×** |  **9.9×** |     **7.4×** |
|              | WebAssembly | **17.3×** | **12.1×** |    **13.0×** |
| GCJ-02 → UTM | JavaScript  | **10.7×** |  **9.3×** |     **6.6×** |
|              | WebAssembly | **16.4×** | **11.9×** |    **14.5×** |

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
