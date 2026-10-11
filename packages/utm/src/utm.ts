/**
 * UTM <-> geographic conversion with the Krüger series, following
 * C. F. F. Karney, Transverse Mercator with an accuracy of a few nanometers, J. Geodesy 85 (2011) 475-485,
 * https://doi.org/10.1007/s00190-011-0445-3, arXiv:1002.1417.
 *
 * - forward: conformal latitude, then xi', eta' from Eq. (10), Krüger series Eq. (11), scaling Eq. (13);
 * - inverse: Eqs. (15)-(16), then geodetic latitude from the conformal latitude;
 * - A, alpha and beta from Eqs. (29), (35) and (36) truncated to order n^6, as the paper recommends for double
 *   precision; the trigonometric series are evaluated with Clenshaw summation, as in the paper.
 *
 * Unlike the paper, conformal latitude is converted with its Fourier series in n (no Newton iteration), and
 * double-angle identities plus short Taylor expansions of the small series corrections (< 4e-3 rad for f < 0.01)
 * replace most transcendental calls.
 */
import { type Ellipsoid, WGS84, checkEllipsoid, tmSeries } from './ellipsoid.js';
import { checkZone } from './zone.js';

export interface UtmOptions {
  /** Zone number, 1-60. */
  zone: number;
  /** Southern hemisphere: false northing of 10 000 km. Default `false`. */
  south?: boolean;
  /** Default {@link WGS84}. Flattening must be below 0.01. */
  ellipsoid?: Ellipsoid;
}

/**
 * A converter for one UTM zone.
 *
 * Batch methods accept any array-like input and write into the optional output buffers, which must be at least as
 * long as the input. An output buffer may be the corresponding input itself (in-place), but must not otherwise
 * overlap an input.
 */
