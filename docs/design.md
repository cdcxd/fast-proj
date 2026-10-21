# fast-proj 0.1 design

Status: accepted, implemented in 0.1 (except `webMercator` and `gcj02`, whose names and shapes are fixed here for later; `gcj02` is added in 0.2, `webMercator` in 0.4). See [Implementation notes](#implementation-notes) for where 0.1 refines this proposal.

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
  toLonLat<A extends Float64Array = Float64Array<ArrayBuffer>, B extends Float64Array = Float64Array<ArrayBuffer>>(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    lon?: A,
    lat?: B,
  ): { lon: NoInfer<A>; lat: NoInfer<B> };
  fromLonLat<A extends Float64Array = Float64Array<ArrayBuffer>, B extends Float64Array = Float64Array<ArrayBuffer>>(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    x?: A,
    y?: B,
  ): { x: NoInfer<A>; y: NoInfer<B> };
  toLonLatInterleaved<T extends Float64Array = Float64Array<ArrayBuffer>>(xy: ArrayLike<number>, out?: T): NoInfer<T>;
  fromLonLatInterleaved<T extends Float64Array = Float64Array<ArrayBuffer>>(
    lonlat: ArrayLike<number>,
    out?: T,
  ): NoInfer<T>;
  toLonLatPoint(x: number, y: number): [lon: number, lat: number];
  fromLonLatPoint(lon: number, lat: number): [x: number, y: number];
}

