import { type Ellipsoid, WGS84, checkEllipsoid } from './ellipsoid.js';
import { checkOptions } from './checks.js';
import { checkGeographic, withGeographic } from './geographic.js';
import { transverseMercator } from './tmerc.js';
import type { Geographic, Utm } from './types.js';
import { checkZone } from './zone.js';

export interface UtmOptions {
  /** Zone number, 1-60. */
  zone: number;
  /** Southern hemisphere: false northing of 10 000 km. Default `false`. */
  south?: boolean;
  /** Default {@link WGS84}. Flattening must be below 0.01. */
  ellipsoid?: Ellipsoid;
  /** Geographic system of `toLonLat`/`fromLonLat`. Default WGS84. */
  geographic?: Geographic;
}

const OPTIONS = ['zone', 'south', 'ellipsoid', 'geographic'];

/** UTM: transverse Mercator with scale factor 0.9996, false easting 500 km and the zone's central meridian. */
export function utm(options: UtmOptions): Utm {
  const [p, g] = parseUtm(options);
  return withGeographic(p, g);
}

/** Validates the options and builds the JavaScript converter without its geographic step. */
export function parseUtm(options: UtmOptions): [Utm, Geographic | undefined] {
  checkOptions(options, 'utm', OPTIONS);
  const { zone, south = false, ellipsoid = WGS84, geographic } = options;
  checkZone(zone);
  if (typeof south !== 'boolean') throw new TypeError(`fast-proj: south must be a boolean, got ${typeof south}`);
  const e = checkEllipsoid(ellipsoid);
  checkGeographic(geographic);
  const p = transverseMercator(zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0, e);
  return [{ zone, south, ...p }, geographic];
}
