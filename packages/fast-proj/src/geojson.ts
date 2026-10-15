/**
 * Formatting of longitude/latitude buffers (the output of any converter or chain) for map libraries. No
 * conversion happens here.
 */
export type Position = [lon: number, lat: number];

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}

function check(lonlat: ArrayLike<number>): number {
  const n = lonlat.length;
  if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
  return n >> 1;
}

/** Interleaved [lon0, lat0, lon1, lat1, ...] -> GeoJSON positions `[lon, lat][]`. */
export function positions(lonlat: ArrayLike<number>): Position[] {
  const n = check(lonlat);
  const out: Position[] = [];
  for (let i = 0; i < n; i++) out.push([lonlat[2 * i]!, lonlat[2 * i + 1]!]);
  return out;
}

/** Separate longitude/latitude arrays -> GeoJSON positions `[lon, lat][]`. */
export function positionsFromArrays(lon: ArrayLike<number>, lat: ArrayLike<number>): Position[] {
  const n = lon.length;
  if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
  const out: Position[] = [];
  for (let i = 0; i < n; i++) out.push([lon[i]!, lat[i]!]);
  return out;
}

/** Interleaved [lon0, lat0, ...] -> GeoJSON LineString geometry. */
export function lineString(lonlat: ArrayLike<number>): LineString {
  return { type: 'LineString', coordinates: positions(lonlat) };
}

/** Interleaved [lon0, lat0, ...] -> Leaflet-style `[lat, lng][]` pairs. */
export function latLngs(lonlat: ArrayLike<number>): [lat: number, lng: number][] {
  const n = check(lonlat);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([lonlat[2 * i + 1]!, lonlat[2 * i]!]);
  return out;
}
