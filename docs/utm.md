# @fast-proj/utm API

```ts
import { utm, utmFor, zoneFor, centralMeridian, WGS84, GRS80, MAX_FLATTENING } from '@fast-proj/utm';
import { positions, positionsFromArrays, lineString, latLngs } from '@fast-proj/utm/geojson';
```

ESM-only. All angles are in degrees, all distances in metres. Coordinates are WGS84 unless another ellipsoid is
passed (no datum shifts).

- [`utm(options)`](#utmoptions)
- [Converter methods](#converter-methods)
- [Buffers and aliasing](#buffers-and-aliasing)
- [Zones: `utmFor`, `zoneFor`, `centralMeridian`](#zones)
- [Ellipsoids](#ellipsoids)
- [GeoJSON and Leaflet helpers](#geojson-and-leaflet-helpers)
- [Domain and accuracy](#domain-and-accuracy)
- [Examples](#examples)

## `utm(options)`

Creates a converter for one UTM zone. Series coefficients are computed once here; keep the converter and reuse it.

```ts
function utm(options: UtmOptions): Utm;

interface UtmOptions {
  zone: number; // 1-60
  south?: boolean; // default false: false northing 10 000 km when true
  ellipsoid?: Ellipsoid; // default WGS84
}
```

Throws:

- `RangeError` if `zone` is not an integer in 1-60;
- `TypeError` if `south` is given and is not a boolean;
- `RangeError` if the ellipsoid has `a <= 0`, a non-finite `a`, or a flattening outside `0 <= f < 0.01`.

`south` only selects the false northing; it does not check the input. With `south: false`, points south of the
equator get negative northings; with `south: true`, points north of the equator get northings above 10 000 km.

The returned converter exposes `zone` and `south` (read-only).

## Converter methods

| method                                | input                         | output                                         |
| ------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `toLonLat(x, y, lon?, lat?)`          | easting and northing arrays   | `{ lon, lat }` `Float64Array`s                 |
| `fromLonLat(lon, lat, x?, y?)`        | longitude and latitude arrays | `{ x, y }` `Float64Array`s                     |
| `toLonLatInterleaved(xy, out?)`       | `[x0, y0, x1, y1, ...]`       | `[lon0, lat0, lon1, lat1, ...]` `Float64Array` |
| `fromLonLatInterleaved(lonlat, out?)` | `[lon0, lat0, ...]`           | `[x0, y0, ...]` `Float64Array`                 |
| `toLonLatPoint(x, y)`                 | one point                     | `[lon, lat]`                                   |
| `fromLonLatPoint(lon, lat)`           | one point                     | `[x, y]`                                       |

Inputs may be any array-like of numbers (`number[]`, `Float64Array`, `Float32Array`, ...). Outputs are new
`Float64Array`s unless output buffers are passed, in which case those buffers are filled and returned.

Throws `RangeError` when:

- the two input arrays of `toLonLat`/`fromLonLat` differ in length;
- an interleaved input has an odd length;
- an output buffer is shorter than the input.

The point methods never throw; invalid input gives `NaN`.

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
function centralMeridian(zone: number): number;
```

`zoneFor` returns the standard UTM zone, including the Norway (32V) and Svalbard (31X, 33X, 35X, 37X) exceptions.
Longitude is wrapped, so 190 gives zone 2. `utmFor` adds `south: lat < 0`, and its result can be passed straight
to `utm`.

Both throw `RangeError` for non-finite input and for latitudes outside [-80, 84] (the polar regions use UPS, which
this package does not implement).

`centralMeridian(zone)` returns `zone * 6 - 183` and throws `RangeError` for invalid zones.

## Ellipsoids

```ts
interface Ellipsoid {
  readonly a: number; // semi-major axis, metres
  readonly f: number; // flattening
}
const WGS84: Ellipsoid; // frozen
const GRS80: Ellipsoid; // frozen
const MAX_FLATTENING = 0.01;
```

Any ellipsoid with `0 <= f < MAX_FLATTENING` is supported; this covers every terrestrial ellipsoid (Earth's is
0.0034). The implementation's small-angle expansions are exact to double precision only in that range.

## GeoJSON and Leaflet helpers

`@fast-proj/utm/geojson` converts flat UTM input straight into the nested arrays map libraries take. Each position
is the array returned by `toLonLatPoint`, so there is no allocation beyond what the output format needs.

```ts
type Position = [lon: number, lat: number];

function positions(utm: Utm, xy: ArrayLike<number>): Position[];
function positionsFromArrays(utm: Utm, x: ArrayLike<number>, y: ArrayLike<number>): Position[];
function lineString(utm: Utm, xy: ArrayLike<number>): { type: 'LineString'; coordinates: Position[] };
function latLngs(utm: Utm, xy: ArrayLike<number>): [lat: number, lng: number][];
```

`positions`, `lineString` and `latLngs` take interleaved input and throw `RangeError` for odd lengths.
`positionsFromArrays` throws `RangeError` when `x` and `y` differ in length. `latLngs` returns Leaflet's
latitude-first order.

## Domain and accuracy

- **Accuracy** within 30° of the central meridian, all latitudes including the poles: at most 4e-9 m forward and
  1e-13° inverse against a 30-digit reference (`packages/utm/test/fixtures`), and about 6e-9 m / 1.3e-13° against
  proj4.
- **Recommended domain:** within ~45° of the central meridian. Accuracy degrades further out, as for any Krüger
  series implementation.
- Points **90° or more** from the central meridian return `NaN` from the forward methods.
- At the poles, the inverse returns the central meridian as longitude.
- Output longitudes are normalised to [-180, 180]; input longitudes may be outside that range.
- `NaN` and `Infinity` inputs give `NaN`.

Reference: C. F. F. Karney, _Transverse Mercator with an accuracy of a few nanometers_, J. Geodesy 85 (2011)
475–485, [doi:10.1007/s00190-011-0445-3](https://doi.org/10.1007/s00190-011-0445-3). Equation-level references are
in [`src/utm.ts`](../packages/utm/src/utm.ts).

## Examples

### MapLibre GL: polyline from flat UTM data

```ts
import { utm } from '@fast-proj/utm';
import { lineString } from '@fast-proj/utm/geojson';

const zone = utm({ zone: 33 });
map.addSource('track', { type: 'geojson', data: lineString(zone, xy) });
map.addLayer({ id: 'track', type: 'line', source: 'track' });
```

### Leaflet: polyline

```ts
import { latLngs } from '@fast-proj/utm/geojson';

L.polyline(latLngs(zone, xy)).addTo(map);
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
