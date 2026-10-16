/**
 * Formatting of longitude/latitude buffers (the output of any converter or chain) for map libraries. No
 * conversion happens here. Each helper takes interleaved `[lon0, lat0, lon1, lat1, ...]` or separate `lon`, `lat`
 * arrays (the `{ lon, lat }` result of `toLonLat`).
 */
import { checkEven, checkSame } from './checks.js';

export type Position = [lon: number, lat: number];

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}

function pairs(a: ArrayLike<number>, b: ArrayLike<number> | undefined, latFirst: boolean): [number, number][] {
  const out: [number, number][] = [];
  if (b === undefined) {
    const n = a.length;
    checkEven(n);
    const p = latFirst ? 1 : 0;
    for (let i = 0; i < n; i += 2) out.push([a[i + p]!, a[i + 1 - p]!]);
  } else {
    const n = a.length;
    checkSame(n, b.length, 'lon and lat');
    for (let i = 0; i < n; i++) out.push(latFirst ? [b[i]!, a[i]!] : [a[i]!, b[i]!]);
  }
  return out;
}

/** GeoJSON positions `[lon, lat][]`. */
export function positions(lonlat: ArrayLike<number>): Position[];
export function positions(lon: ArrayLike<number>, lat: ArrayLike<number>): Position[];
export function positions(a: ArrayLike<number>, b?: ArrayLike<number>): Position[] {
  return pairs(a, b, false);
}

/** GeoJSON LineString geometry. */
export function lineString(lonlat: ArrayLike<number>): LineString;
export function lineString(lon: ArrayLike<number>, lat: ArrayLike<number>): LineString;
export function lineString(a: ArrayLike<number>, b?: ArrayLike<number>): LineString {
  return { type: 'LineString', coordinates: pairs(a, b, false) };
}

/** Leaflet-style `[lat, lng][]` pairs. */
export function latLngs(lonlat: ArrayLike<number>): [lat: number, lng: number][];
export function latLngs(lon: ArrayLike<number>, lat: ArrayLike<number>): [lat: number, lng: number][];
export function latLngs(a: ArrayLike<number>, b?: ArrayLike<number>): [lat: number, lng: number][] {
  return pairs(a, b, true);
}
