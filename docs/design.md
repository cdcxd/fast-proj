# fast-proj 0.1 design

Status: accepted, implemented in 0.1 (except `webMercator` and `gcj02`, whose names and shapes are fixed here for later; `gcj02` is added in 0.2). See [Implementation notes](#implementation-notes) for where 0.1 refines this proposal.

Updated for 0.3, the one breaking release before 1.0: `Geographic` systems and the `geographic` projection option,
spelled-out transverse Mercator parameters, and context-only disposal; see the
[migration table](api.md#migrating-from-02).

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

There is no CRS object. A `Geographic` system (GCJ-02, later BD-09) is defined by its conversion to WGS84, and a
projection can carry one as `geographic`: its `toLonLat`/`fromLonLat` then use that system's longitude/latitude, while
x/y stay on the grid of WGS84 longitude/latitude (x/y ↔ WGS84 ↔ `geographic`). The option is named for the
longitude/latitude side on purpose: a geodetic datum (a Helmert shift such as OSGB36) sits on the grid side instead
(x/y ↔ datum lon/lat ↔ WGS84), so the name `datum` stays free for that.

## Ellipsoids

Plain frozen `{ a, f }` constants, exported from the root:

```ts
export interface Ellipsoid { readonly a: number; readonly f: number }
export const WGS84: Ellipsoid;
export const GRS80: Ellipsoid; // CGCS2000 uses the same ellipsoid in practice
```

Projections take `ellipsoid?: Ellipsoid`, default `WGS84`, validated as `a > 0`, `0 <= f < 0.01`.
Ellipsoids used only internally (Krasovsky for GCJ-02) stay private. Series coefficients stay internal.

## Two kinds of converter

Projections and geographic systems are different things and get different method names, so one can't be passed where
the other is expected. Nothing in the projection types is UTM-specific: `webMercator` and other projections return
`Projection` and take the same `geographic` option.

```ts
// projected x/y (metres) <-> lon/lat on `geographic`, WGS84 when unset
interface Projection {
  readonly geographic?: Geographic;
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

// this system's lon/lat <-> hub lon/lat
interface Geographic {
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
  readonly centralMeridian: number;
  readonly scaleFactor: number;
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
- Invalid option values throw `RangeError`; wrong types and unknown option keys throw `TypeError`. Messages start with
  `fast-proj:`.
- Converters are frozen plain objects whose methods don't use `this`.
- Points outside a converter's valid domain give `NaN`, never a huge finite number.

## Converters

All are factories, including the ones with no options today, so that options can be added later without a break.

```ts
export function tmerc(opts: {
  centralMeridian: number;
  scaleFactor?: number;
  falseEasting?: number;
  falseNorthing?: number;
  latitudeOfOrigin?: number; // only 0 for now
  ellipsoid?: Ellipsoid;
  geographic?: Geographic;
}): TransverseMercator;
export function utm(opts: { zone: number; south?: boolean; ellipsoid?: Ellipsoid; geographic?: Geographic }): Utm;
export function utmZoneFor(lon: number, lat: number): number;
export function utmFor(lon: number, lat: number): { zone: number; south: boolean };

export function webMercator(opts?: { geographic?: Geographic }): Projection; // EPSG:3857, sphere of radius WGS84.a
export function gcj02(opts?: { outsideChina?: 'passthrough' | 'transform' }): Geographic;
export const GCJ02: Geographic; // gcj02(), the same object
```

`webMercator` and `gcj02` come after 0.1; their names and shapes are fixed here so 0.1 doesn't need to change for them.
BD-09, if added, is another `Geographic` relative to WGS84 (composing GCJ-02 internally).

GCJ-02's reverse direction has no closed form; `toWgs84` iterates and documents its accuracy.

## Chaining

Two calls on the same buffer. For a projection and a geographic system, the `geographic` option does the same two
passes:

```ts
import { GCJ02, utm } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

utm({ zone: 50, geographic: GCJ02 }).toLonLatInterleaved(buf, buf); // UTM -> GCJ-02, in place
map.getSource('track').setData(lineString(buf));
```

A fused UTM <-> GCJ-02 loop can reuse the tmerc step's sines and cosines in the GCJ-02 step (four fewer trigonometric
calls per point); a prototype measured 9-25% faster UTM -> GCJ-02 and 0-11% faster GCJ-02 -> UTM (10k points). Not
provided yet (#13); it would sit behind the `geographic` option. A `pipe()` helper can be added later without a break.

Rules that keep later additions non-breaking:

- `Geographic` and `Projection` only gain optional members: third parties implement them, and `geographic` is checked
  by its six methods. Fused kernels detect the built-in GCJ-02 objects by identity, not by a marker property.
- Uppercase constants name one kind each: `WGS84` and `GRS80` are ellipsoids, `GCJ02` (later `BD09`) are geographic
  systems. A geodetic datum gets its own names (e.g. `datum: OSGB36`), never a bare ellipsoid name.
- `utmFor` returns exactly `{ zone, south }`, so `utm(utmFor(lon, lat))` keeps working under strict option checks.

## GeoJSON

Formatting only. Input is a lon/lat buffer, the output of any converter or chain; no converter argument.

```ts
// each also takes (lon, lat) arrays
export function positions(lonlat: ArrayLike<number>): [lon: number, lat: number][];
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
wasm.backend; // 'wasm' | 'js'
const u = wasm.utm({ zone: 50 }); // same signature and return type
u.toLonLatInterleaved(buf, buf);
wasm.dispose(); // or `using wasm = await loadWasm()`
```

- `loadWasm` returns a context with the same factories as the root (`tmerc`, `utm`, `webMercator`, `gcj02`), returning
  the same interfaces; JavaScript-backed where there is no kernel. Only the context is `Disposable`: converters hold
  nothing of their own and throw once their context is disposed.
- The compiled `WebAssembly.Module` is cached per source; each context gets its own instance and bounded workspace (see
  `experiments/utm-wasm/RESOURCE-LIFECYCLE.md`).
- `source` is accepted from the start: esbuild doesn't rewrite `new URL(..., import.meta.url)`, and Node can't `fetch` a
  `file:` URL, so Node reads the file and other environments may need to pass bytes.
- Calls after `dispose()` throw. Output arrays are caller-owned and stay valid.
- Converters take and return caller-owned arrays, so each call copies into the wasm workspace and back. That copy costs
  about 0.17 ns/point. Zero-copy access to wasm memory is a possible later addition; it is not promised.
- Accuracy contract: wasm results match the JS backend within 4e-9 m and 6e-14° (longitude differences scaled by
  cos(latitude)), not bit for bit; one ulp of the output (7.5e-9 m) above 2^25 m.
  Composed with GCJ-02 the bound has exceptions where a one-ulp difference in the projection's WGS84 result is
  amplified: the √|x| cusp at longitude 105°, latitudes beyond ±89.9° in `'transform'` mode, and, in `'passthrough'`
  mode, the China box edge (a point on one side per backend). All are inherent to two-pass composition across
  backends; see the API docs.

## Release

- Package `fast-proj`, version 0.1.0, tags `v*` (the `npm` environment rule changes from `utm-v*` to `v*`).
- `engines.node`: `>=20` for the package. The repo's dev tooling needs `>=22.18` (the `.mts` scripts rely on unflagged type stripping); that stays in the private root only. The release smoke stays `smoke.mjs` so it runs on the package floor.
- The release workflow builds the wasm with the pinned Rust toolchain and ships it in `dist`.
- `@fast-proj/utm` was never published; nothing to deprecate.

## Breaking-change checklist before 0.1.0

1. Single package `fast-proj` with the entries above, nothing more.
2. `Projection` / `Geographic` / `TransverseMercator` / `Utm` types; `utm()` built on `tmerc()`.
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
- One wasm file ships, `fast-proj.wasm` (SIMD). 0.1.0 also shipped a scalar build for engines without SIMD; it measured
  no faster than the JavaScript kernel, so since 0.1.1 those engines get the JavaScript backend (`backend: 'js'`).
- The JavaScript kernels are written once, as per-point functions returning through closure variables; the point methods
  call them. Each batch method runs one loop per direction with a copy of the kernel in it, shared by separate and
  interleaved arrays (element `j` of `a` and `b[j + o1]` every `step`), expanded by `scripts/inline.ts` from `// @inline`
  markers; `build` fails if a copy is stale. The copies are bit-identical to the kernels and measured 23-37% faster for
  `utm` and 28-89% for `gcj02` (Node, Bun, Chromium): engines don't keep a called kernel's closure results in registers.
  A per-point function writing to the output array or a `Float64Array(2)` scratch gained 0-4% on JavaScriptCore.
- The wasm converters' single-point methods run the JavaScript kernel: one point costs more to pass into wasm than to
  compute.
- Re-entrant calls into a context (from array-like getters) throw; `dispose()` during a call throws.
- `gcj02` (0.2) has a wasm kernel since 0.2.1, for `'passthrough'` mode (`gcj_forward_batch` / `gcj_inverse_batch`, SIMD
  build only, so other modules fall back to JavaScript). Its 11 sines come from two sin/cos pairs by multiple-angle
  identities; the inverse takes four fixed-point steps (2e-11°), six near longitude 105°, where the √|x| term slows
  convergence. Two Newton steps measured no faster and need that term's derivative, which is singular there.
  `'transform'` mode iterates until converged instead and gives `NaN` where it doesn't. That per-point step count
  doesn't fit the fixed-step f64x2 kernel, so it stays JavaScript; the kernel masks the extra steps near 105° per lane,
  so each point takes the steps the JavaScript loop would.