// this system's lon/lat <-> hub lon/lat
interface Geographic {
  toWgs84<A extends Float64Array = Float64Array<ArrayBuffer>, B extends Float64Array = Float64Array<ArrayBuffer>>(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    outLon?: A,
    outLat?: B,
  ): { lon: NoInfer<A>; lat: NoInfer<B> };
  fromWgs84<A extends Float64Array = Float64Array<ArrayBuffer>, B extends Float64Array = Float64Array<ArrayBuffer>>(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    outLon?: A,
    outLat?: B,
  ): { lon: NoInfer<A>; lat: NoInfer<B> };
  toWgs84Interleaved<T extends Float64Array = Float64Array<ArrayBuffer>>(
    lonlat: ArrayLike<number>,
    out?: T,
  ): NoInfer<T>;
  fromWgs84Interleaved<T extends Float64Array = Float64Array<ArrayBuffer>>(
    lonlat: ArrayLike<number>,
    out?: T,
  ): NoInfer<T>;
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

Since 0.3.2 the JavaScript backend fuses x/y -> GCJ-02 into one loop when a JavaScript `tmerc`/`utm` has a built-in
JavaScript GCJ-02 as its `geographic`. The GCJ-02 offset's sin/cos pairs come from the inverse's conformal latitude and
longitude by angle addition, which saves four of the six trigonometric calls. That is 9-11% faster in Node and Bun and
36-37% in Chromium for 10k points (28%, 14% and 48% for the point method), and within 3e-14° of the two passes,
longitude scaled by cos(latitude) (except in `'transform'` mode poleward of about 87°, where one ulp of WGS84 latitude
moves the two-pass longitude by up to degrees). `geographic.ts` holds two WeakMaps: tmerc registers its inverse
constants under its `toLonLat`, and gcj02 registers a builder for its shared objects. So a `utm`-only bundle has no
GCJ-02 code (0.2 KB gzip more). Both maps are keyed by identity, so a spread copy of a GCJ-02 object, a wasm projection
or the wasm GCJ-02 kernel (passthrough mode) runs the two passes here; a wasm context fuses its own pair in wasm
(below). The builder (`gcj02-fused.ts`) and its copy of the tmerc inverse come with GCJ-02: `utm` + `GCJ02` grows by
2.4 KB gzip, and a `GCJ02`-only bundle by 2.2 KB. Its constants are shared from `gcj02-constants.ts` and bound to each
module's own consts: V8 reads an imported const slower, 12% on `fromWgs84` in unbundled Node. GCJ-02 -> x/y stays two passes: fused, it could share only the latitude's sin/cos after
the Newton steps, and measured 1% faster in Node, 5% slower in Bun and 13% faster in Chromium. A `pipe()` helper can be
added later without a break.

The wasm backend fuses the same pair when a context's `tmerc`/`utm` has that context's `gcj02()` (passthrough mode) as
its `geographic`: one export, `tm_gcj_batch` (`vfused.rs`), runs the f64x2 inverse and the offset, its sin/cos pairs
by angle addition as above (sin/cos of 3 lam from (cx + i she)^3), replacing both `vsincos` calls of the GCJ-02
kernel. Its copy of the offset series sums the latest-ready terms last, so it is not the shared `vgcj::offset`: 3-5%
faster in Node, 1% in Bun. The one call also saves a copy in and out of the workspace. With 10k UTM points, 22-28%
faster than the wasm two passes in Node, Bun and Chromium (32-37% faster than 0.3.1's), within 3e-14° of them. The
context detects its own GCJ-02 converter by identity; another context's, a JavaScript projection with a wasm GCJ-02
(or the reverse), and modules without the export run the two passes. Single points run the JavaScript fused kernel.
GCJ-02 -> x/y stays two wasm calls: a spike of one export (`vgcj`'s inverse, then the f64x2 tmerc forward, per pair;
bit-identical to the two calls) measured -6% to +2% against them for 10k points in Node, Bun and Chromium, and added
3.9 kB. The two kernels are nearly all of the time (the GCJ-02 Newton steps 0.72 ms, the forward 0.46 ms), the saved
copy and crossing 0.01-0.03 ms. The only shareable trigonometry is what the JavaScript spike above measured: the
offset's longitude angle is 3 (lon - 105)°, not the forward's, and its latitude sin/cos is of the iterate before the
last Newton step. Rotating that pair by the last correction into the forward's latitude measured 3-7% faster.

The wasm inverse is latency-bound: its chain of sincos/exp, then atan of the conformal latitude, then the phi - chi
series leaves the SIMD units idle. So the inverse takes shallower forms of those (`vsincos_eo`, `vexp_eo`, `poly6_eo`:
each polynomial as two interleaved Horner chains in t^2, within an ulp of one chain; `vatan_q`: atan(n / d) with one
division instead of three; a pair with an out-of-domain lane takes the atan2 blend, which keeps `vatan_q` for the
in-domain lane, so no lane's result depends on its neighbour), 57.8 -> 50 ns per point, 14-16% faster through the API.
The forward kernel takes the same forms, plus `vlog1p_eo` (its 9-term log polynomial is the deepest chain), 17-24%
faster through the API; the GCJ-02 kernels keep the single chains. Tried and not kept: a full Estrin atan (more live
values spill in V8), hoisting the splatted constants (Node 3% faster, Bun 7-10% slower), unrolling to two pairs per
iteration (Bun twice as slow), and one shared division for 1/r, 1/h and 1/cos(lat) (it serializes the longitude chain
behind the latitude's).

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
  identities; the inverse takes two Newton steps (3e-12°), up to six within 1e-4° of longitude 105°. The Jacobian comes
  from the offset's multiple-angle values; the √|x| term's derivative is singular at 105°, so it is dropped within 1e-10°
  of it, and on the first step, which starts at the input and may be across 105° from the solution, within 1e-4°. Since
  0.3.1 this replaces four fixed-point steps (six near 105°, 2e-11°): 25–46% faster in both backends and 3–20× more
  accurate (fixture 8.7e-12° -> 2.5e-12°, round trip 7e-12° -> 4e-13°).
  `'transform'` mode iterates until converged instead and gives `NaN` where it doesn't. That per-point step count
  doesn't fit the fixed-step f64x2 kernel, so it stays JavaScript; the kernel masks the extra steps near 105° per lane,
  so each point takes the steps the JavaScript loop would.
- `webMercator` (0.4) returns a new frozen `Projection` per call, like `tmerc`; there is no `WebMercator` subtype yet, so
  one with readonly properties can be added later. It doesn't clamp at ±85.05° (a rendering decision that would break
  round trips) and gives `NaN` at the poles, where `tan(pi/2)` rounds to a finite but meaningless 1.6e16. Poleward of
  45° both kernels start from the colatitude, which is exact there: φ in radians loses digits near π/2 (about 100 m of
  y at 89.9999999999°), so y stays within three ulps (five in wasm) up to the poles. The wasm kernel
  (`wm_forward_batch` / `wm_inverse_batch`) writes asinh(tan φ) as 2 atanh(t), t = tan(φ/2): the log series in t up to
  19.4°, else log1p(2t / (1 - t)) with the rounding of its 1 + u compensated (a plain `vlog1p` reached six ulps). It
  takes sinh(y/R) as a Taylor series below 1/4 and from exp above; y agrees with JavaScript within 7.5e-9 m below 2^25 m, the inherent rounding of y/R
  scaled by R. It measured 1.3–2.1× the JavaScript kernel's batch methods (Node, Bun, Chromium). Its composition with GCJ-02 runs the
  two passes; a fused kernel waits for a measured gain.
