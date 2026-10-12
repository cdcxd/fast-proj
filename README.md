# fast-proj

Fast coordinate conversions for JavaScript and TypeScript, one package per projection.
Optimized arithmetic and typed-array batching support reusable output buffers and in-place conversion,
with no per-point allocations in the batch APIs.

| package                          | description | docs               |
| -------------------------------- | ----------- | ------------------ |
| [`@fast-proj/utm`](packages/utm) | UTM ↔ WGS84 | [API](docs/utm.md) |

## Performance

Recorded TypeScript batch speedups over a reused **proj4 2.22** converter, for 10,000 points in UTM zone 33N
(median of 31 samples; higher is faster):

| Operation                |  Node 24 |  Bun 1.4 | Chromium 156 |
| ------------------------ | -------: | -------: | -----------: |
| WGS84 → UTM              | **5.1×** | **3.4×** |     **3.7×** |
| UTM → WGS84              | **4.9×** | **2.7×** |     **3.2×** |
| UTM → GeoJSON LineString | **5.0×** | **2.9×** |     **3.6×** |

Timings vary with hardware, runtime and dataset. See the [full benchmark and reproduction commands](packages/utm/README.md#benchmark).
These measurements use the TypeScript kernel; the [experimental Rust/Wasm SIMD kernel](experiments/utm-wasm/ARITHMETIC.md)
is being evaluated for large batches.

## Development

Uses [Bun](https://bun.sh) workspaces (package manager), vitest, oxlint, oxfmt and TypeScript 7. A devcontainer is
included.

```sh
bun install
bun run check    # format, lint, typecheck, build, test
cd packages/utm && bun run bench    # Node, Bun and Chromium
```

## License

MIT
