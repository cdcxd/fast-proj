import { type Ellipsoid, WGS84, checkEllipsoid } from './ellipsoid.js';
import { transverseMercator } from './tmerc.js';
import type { Utm } from './types.js';
import { checkZone } from './zone.js';

export interface UtmOptions {
  /** Zone number, 1-60. */
  zone: number;
  /** Southern hemisphere: false northing of 10 000 km. Default `false`. */
  south?: boolean;
  /** Default {@link WGS84}. Flattening must be below 0.01. */
  ellipsoid?: Ellipsoid;
}

/** UTM: transverse Mercator with k0 = 0.9996, false easting 500 km and the zone's central meridian. */
export function utm({ zone, south = false, ellipsoid = WGS84 }: UtmOptions): Utm {
  checkZone(zone);
  if (typeof south !== 'boolean') throw new TypeError(`south must be a boolean, got ${typeof south}`);
  checkEllipsoid(ellipsoid);
  return { zone, south, ...transverseMercator(zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0, ellipsoid) };
}
