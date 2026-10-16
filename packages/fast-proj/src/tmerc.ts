/**
 * Transverse Mercator <-> geographic conversion with the Krüger series, following
 * C. F. F. Karney, Transverse Mercator with an accuracy of a few nanometers, J. Geodesy 85 (2011) 475-485,
 * https://doi.org/10.1007/s00190-011-0445-3, arXiv:1002.1417.
 *
 * - forward: conformal latitude, then xi', eta' from Eq. (10), Krüger series Eq. (11), scaling Eq. (13);
 * - inverse: Eqs. (15)-(16), then geodetic latitude from the conformal latitude;
 * - A, alpha and beta from Eqs. (29), (35) and (36) truncated to order n^6, as the paper recommends for double
 *   precision; the fixed trigonometric series are evaluated as polynomials equivalent to Clenshaw summation.
 *
 * Unlike the paper, conformal latitude is converted with its Fourier series in n (no Newton iteration), and
 * double-angle identities plus short Taylor expansions of the small series corrections (< 4e-3 rad for f < 0.01)
 * replace most transcendental calls.
 */
import { type Ellipsoid, WGS84, checkEllipsoid, tmSeries } from './ellipsoid.js';
import { checkEven, checkNumber, checkOptions, checkOut, checkSame } from './checks.js';
import { checkGeographic, withGeographic } from './geographic.js';
import type { Geographic, TransverseMercator } from './types.js';

