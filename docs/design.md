# fast-proj 0.1 design

Status: accepted, implemented in 0.1 (except `webMercator` and `gcj02`, whose names and shapes are fixed here for later). See [Implementation notes](#implementation-notes) for where 0.1 refines this proposal.

The goal is to fix every decision that would be a breaking change after 0.1. Everything else can come in 0.1.x.

## Scope

Fast batch conversions between a few common coordinate systems, for JS and TS, with an optional wasm backend. Not a
general CRS engine: no definition strings, no datum-shift grids, no EPSG database. For those, use proj4.

## Package

One unscoped npm package, `fast-proj`, ESM-only with `sideEffects: false`. Tree-shaking removes unused converters, so
there is no package per projection and no separate core package.

| entry                    | contents                                                    |
| ------------------------ | ----------------------------------------------------------- |
| `fast-proj`              | all JS converters, types, ellipsoid constants, zone helpers |
| `fast-proj/geojson`      | formatting of lon/lat buffers as GeoJSON / Leaflet input    |
| `fast-proj/wasm`         | `loadWasm()`                                                |
| `fast-proj/package.json` | metadata                                                    |

A subpath is permanent once published: adding one later is free, removing one is breaking. So subpaths exist only for
code with a different cost or environment (wasm needs an asset and async init; geojson allocates per point). There is no
`fast-proj/utm` or `fast-proj/gcj02`.

The root never re-exports anything from `fast-proj/wasm`.

The `@fast-proj` npm org stays reserved for possible future separate packages (CLI, plugins).

## The hub: WGS84 lon/lat

Every converter is defined relative to one hub: WGS84 geodetic longitude/latitude in degrees, longitude in
[-180, 180]. No module owns it; it is stated here and in the type docs. Conversions between two non-hub systems are two
calls on the same buffer (see Chaining).

There is no datum or CRS object.

## Ellipsoids

Plain frozen `{ a, f }` constants, exported from the root:

```ts
export interface Ellipsoid { readonly a: number; readonly f: number }
export const WGS84: Ellipsoid;
export const GRS80: Ellipsoid; // CGCS2000 uses the same ellipsoid in practice
```

Projections take `ellipsoid?: Ellipsoid`, default `WGS84`, validated as `a > 0`, `0 <= f < MAX_FLATTENING` (0.01).
Ellipsoids used only internally (Krasovsky for GCJ-02) stay private. Series coefficients stay internal.

## Two kinds of converter

Projections and datum transforms are different things and get different method names, so one can't be passed where the
other is expected.

```ts
// projected x/y (metres) <-> hub lon/lat
interface Projection {
  toLonLat(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    lon?: Float64Array,
    lat?: Float64Array,
  ): { lon: Float64Array; lat: Float64Array };
  fromLonLat(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    x?: Float64Array,
    y?: Float64Array,
  ): { x: Float64Array; y: Float64Array };
  toLonLatInterleaved(xy: ArrayLike<number>, out?: Float64Array): Float64Array;
  fromLonLatInterleaved(lonlat: ArrayLike<number>, out?: Float64Array): Float64Array;
  toLonLatPoint(x: number, y: number): [lon: number, lat: number];
  fromLonLatPoint(lon: number, lat: number): [x: number, y: number];
}

// other lon/lat <-> hub lon/lat
interface GeographicTransform {
  toWgs84(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    outLon?: Float64Array,
    outLat?: Float64Array,
  ): { lon: Float64Array; lat: Float64Array };
  fromWgs84(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    outLon?: Float64Array,
    outLat?: Float64Array,
  ): { lon: Float64Array; lat: Float64Array };
  toWgs84Interleaved(lonlat: ArrayLike<number>, out?: Float64Array): Float64Array;
  fromWgs84Interleaved(lonlat: ArrayLike<number>, out?: Float64Array): Float64Array;
  toWgs84Point(lon: number, lat: number): [lon: number, lat: number];
  fromWgs84Point(lon: number, lat: number): [lon: number, lat: number];
}

interface TransverseMercator extends Projection {
  readonly lon0: number;
  readonly k0: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
  readonly ellipsoid: Ellipsoid;
}
interface Utm extends TransverseMercator {
  readonly zone: number;
  readonly south: boolean;
}
```

The output shapes `{ lon, lat }` and `{ x, y }` are frozen.

Buffer rules, shared by every converter:

- Output buffers are optional; when given they must be at least as long as the input, otherwise `RangeError`.
- An output buffer may be the input itself (in place) or must not overlap it.
- Interleaved input must have even length, otherwise `RangeError`.
- Invalid options throw `RangeError`, except wrong types (`TypeError`).
- Points outside a converter's valid domain give `NaN`, never a huge finite number.

## Converters

All are factories, including the ones with no options today, so that options can be added later without a break.

```ts
export function tmerc(opts: {
  lon0: number;
  k0?: number;
  falseEasting?: number;
  falseNorthing?: number;
  ellipsoid?: Ellipsoid;
}): TransverseMercator;
export function utm(opts: { zone: number; south?: boolean; ellipsoid?: Ellipsoid }): Utm; // tmerc preset
export function zoneFor(lon: number, lat: number): number;
export function utmFor(lon: number, lat: number): { zone: number; south: boolean };

export function webMercator(): Projection; // EPSG:3857, sphere of radius WGS84.a
export function gcj02(opts?: { outsideChina?: 'passthrough' | 'transform' }): GeographicTransform;
```

`webMercator` and `gcj02` come after 0.1; their names and shapes are fixed here so 0.1 doesn't need to change for them.
BD-09, if added, is another `GeographicTransform` relative to WGS84 (composing GCJ-02 internally).

GCJ-02's reverse direction has no closed form; `toWgs84` iterates and documents its accuracy.

## Chaining

Two calls on the same buffer, no helper in 0.1:

```ts
import { utm, gcj02 } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

const u = utm({ zone: 50 });
const g = gcj02();
u.toLonLatInterleaved(buf, buf); // UTM -> WGS84, in place
g.fromWgs84Interleaved(buf, buf); // WGS84 -> GCJ-02, in place
map.getSource('track').setData(lineString(buf));
```

A single fused UTM -> GCJ-02 loop measured no faster than two passes (Node and Chromium, 10k points), because the steps
share no expensive intermediate values. A `pipe()` helper can be added later without a break.

## GeoJSON

Formatting only. Input is a lon/lat buffer, the output of any converter or chain; no converter argument.

```ts
export function positions(lonlat: ArrayLike<number>): [lon: number, lat: number][];
export function positionsFromArrays(lon: ArrayLike<number>, lat: ArrayLike<number>): [lon: number, lat: number][];
export function lineString(lonlat: ArrayLike<number>): { type: 'LineString'; coordinates: [number, number][] };
export function latLngs(lonlat: ArrayLike<number>): [lat: number, lng: number][];
```

Before 0.1 these took a `Utm` and converted point by point, which couldn't follow a chain.

## Wasm

One combined Rust module containing all kernels, loaded by URL (`new URL('./fast-proj.wasm', import.meta.url)`, which
modern bundlers resolve). No base64 inlining.

```ts
import { loadWasm } from 'fast-proj/wasm';

const wasm = await loadWasm(); // or loadWasm({ source: url | bytes | WebAssembly.Module })
wasm.backend; // 'wasm-simd' | 'wasm' | 'js'
const u = wasm.utm({ zone: 50 }); // same signature, returns Utm & Disposable
u.toLonLatInterleaved(buf, buf);
wasm.dispose(); // or `using wasm = await loadWasm()`
```

- `loadWasm` returns a context with the same factories as the root (`tmerc`, `utm`, `webMercator`, `gcj02`), returning
  the same interfaces plus `Disposable`.
- The compiled `WebAssembly.Module` is cached per source; each context gets its own instance and bounded workspace (see
  `experiments/utm-wasm/RESOURCE-LIFECYCLE.md`).
- `source` is accepted from the start: esbuild doesn't rewrite `new URL(..., import.meta.url)`, and Node can't `fetch` a
  `file:` URL, so Node reads the file and other environments may need to pass bytes.
- Calls after `dispose()` throw. Output arrays are caller-owned and stay valid.
- Converters take and return caller-owned arrays, so each call copies into the wasm workspace and back. That copy costs
  about 0.17 ns/point. Zero-copy access to wasm memory is a possible later addition; it is not promised.
- Accuracy contract: wasm results match the JS backend within 4e-9 m and 6e-14° (longitude differences scaled by
  cos(latitude)), not bit for bit; one ulp of the output (7.5e-9 m) above 2^25 m.

## Release

- Package `fast-proj`, version 0.1.0, tags `v*` (the `npm` environment rule changes from `utm-v*` to `v*`).
- `engines.node`: `>=20` for the package. The repo's dev tooling needs `>=22.12`; that stays in the private root only.
- The release workflow builds the wasm with the pinned Rust toolchain and ships it in `dist`.
- `@fast-proj/utm` was never published; nothing to deprecate.

## Breaking-change checklist before 0.1.0

1. Single package `fast-proj` with the entries above, nothing more.
2. `Projection` / `GeographicTransform` / `TransverseMercator` / `Utm` types; `utm()` built on `tmerc()`.
3. GeoJSON helpers take lon/lat buffers.
4. Every converter is a factory.
5. `loadWasm` with `source`, context, `dispose`; no wasm in the root.
6. Docs state the hub, buffer rules, domains and the wasm accuracy contract.

## Implementation notes

- The package lives in `packages/fast-proj`; the Rust crate in `packages/fast-proj/wasm`. The wasm experiment's
  results stay in `experiments/utm-wasm`.
- The wasm kernel was generalized to transverse Mercator (`tm_forward_batch` / `tm_inverse_batch`), so
  `loadWasm().tmerc` is supported. The heap is a bounded 4 MiB static arena; each context allocates one 64 Ki-point
  workspace once.
- Two wasm files ship: `fast-proj.wasm` (SIMD) and `fast-proj-scalar.wasm`, chosen by feature detection. The
  reported backend comes from the loaded module.
- The wasm converters' single-point methods run the JavaScript kernel: one point costs more to pass into wasm than to
  compute.
- Re-entrant calls into a context (from array-like getters) throw; `dispose()` during a call throws.
