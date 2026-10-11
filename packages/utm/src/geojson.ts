import type { Utm } from './utm.js';

export type Position = [lon: number, lat: number];

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}

function check(xy: ArrayLike<number>): number {
  const n = xy.length;
  if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
  return n >> 1;
}

/** Interleaved UTM [x0, y0, x1, y1, ...] -> GeoJSON positions `[lon, lat][]`. */
export function positions(utm: Utm, xy: ArrayLike<number>): Position[] {
  const n = check(xy);
  const out: Position[] = [];
  for (let i = 0; i < n; i++) out.push(utm.toLonLatPoint(xy[2 * i]!, xy[2 * i + 1]!));
  return out;
}

/** Separate UTM easting/northing arrays -> GeoJSON positions `[lon, lat][]`. */
export function positionsFromArrays(utm: Utm, x: ArrayLike<number>, y: ArrayLike<number>): Position[] {
  const n = x.length;
  if (y.length !== n) throw new RangeError('x and y must have the same length');
  const out: Position[] = [];
  for (let i = 0; i < n; i++) out.push(utm.toLonLatPoint(x[i]!, y[i]!));
  return out;
}

/** Interleaved UTM [x0, y0, ...] -> GeoJSON LineString geometry. */
export function lineString(utm: Utm, xy: ArrayLike<number>): LineString {
  return { type: 'LineString', coordinates: positions(utm, xy) };
}

/** Interleaved UTM [x0, y0, ...] -> Leaflet-style `[lat, lng][]` pairs. */
export function latLngs(utm: Utm, xy: ArrayLike<number>): [lat: number, lng: number][] {
  const n = check(xy);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = utm.toLonLatPoint(xy[2 * i]!, xy[2 * i + 1]!);
    const lon = p[0];
    p[0] = p[1];
    p[1] = lon;
    out.push(p);
  }
  return out;
}
