# fast-proj API

```ts
import { gcj02, tmerc, utm, utmFor, zoneFor, WGS84, GRS80 } from 'fast-proj';
import { positions, positionsFromArrays, lineString, latLngs } from 'fast-proj/geojson';
import { loadWasm } from 'fast-proj/wasm';
```

ESM-only, `sideEffects: false`: unused converters are removed by tree-shaking. Node ≥ 20 and modern browsers. All
angles are in degrees, all distances in metres.

- [The hub: WGS84 longitude/latitude](#the-hub-wgs84-longitudelatitude)
- [`utm(options)`](#utmoptions)
- [`tmerc(options)`](#tmercoptions)
- [`gcj02(options)`](#gcj02options)
- [Converter methods](#converter-methods)
- [Buffers and aliasing](#buffers-and-aliasing)
- [Zones: `utmFor`, `zoneFor`](#zones)
- [Ellipsoids](#ellipsoids)
- [GeoJSON and Leaflet helpers](#geojson-and-leaflet-helpers)
- [WebAssembly backend](#webassembly-backend)
- [Domain and accuracy](#domain-and-accuracy)
- [Chaining](#chaining)
- [Examples](#examples)
- [Migrating from 0.2](#migrating-from-02)
- [Coming from proj4](proj4.md)

## The hub: WGS84 longitude/latitude

Every converter is defined relative to one hub: geodetic longitude/latitude in degrees, longitude in [-180, 180].
Projections (`Projection`: `utm`, `tmerc`) convert projected x/y ↔ hub longitude/latitude with `toLonLat` /
`fromLonLat`. Datums (`Datum`: `gcj02`) convert their own longitude/latitude ↔ WGS84 with `toWgs84` / `fromWgs84`.
Converting between two non-hub systems is two calls on the same buffer; see [Chaining](#chaining).

An ellipsoid is not a datum: a projection on another ellipsoid (e.g. GRS80 for CGCS2000 or ETRS89) treats its
longitude/latitude as WGS84. For those datums the difference from WGS84 is below a metre and usually ignored.

## `utm(options)`

Creates a converter for one UTM zone: `tmerc` with scale factor 0.9996, false easting 500 km and the zone's central
meridian.
Series coefficients are computed once here; keep the converter and reuse it.

```ts
function utm(options: UtmOptions): Utm;

interface UtmOptions {
  zone: number; // 1-60
  south?: boolean; // default false; true adds a false northing of 10 000 km
  ellipsoid?: Ellipsoid; // default WGS84
}

interface Utm extends TransverseMercator {
  readonly zone: number;
  readonly south: boolean;
}
```

Throws `RangeError` if `zone` is not an integer in 1-60 or the ellipsoid is unsupported, and `TypeError` if `south` is
given and is not a boolean.

`south` only selects the false northing; it does not check the input. With `south: false`, points south of the
equator get negative northings; with `south: true`, points north of the equator get northings above 10 000 km.

## `tmerc(options)`

A general transverse Mercator projection, e.g. Gauss-Krüger zones (CGCS2000 3°/6°) and other grids whose latitude
of origin is the equator.

```ts
function tmerc(options: TransverseMercatorOptions): TransverseMercator;

interface TransverseMercatorOptions {
  centralMeridian: number; // degrees, in [-180, 180]
  scaleFactor?: number; // on the central meridian, default 1
  falseEasting?: number; // metres, default 0
  falseNorthing?: number; // metres, default 0
  ellipsoid?: Ellipsoid; // default WGS84
}

interface TransverseMercator extends Projection {
  readonly centralMeridian: number;
  readonly scaleFactor: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
  readonly ellipsoid: Ellipsoid;
}
```

Throws `TypeError` for a non-number option and `RangeError` for a non-finite one, `scaleFactor <= 0`, or an
unsupported ellipsoid. The 0.2 names `lon0` and `k0` throw `TypeError` naming their replacements. A latitude of origin
other than 0 (`+lat_0`, e.g. the British National Grid) is not supported yet; `latitudeOfOrigin` is reserved for it
and throws `TypeError`.

## `gcj02(options)`

GCJ-02, the obfuscated datum required for maps of mainland China (AMap/Gaode, Tencent, Google Maps in China). It
follows the published WGS84 → GCJ-02 formula, as gcoord and coordtransform do; Baidu's BD-09 is not supported yet.
GCJ-02 is an obfuscation of WGS84 rather than a geodetic datum; it is a `Datum` here because map users call it one.

```ts
function gcj02(options?: Gcj02Options): Datum;

interface Gcj02Options {
  outsideChina?: 'passthrough' | 'transform'; // default 'passthrough'
}
```

- **Outside China.** With `'passthrough'`, points outside the box longitude 72.004–137.8347, latitude 0.8293–55.8271
  (the box gcoord uses) are returned unchanged. With `'transform'`, the offset is applied everywhere; see below for
  the poles and the antimeridian. Throws `RangeError` for any other value.
- **Accuracy.** `fromWgs84` is within one ulp (1.6e-14°) of a 40-digit evaluation of the formula. The formula has no
  closed-form inverse; `toWgs84` takes four fixed-point steps, six within 1e-4° of longitude 105° (where the formula
  has a √|x| cusp), and is within 2e-11° (about 2 µm; longitude errors scaled by the cosine of latitude) of the exact
  inverse. gcoord's inverse stops at about 1e-6° (0.1 m), and coordtransform's one-step inverse is off by up to 3e-5°
  (3 m).
- **`'transform'` near the poles and the antimeridian.** `toWgs84` iterates until converged. Up to latitude ±89° it
  round-trips within 1e-11° (longitude errors scaled by the cosine of latitude), except within 1e-4° of longitude
  105°, where rounding the GCJ-02 coordinates alone moves the exact inverse by up to 1e-10° at ±89°. Closer to the poles the formula isn't one-to-one: `toWgs84` gives `NaN` or another point
  with the same GCJ-02 coordinates, and `fromWgs84` gives `NaN` where the offset would push latitude past ±90°. The
  offset differs at longitudes 180° and −180°; both are treated as 180°.
- Input longitudes outside [-180, 180] are reduced first; output longitudes are in [-180, 180].

## Converter methods

Every `Projection` has the methods below. A `Datum` has the same set with lon/lat on both sides:
`toWgs84(lon, lat, outLon?, outLat?)`, `fromWgs84(...)`, `toWgs84Interleaved(lonlat, out?)`, `fromWgs84Interleaved`,
`toWgs84Point(lon, lat)` and `fromWgs84Point`.

| method                                | input                         | output                                         |
| ------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `toLonLat(x, y, lon?, lat?)`          | x and y arrays                | `{ lon, lat }` `Float64Array`s                 |
| `fromLonLat(lon, lat, x?, y?)`        | longitude and latitude arrays | `{ x, y }` `Float64Array`s                     |
| `toLonLatInterleaved(xy, out?)`       | `[x0, y0, x1, y1, ...]`       | `[lon0, lat0, lon1, lat1, ...]` `Float64Array` |
| `fromLonLatInterleaved(lonlat, out?)` | `[lon0, lat0, ...]`           | `[x0, y0, ...]` `Float64Array`                 |
| `toLonLatPoint(x, y)`                 | one point                     | `[lon, lat]`                                   |
| `fromLonLatPoint(lon, lat)`           | one point                     | `[x, y]`                                       |

Inputs may be any array-like of numbers (`number[]`, `Float64Array`, `Float32Array`, ...). Outputs are new
`Float64Array`s unless output buffers are passed, in which case those buffers are filled and returned. The output
shapes `{ lon, lat }` and `{ x, y }` are stable.

Throws `RangeError` when the two input arrays of `toLonLat`/`fromLonLat` differ in length, an interleaved input has an
odd length, or an output buffer is shorter than the input. The point methods never throw; invalid input gives `NaN`.

## Buffers and aliasing

- An output buffer must be at least as long as the input; extra elements are left untouched.
- An output buffer may be **the same array** as an input, for in-place conversion:
  `toLonLatInterleaved(xy, xy)`, `toLonLat(x, y, x, y)`, or swapped, `toLonLat(x, y, y, x)`.
- An output buffer must **not otherwise overlap** an input (for example `xy.subarray(2)` as the output of `xy`);
  results are then undefined.

## Zones

```ts
function utmFor(lon: number, lat: number): { zone: number; south: boolean };
function zoneFor(lon: number, lat: number): number;
```

`zoneFor` returns the standard UTM zone, including the Norway (32V) and Svalbard (31X, 33X, 35X, 37X) exceptions.
Longitude is wrapped, so 190 gives zone 2. `utmFor` adds `south: lat < 0`, and its result can be passed straight to
`utm`. Both throw `RangeError` for non-finite input and for latitudes outside [-80, 84] (the polar regions use UPS,
which is not implemented).

A zone's central meridian is `utm({ zone }).centralMeridian`.

## Ellipsoids

```ts
interface Ellipsoid {
  readonly a: number; // semi-major axis, metres
  readonly f: number; // flattening
}
const WGS84: Ellipsoid; // frozen
const GRS80: Ellipsoid; // frozen; also CGCS2000 and ETRS89 in practice
```

Any ellipsoid with `a > 0` and `0 <= f < 0.01` is supported, which covers every terrestrial ellipsoid
(Earth's is 0.0034). The implementation's small-angle expansions are exact to double precision only in that range. The
accuracy figures under [Domain and accuracy](#domain-and-accuracy) hold for terrestrial flattenings. The series are
truncated at order n^6, so error grows with f: up to f = 0.005 it stays within those figures; near the limit (f =
0.0099999) it is about 1e-8 m within 6° of the central meridian, 2e-7 m at 30°, and 1e-12° inverse.

## GeoJSON and Leaflet helpers

`fast-proj/geojson` formats longitude/latitude buffers (the output of any converter or [chain](#chaining)) as the
nested arrays map libraries take. It does no conversion.

```ts
type Position = [lon: number, lat: number];

function positions(lonlat: ArrayLike<number>): Position[];
function positionsFromArrays(lon: ArrayLike<number>, lat: ArrayLike<number>): Position[];
function lineString(lonlat: ArrayLike<number>): { type: 'LineString'; coordinates: Position[] };
function latLngs(lonlat: ArrayLike<number>): [lat: number, lng: number][];
```

`positions`, `lineString` and `latLngs` take interleaved input and throw `RangeError` for odd lengths.
`positionsFromArrays` throws `RangeError` when `lon` and `lat` differ in length. `latLngs` returns Leaflet's
latitude-first order.

## WebAssembly backend

`fast-proj/wasm` runs the batch methods in one combined Rust module (f64x2 SIMD where supported). It is opt-in: the
root entry never loads it.

```ts
function loadWasm(options?: {
  source?: URL | string | ArrayBuffer | ArrayBufferView | WebAssembly.Module;
}): Promise<WasmContext>;

interface WasmContext extends WasmDisposable {
  readonly backend: 'wasm-simd' | 'js';
  tmerc(options: TransverseMercatorOptions): TransverseMercator & WasmDisposable;
  utm(options: UtmOptions): Utm & WasmDisposable;
  gcj02(options?: Gcj02Options): Datum & WasmDisposable;
  dispose(): void;
}

interface WasmDisposable extends Disposable {
  dispose(): void;
}
```

```ts
const wasm = await loadWasm();
const zone33 = wasm.utm({ zone: 33 }); // same interface as utm()
zone33.toLonLatInterleaved(xy, xy);
wasm.dispose(); // or: using wasm = await loadWasm();
```

- **Loading.** By default the module is `fast-proj.wasm` next to `wasm.js`, resolved with `new URL('./fast-proj.wasm',
  import.meta.url)`. Vite and webpack 5 copy the asset; on Node and Bun it is read from disk. With a bundler that
  doesn't handle the pattern (esbuild), pass `source`: a URL you serve, the bytes, or a compiled `WebAssembly.Module`.
- **Backend.** `wasm-simd` normally. `js` when WebAssembly or wasm SIMD (Safari before 16.4) is unavailable, including
  when a `source` is given that can't compile without SIMD or is a non-SIMD build; the context's converters then run
  the JavaScript backend, which measured as fast as a scalar wasm build.
- **Instances.** The compiled module is cached per source. Each `loadWasm` call returns a new context with its own
  instance and a fixed 64 Ki-point workspace (about 2 MiB); larger inputs are processed in chunks. A failed load can
  be retried.
- **Disposal.** `dispose()` is idempotent on contexts and converters. Calls after disposal throw. Disposing a context
  invalidates its converters. Output arrays already returned are caller-owned and stay valid.
- **Copies.** Converters take and return caller-owned arrays, so each batch call copies the input into the workspace
  and the result back (about 0.17 ns per point). There is no zero-copy access to wasm memory.
- **GCJ-02.** The context's `gcj02()` batch methods run the wasm kernel in `'passthrough'` mode (about 1.9–4×
  the JavaScript kernel); `'transform'` mode runs the JavaScript kernel.
- **Single points.** `toLonLatPoint`/`fromLonLatPoint` and `toWgs84Point`/`fromWgs84Point` run the JavaScript kernel:
  passing one point into wasm costs more than computing it.
- **Re-entrancy.** Calling the same context from inside an array-like getter during a batch call throws.
- **Accuracy contract.** Batch results match the JavaScript backend within 4e-9 m and 6e-14° (longitude differences
  scaled by cos(latitude)), not bit for bit. Coordinates above 2^25 m (about 33,554 km, such as Gauss–Krüger eastings
  with a zone prefix) can differ by one ulp of the output, 7.5e-9 m.

## Domain and accuracy

- **Accuracy** for terrestrial ellipsoids, within 30° of the central meridian, all latitudes including the poles: at
  most 4e-9 m forward (6e-9 m for longitudes near ±180°, where one ulp of the input longitude is already 3e-9 m) and
  1e-13° inverse against a 30-digit reference (`packages/fast-proj/test/fixtures`) in all 60 UTM zones, both
  hemispheres, and about 6e-9 m / 1.3e-13° against proj4. Both backends.
- **Recommended domain:** within ~45° of the central meridian. Accuracy degrades further out, as for any Krüger series
  implementation.
- Points **90° or more** from the central meridian return `NaN` from the forward methods.
- At the poles, the inverse returns the central meridian as longitude.
- Output longitudes are normalised to [-180, 180]; input longitudes may be outside that range.
- `NaN` and `Infinity` inputs give `NaN`.

Reference: C. F. F. Karney, _Transverse Mercator with an accuracy of a few nanometers_, J. Geodesy 85 (2011) 475–485,
[doi:10.1007/s00190-011-0445-3](https://doi.org/10.1007/s00190-011-0445-3). Equation-level references are in
[`src/tmerc.ts`](../packages/fast-proj/src/tmerc.ts).

## Chaining

Converters compose through the hub on the same buffer, with no allocation:

```ts
const zone50 = utm({ zone: 50 });
const gk = tmerc({ centralMeridian: 117, falseEasting: 500000, ellipsoid: GRS80 });
zone50.toLonLatInterleaved(buf, buf); // UTM 50N -> lon/lat
gk.fromLonLatInterleaved(buf, buf); // lon/lat -> CGCS2000 3° zone, CM 117E
```

```ts
const zone50 = utm({ zone: 50 });
const gcj = gcj02();
zone50.toLonLatInterleaved(buf, buf); // UTM 50N -> WGS84
gcj.fromWgs84Interleaved(buf, buf); // WGS84 -> GCJ-02, for an AMap basemap
```

For two projections, a fused single loop measured no faster than two passes: the steps share no expensive
intermediate values.

## Migrating from 0.2

| 0.2                                 | 0.3                                                 |
| ----------------------------------- | --------------------------------------------------- |
| `tmerc({ lon0, k0 })`               | `tmerc({ centralMeridian, scaleFactor })`           |
| `t.lon0`, `t.k0`                    | `t.centralMeridian`, `t.scaleFactor`                |
| `GeographicTransform` type          | `Datum`                                             |
| `centralMeridian(zone)`             | `utm({ zone }).centralMeridian` or `zone * 6 - 183` |
| `MAX_FLATTENING`                    | `0.01`                                              |
| `backend === 'wasm'` (custom build) | `'js'`: non-SIMD builds fall back to JavaScript     |

## Examples

### MapLibre GL: polyline from flat UTM data

```ts
import { utm } from 'fast-proj';
import { lineString } from 'fast-proj/geojson';

const zone = utm({ zone: 33 });
const lonlat = zone.toLonLatInterleaved(xy);
map.addSource('track', { type: 'geojson', data: lineString(lonlat) });
map.addLayer({ id: 'track', type: 'line', source: 'track' });
```

### Leaflet: polyline

```ts
import { latLngs } from 'fast-proj/geojson';

L.polyline(latLngs(zone.toLonLatInterleaved(xy))).addTo(map);
```

### deck.gl: binary attributes, no per-point arrays

```ts
const lonlat = zone.toLonLatInterleaved(xy); // or (xy, xy) to reuse the buffer
new ScatterplotLayer({
  data: { length: lonlat.length / 2, attributes: { getPosition: { value: lonlat, size: 2 } } },
});
```

### Worker: convert off the main thread without copying

```ts
// worker.js
const out = zone.toLonLatInterleaved(xy, xy);
postMessage(out, [out.buffer]);
```

### Mixed zones

```ts
const converters = new Map<string, Utm>();
function converterFor(zone: number, south: boolean) {
  const key = `${zone}${south ? 'S' : 'N'}`;
  let c = converters.get(key);
  if (!c) converters.set(key, (c = utm({ zone, south })));
  return c;
}
```
