import { checkEven, checkOut, checkSame } from './checks.js';
import type { Geographic, Projection } from './types.js';

const METHODS = [
  'toWgs84',
  'fromWgs84',
  'toWgs84Interleaved',
  'fromWgs84Interleaved',
  'toWgs84Point',
  'fromWgs84Point',
] as const;

export function checkGeographic(g: unknown): asserts g is Geographic | undefined {
  if (g === undefined) return;
  if (typeof g !== 'object' || g === null) {
    throw new TypeError(`fast-proj: geographic must be an object, got ${g === null ? 'null' : typeof g}`);
  }
  const missing = METHODS.filter((m) => typeof (g as Record<string, unknown>)[m] !== 'function');
  if (missing.length) throw new TypeError(`fast-proj: geographic is missing the methods ${missing.join(', ')}`);
}

/** The constants of a JavaScript transverse Mercator's inverse, for a geographic system's fused kernel. */
export interface TmInverse {
  lon0Deg: number;
  lon0: number;
  fe: number;
  fn: number;
  invKA: number;
  bp0: number;
  bp1: number;
  bp2: number;
  bp3: number;
  b5: number;
  b6: number;
  dp0: number;
  dp1: number;
  dp2: number;
  dp3: number;
  d5: number;
  d6: number;
}

/** x/y -> a geographic system's longitude/latitude in one pass, with the batch loop signature of tmerc.ts. */
export interface FusedInverse {
  batch(
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    outA: Float64Array,
    outB: Float64Array,
    o1: number,
    step: number,
    end: number,
  ): void;
  point(x: number, y: number): [number, number];
}

/**
 * JavaScript transverse Mercators by their `toLonLat`, which `{ ...p }` copies keep and a wasm converter replaces.
 * The geographic systems that can fuse their `fromWgs84` into one register a builder: kept here, so neither module
 * pulls in the other.
 */
export const tmInverses: WeakMap<object, TmInverse> = new WeakMap();
export const fusers: WeakMap<Geographic, (t: TmInverse) => FusedInverse> = new WeakMap();

// The first n elements, as the buffer itself when it has exactly n: a geographic system gets one array as both input
// and output (in place), never two overlapping views.
function head(a: Float64Array, n: number): Float64Array {
  return a.length === n ? a : a.subarray(0, n);
}

/**
 * Freezes `p`, first composing it with `g` when given: x/y <-> WGS84 (`p`) <-> `g`. Each batch method runs the two
 * steps on the first n elements of the output buffer, the second in place, except x/y -> `g` in one pass when `g`
 * fuses with `p`. `live` runs before any step, so a call on a disposed wasm
 * context throws before writing anything.
 */
export function withGeographic<T extends Projection>(p: T, g: Geographic | undefined, live?: () => void): T {
  if (!g) return Object.freeze(p);
  const check = live ?? (() => {});
  const t = tmInverses.get(p.toLonLat);
  const f = t && fusers.get(g)?.(t);
  return Object.freeze({
    ...p,
    geographic: g,
    toLonLat(x, y, lon, lat) {
      check();
      const n = x.length;
      if (f) {
        checkSame(n, y.length, 'x and y');
        if (lon) checkOut(lon, n, 'lon');
        else lon = new Float64Array(n);
        if (lat) checkOut(lat, n, 'lat');
        else lat = new Float64Array(n);
        f.batch(x, y, lon, lat, 0, 1, n);
        return { lon, lat };
      }
      const r = p.toLonLat(x, y, lon, lat);
      const lo = head(r.lon, n),
        la = head(r.lat, n);
      g.fromWgs84(lo, la, lo, la);
      return r;
    },
    fromLonLat(lon, lat, x, y) {
      check();
      const n = lon.length;
      checkSame(n, lat.length, 'lon and lat');
      if (x) checkOut(x, n, 'x');
      else x = new Float64Array(n);
      if (y) checkOut(y, n, 'y');
      else y = new Float64Array(n);
      g.toWgs84(lon, lat, x, y);
      const xs = head(x, n),
        ys = head(y, n);
      p.fromLonLat(xs, ys, xs, ys);
      return { x, y };
    },
    toLonLatInterleaved(xy, out) {
      check();
      if (f) {
        const n = xy.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        f.batch(xy, xy, out, out, 1, 2, n);
        return out;
      }
      out = p.toLonLatInterleaved(xy, out);
      const o = head(out, xy.length);
      g.fromWgs84Interleaved(o, o);
      return out;
    },
    fromLonLatInterleaved(lonlat, out) {
      check();
      out = g.toWgs84Interleaved(lonlat, out);
      const o = head(out, lonlat.length);
      p.fromLonLatInterleaved(o, o);
      return out;
    },
    toLonLatPoint(x, y) {
      check();
      if (f) return f.point(x, y);
      const [lon, lat] = p.toLonLatPoint(x, y);
      return g.fromWgs84Point(lon, lat);
    },
    fromLonLatPoint(lon, lat) {
      check();
      const [l, b] = g.toWgs84Point(lon, lat);
      return p.fromLonLatPoint(l, b);
    },
  } satisfies Projection);
}