export interface Utm {
  readonly zone: number;
  readonly south: boolean;
  /** Easting/northing arrays in metres -> longitude/latitude arrays in degrees. */
  toLonLat(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    lon?: Float64Array,
    lat?: Float64Array,
  ): { lon: Float64Array; lat: Float64Array };
  /** Longitude/latitude arrays in degrees -> easting/northing arrays in metres. */
  fromLonLat(
    lon: ArrayLike<number>,
    lat: ArrayLike<number>,
    x?: Float64Array,
    y?: Float64Array,
  ): { x: Float64Array; y: Float64Array };
  /** Interleaved [x0, y0, x1, y1, ...] -> interleaved [lon0, lat0, ...]. */
  toLonLatInterleaved(xy: ArrayLike<number>, out?: Float64Array): Float64Array;
  /** Interleaved [lon0, lat0, ...] -> interleaved [x0, y0, ...]. */
  fromLonLatInterleaved(lonlat: ArrayLike<number>, out?: Float64Array): Float64Array;
  toLonLatPoint(x: number, y: number): [lon: number, lat: number];
  fromLonLatPoint(lon: number, lat: number): [x: number, y: number];
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

function checkOut(out: ArrayLike<number>, n: number, name: string): void {
  if (out.length < n) throw new RangeError(`${name} has length ${out.length}, needs at least ${n}`);
}

function checkEven(n: number): void {
  if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
}

export function utm({ zone, south = false, ellipsoid = WGS84 }: UtmOptions): Utm {
  checkZone(zone);
  if (typeof south !== 'boolean') throw new TypeError(`south must be a boolean, got ${typeof south}`);
  checkEllipsoid(ellipsoid);
  const s = tmSeries(ellipsoid);
  const kA = K0 * s.A;
  const invKA = 1 / kA;
  const lon0 = (zone * 6 - 183) * D2R;
  const fn = south ? FALSE_NORTHING_SOUTH : 0;
  const [a1, a2, a3, a4, a5, a6] = s.alpha;
  const [b1, b2, b3, b4, b5, b6] = s.beta;
  const [c1, c2, c3, c4, c5, c6] = s.toConformal;
  const [d1, d2, d3, d4, d5, d6] = s.fromConformal;

  let rx = 0;
  let ry = 0;

  function forward(lonDeg: number, latDeg: number): void {
    const phi = latDeg * D2R;
    const lam = lonDeg * D2R - lon0;

    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const p = 2 * (cp * cp - sp * sp);
    const q5 = c5 + p * c6;
    const q4 = c4 + p * q5 - c6;
    const q3 = c3 + p * q4 - q5;
    const q2 = c2 + p * q3 - q4;
    const q1 = c1 + p * q2 - q3;
    const dchi = 2 * sp * cp * q1;
    const dd = dchi * dchi;
    const sd = dchi * (1 - (dd / 6) * (1 - dd / 20));
    const cd = 1 - (dd / 2) * (1 - dd / 12);
    const sc = sp * cd + cp * sd;
    const cc = cp * cd - sp * sd;

    const sl = Math.sin(lam);
    const cl = Math.cos(lam);
    if (!(cl > 1e-15)) {
      rx = NaN;
      ry = NaN;
      return;
    }
    const ccl = cc * cl;
    const ir = 1 / Math.sqrt(sc * sc + ccl * ccl);
    const xip = Math.atan2(sc, ccl);
    const she = cc * sl * ir;
    const etap = Math.asinh(she);

    const sx = sc * ir;
    const cx = ccl * ir;
    const s2 = 2 * sx * cx;
    const c2x = cx * cx - sx * sx;
    const ch = ir * ir + she * she;
    const sh = 2 * she * ir;
    const ar = 2 * c2x * ch;
    const ai = -2 * s2 * sh;
    const br5 = ar * a6 + a5;
    const bi5 = ai * a6;
    const br4 = ar * br5 - ai * bi5 - a6 + a4;
    const bi4 = ar * bi5 + ai * br5;
    const br3 = ar * br4 - ai * bi4 - br5 + a3;
    const bi3 = ar * bi4 + ai * br4 - bi5;
    const br2 = ar * br3 - ai * bi3 - br4 + a2;
    const bi2 = ar * bi3 + ai * br3 - bi4;
    const tr = ar * br2 - ai * bi2 - br3 + a1;
    const ti = ar * bi2 + ai * br2 - bi3;
    const sr = s2 * ch;
    const si = c2x * sh;

    rx = FALSE_EASTING + kA * (etap + tr * si + ti * sr);
    ry = fn + kA * (xip + tr * sr - ti * si);
  }

  function inverse(x: number, y: number): void {
    const xi = (y - fn) * invKA;
    const eta = (x - FALSE_EASTING) * invKA;

    const s1 = Math.sin(xi);
    const c1x = Math.cos(xi);
    const e = Math.exp(eta);
    const ie = 1 / e;
    const ch1 = 0.5 * (e + ie);
    const sh1 = 0.5 * (e - ie);
    const s2 = 2 * s1 * c1x;
    const c2x = c1x * c1x - s1 * s1;
    const ch = ch1 * ch1 + sh1 * sh1;
    const sh = 2 * sh1 * ch1;
    const ar = 2 * c2x * ch;
    const ai = -2 * s2 * sh;
    const br5 = ar * b6 + b5;
    const bi5 = ai * b6;
    const br4 = ar * br5 - ai * bi5 - b6 + b4;
    const bi4 = ar * bi5 + ai * br5;
    const br3 = ar * br4 - ai * bi4 - br5 + b3;
    const bi3 = ar * bi4 + ai * br4 - bi5;
    const br2 = ar * br3 - ai * bi3 - br4 + b2;
    const bi2 = ar * bi3 + ai * br3 - bi4;
    const tr = ar * br2 - ai * bi2 - br3 + b1;
    const ti = ar * bi2 + ai * br2 - bi3;
    const sr = s2 * ch;
    const si = c2x * sh;
    const dxi = tr * sr - ti * si;
    const deta = tr * si + ti * sr;

    const dx2 = dxi * dxi;
    const sdx = dxi * (1 - (dx2 / 6) * (1 - dx2 / 20));
    const cdx = 1 - (dx2 / 2) * (1 - dx2 / 12);
    const de2 = deta * deta;
    const shd = deta * (1 + (de2 / 6) * (1 + de2 / 20));
    const chd = 1 + (de2 / 2) * (1 + de2 / 12);
    const sx = s1 * cdx - c1x * sdx;
    const cx = c1x * cdx + s1 * sdx;
    const she = sh1 * chd - ch1 * shd;

    const h2 = she * she + cx * cx;
    const h = Math.sqrt(h2);
    const lam = Math.atan2(she, cx);
    const chi = Math.atan2(sx, h);

    const r2 = sx * sx + h2;
    const p = (2 * (h2 - sx * sx)) / r2;
    const q5 = d5 + p * d6;
    const q4 = d4 + p * q5 - d6;
    const q3 = d3 + p * q4 - q5;
    const q2 = d2 + p * q3 - q4;
    const q1 = d1 + p * q2 - q3;
    const phi = chi + ((2 * sx * h) / r2) * q1;

    let lon = (lon0 + lam) * R2D;
    if (lon > 180) lon -= 360;
    else if (lon < -180) lon += 360;
    rx = lon;
    ry = phi * R2D;
  }

  return {
    zone,
    south,
    toLonLat(x, y, lon, lat) {
      const n = x.length;
      if (y.length !== n) throw new RangeError('x and y must have the same length');
      if (lon) checkOut(lon, n, 'lon');
      else lon = new Float64Array(n);
      if (lat) checkOut(lat, n, 'lat');
      else lat = new Float64Array(n);
      const res = { lon, lat };
      for (let i = 0; i < n; i++) {
        inverse(x[i]!, y[i]!);
        lon[i] = rx;
        lat[i] = ry;
      }
      return res;
    },
    fromLonLat(lon, lat, x, y) {
      const n = lon.length;
      if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
      if (x) checkOut(x, n, 'x');
      else x = new Float64Array(n);
      if (y) checkOut(y, n, 'y');
      else y = new Float64Array(n);
      const res = { x, y };
      for (let i = 0; i < n; i++) {
        forward(lon[i]!, lat[i]!);
        x[i] = rx;
        y[i] = ry;
      }
      return res;
    },
    toLonLatInterleaved(xy, out) {
      const n = xy.length;
      checkEven(n);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        inverse(xy[i]!, xy[i + 1]!);
        out[i] = rx;
        out[i + 1] = ry;
      }
      return out;
    },
    fromLonLatInterleaved(lonlat, out) {
      const n = lonlat.length;
      checkEven(n);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        forward(lonlat[i]!, lonlat[i + 1]!);
        out[i] = rx;
        out[i + 1] = ry;
      }
      return out;
    },
    toLonLatPoint(x, y) {
      inverse(x, y);
      return [rx, ry];
    },
    fromLonLatPoint(lon, lat) {
      forward(lon, lat);
      return [rx, ry];
    },
  };
}
