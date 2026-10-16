import { checkOut, checkSame } from './checks.js';
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
  if (
    typeof g !== 'object' ||
    g === null ||
    METHODS.some((m) => typeof (g as Record<string, unknown>)[m] !== 'function')
  ) {
    throw new TypeError(`fast-proj: geographic must have the methods ${METHODS.join(', ')}`);
  }
}

/**
 * Freezes `p`, first composing it with `g` when given: x/y <-> WGS84 (`p`) <-> `g`. Each batch method runs the two
 * steps on the same output buffer.
 */
export function withGeographic<T extends Projection>(p: T, g: Geographic | undefined): T {
  if (!g) return Object.freeze(p);
  return Object.freeze({
    ...p,
    geographic: g,
    toLonLat(x, y, lon, lat) {
      const r = p.toLonLat(x, y, lon, lat);
      g.fromWgs84(r.lon, r.lat, r.lon, r.lat);
      return r;
    },
    fromLonLat(lon, lat, x, y) {
      const n = lon.length;
      checkSame(n, lat.length, 'lon and lat');
      if (x) checkOut(x, n, 'x');
      else x = new Float64Array(n);
      if (y) checkOut(y, n, 'y');
      else y = new Float64Array(n);
      g.toWgs84(lon, lat, x, y);
      return p.fromLonLat(x, y, x, y);
    },
    toLonLatInterleaved(xy, out) {
      out = p.toLonLatInterleaved(xy, out);
      return g.fromWgs84Interleaved(out, out);
    },
    fromLonLatInterleaved(lonlat, out) {
      out = g.toWgs84Interleaved(lonlat, out);
      return p.fromLonLatInterleaved(out, out);
    },
    toLonLatPoint(x, y) {
      const [lon, lat] = p.toLonLatPoint(x, y);
      return g.fromWgs84Point(lon, lat);
    },
    fromLonLatPoint(lon, lat) {
      const [l, b] = g.toWgs84Point(lon, lat);
      return p.fromLonLatPoint(l, b);
    },
  } satisfies Projection);
}