export interface TransverseMercatorOptions {
  /** Degrees, in [-180, 180]. */
  centralMeridian: number;
  /** On the central meridian. Default 1. */
  scaleFactor?: number;
  /** Metres. Default 0. */
  falseEasting?: number;
  /** Metres. Default 0. */
  falseNorthing?: number;
  /** Degrees. Only 0 (the default) is supported yet. */
  latitudeOfOrigin?: number;
  /** Default {@link WGS84}. Flattening must be below 0.01. */
  ellipsoid?: Ellipsoid;
  /** Geographic system of `toLonLat`/`fromLonLat`. Default WGS84. */
  geographic?: Geographic;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const OPTIONS = [
  'centralMeridian',
  'scaleFactor',
  'falseEasting',
  'falseNorthing',
  'latitudeOfOrigin',
  'ellipsoid',
  'geographic',
];
const RENAMED = { lon0: 'centralMeridian', k0: 'scaleFactor' };

export function tmerc(options: TransverseMercatorOptions): TransverseMercator {
  const [p, g] = parseTmerc(options);
  return withGeographic(p, g);
}

/** Validates the options and builds the JavaScript converter without its geographic step. */
export function parseTmerc(options: TransverseMercatorOptions): [TransverseMercator, Geographic | undefined] {
  checkOptions(options, 'tmerc', OPTIONS, RENAMED);
  const {
    centralMeridian,
    scaleFactor = 1,
    falseEasting = 0,
    falseNorthing = 0,
    latitudeOfOrigin = 0,
    ellipsoid = WGS84,
    geographic,
  } = options;
  checkNumber(centralMeridian, 'centralMeridian');
  if (!(Math.abs(centralMeridian) <= 180)) {
    throw new RangeError(`fast-proj: centralMeridian must be in [-180, 180], got ${centralMeridian}`);
  }
  checkNumber(scaleFactor, 'scaleFactor');
  if (!(scaleFactor > 0)) throw new RangeError(`fast-proj: scaleFactor must be positive, got ${scaleFactor}`);
  checkNumber(falseEasting, 'falseEasting');
  checkNumber(falseNorthing, 'falseNorthing');
  checkNumber(latitudeOfOrigin, 'latitudeOfOrigin');
  if (latitudeOfOrigin !== 0) {
    throw new RangeError(`fast-proj: latitudeOfOrigin other than 0 is not supported yet, got ${latitudeOfOrigin}`);
  }
  const e = checkEllipsoid(ellipsoid);
  checkGeographic(geographic);
  return [transverseMercator(centralMeridian, scaleFactor, falseEasting, falseNorthing, e), geographic];
}

/** Builds the converter from validated parameters. */
export function transverseMercator(
  lon0Deg: number,
  k0: number,
  fe: number,
  fn: number,
  ellipsoid: Ellipsoid,
): TransverseMercator {
  const s = tmSeries(ellipsoid);
  const kA = k0 * s.A;
  const invKA = 1 / kA;
  const lon0 = lon0Deg * D2R;
  const [a1, a2, a3, a4, a5, a6] = s.alpha;
  const [b1, b2, b3, b4, b5, b6] = s.beta;
  const [c1, c2, c3, c4, c5, c6] = s.toConformal;
  const [d1, d2, d3, d4, d5, d6] = s.fromConformal;

  // Rewrite the fixed Clenshaw recurrences as degree-five polynomials once per converter.
  // sin(2k t) = sin(2t) U_{k-1}(cos(2t)); these coefficients use p = 2 cos(2t).
  const cp0 = c1 - c3 + c5,
    cp1 = c2 - 2 * c4 + 3 * c6,
    cp2 = c3 - 3 * c5,
    cp3 = c4 - 4 * c6;
  const dp0 = d1 - d3 + d5,
    dp1 = d2 - 2 * d4 + 3 * d6,
    dp2 = d3 - 3 * d5,
    dp3 = d4 - 4 * d6;

  const ap0 = a1 - a3 + a5,
    ap1 = a2 - 2 * a4 + 3 * a6,
    ap2 = a3 - 3 * a5,
    ap3 = a4 - 4 * a6;

  const bp0 = b1 - b3 + b5,
    bp1 = b2 - 2 * b4 + 3 * b6,
    bp2 = b3 - 3 * b5,
    bp3 = b4 - 4 * b6;

  let rx = 0;
  let ry = 0;

  function forward(lonDeg: number, latDeg: number): void {
    const phi = latDeg * D2R;
    // Whole turns first, exactly (% is exact): in radians their rounding error exceeds the NaN cutoff below.
    // The Rust kernels reduce the same way, so all backends agree, including on ±180.
    if (lonDeg > 180 || lonDeg < -180) {
      lonDeg %= 360;
      if (lonDeg > 180) lonDeg -= 360;
      else if (lonDeg < -180) lonDeg += 360;
    }
    const lam = lonDeg * D2R - lon0;

    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const p = 2 - 4 * sp * sp;
    const q1 = cp0 + p * (cp1 + p * (cp2 + p * (cp3 + p * (c5 + p * c6))));
    const dchi = 2 * sp * cp * q1;
    const dd = dchi * dchi;
    const sd = dchi * (1 + dd * (-1 / 6 + dd / 120));
    const cd = 1 + dd * (-1 / 2 + dd / 24);
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
    const sc2 = sc * sc;
    const ccl2 = ccl * ccl;
    const ir = 1 / Math.sqrt(sc2 + ccl2);
    // atan is sufficient in the positive-denominator quadrant; retain atan2 otherwise.
    const xip = ccl > 0 ? Math.atan(sc / ccl) : Math.atan2(sc, ccl);
    const she = cc * sl * ir;
    // asinh(she) = log(she + sqrt(1 + she^2)); cosh(eta') = sqrt(1 + she^2) equals the already-computed ir
    // up to rounding, so only log1p remains. Beyond |she| ~ 1e4 (lon within ~1e-7 degrees of +-90 degrees)
    // the argument rounds to -1, so keep asinh there.
    const etap = she > -1024 && she < 1024 ? Math.log1p(she + (she * she) / (ir + 1)) : Math.asinh(she);

    const ir2 = ir * ir;
    const s2 = 2 * sc * ccl * ir2;
    const c2x = (ccl2 - sc2) * ir2;
    const ch = ir2 + she * she;
    const sh = 2 * she * ir;
    const ar = 2 * c2x * ch;
    const ai = -2 * s2 * sh;

    // For z = ar + i ai, z² = 2 ar z - |z|². Evaluate the real-coefficient
    // polynomial with a real recurrence, then recover its real/imaginary parts.
    const rho = ar * ar + ai * ai;
    const twiceAr = 2 * ar;
    const u4 = a5 + twiceAr * a6;
    const u3 = ap3 + twiceAr * u4 - rho * a6;
    const u2 = ap2 + twiceAr * u3 - rho * u4;
    const u1 = ap1 + twiceAr * u2 - rho * u3;
    const tr = ap0 + ar * u1 - rho * u2;
    const ti = ai * u1;

    const sr = s2 * ch;
    const si = c2x * sh;

    rx = fe + kA * (etap + tr * si + ti * sr);
    ry = fn + kA * (xip + tr * sr - ti * si);
  }

  function inverse(x: number, y: number): void {
    const xi = (y - fn) * invKA;
    const eta = (x - fe) * invKA;

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

    // For z = ar + i ai, z² = 2 ar z - |z|². Evaluate the real-coefficient
    // polynomial with a real recurrence, then recover its real/imaginary parts.
    const rho = ar * ar + ai * ai;
    const twiceAr = 2 * ar;
    const u4 = b5 + twiceAr * b6;
    const u3 = bp3 + twiceAr * u4 - rho * b6;
    const u2 = bp2 + twiceAr * u3 - rho * u4;
    const u1 = bp1 + twiceAr * u2 - rho * u3;
    const tr = bp0 + ar * u1 - rho * u2;
    // Clenshaw yields +0 for a zero imaginary argument; retain its equator sign.
    const ti = ai * u1 + 0;

    const sr = s2 * ch;
    const si = c2x * sh;
    const dxi = tr * sr - ti * si;
    const deta = tr * si + ti * sr;

    const dx2 = dxi * dxi;
    const sdx = dxi * (1 + dx2 * (-1 / 6 + dx2 / 120));
    const cdx = 1 + dx2 * (-1 / 2 + dx2 / 24);
    const de2 = deta * deta;
    const shd = deta * (1 + de2 * (1 / 6 + de2 / 120));
    const chd = 1 + de2 * (1 / 2 + de2 / 24);
    const sx = s1 * cdx - c1x * sdx;
    const cx = c1x * cdx + s1 * sdx;
    const she = sh1 * chd - ch1 * shd;

    const h2 = she * she + cx * cx;
    const h = Math.sqrt(h2);
    // Keep atan2 for other quadrants and for zero, NaN or infinite operands (atan(Inf/Inf) is NaN).
    const lam = cx > 0 && Number.isFinite(she) ? Math.atan(she / cx) : Math.atan2(she, cx);
    const chi = h > 0 && Number.isFinite(sx) ? Math.atan(sx / h) : Math.atan2(sx, h);

    const sx2 = sx * sx;
    const r2 = sx2 + h2;
    const p = (2 * (h2 - sx2)) / r2;
    const q1 = dp0 + p * (dp1 + p * (dp2 + p * (dp3 + p * (d5 + p * d6))));
    const phi = chi + ((2 * sx * h) / r2) * q1;

    let lon = (lon0 + lam) * R2D;
    if (lon > 180) lon -= 360;
    else if (lon < -180) lon += 360;
    rx = lon;
    ry = phi * R2D;
  }

  return {
    centralMeridian: lon0Deg,
    scaleFactor: k0,
    falseEasting: fe,
    falseNorthing: fn,
    latitudeOfOrigin: 0,
    ellipsoid,
    toLonLat(x, y, lon, lat) {
      const n = x.length;
      checkSame(n, y.length, 'x and y');
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
      checkSame(n, lat.length, 'lon and lat');
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
