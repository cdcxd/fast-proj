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
import { checkEven, checkNumber, checkOptions, checkSame, output } from './checks.js';
import { checkGeographic, tmInverses, withGeographic } from './geographic.js';
import type { Geographic, Impl, TransverseMercator } from './types.js';
import * as P from './poly.js';

// Bound here, not imported, as in gcj02.ts.
const KC1 = P.KC1;
const KC2 = P.KC2;
const KC3 = P.KC3;
const KC4 = P.KC4;
const KC5 = P.KC5;
const KC6 = P.KC6;
const KS1 = P.KS1;
const KS2 = P.KS2;
const KS3 = P.KS3;
const KS4 = P.KS4;
const KS5 = P.KS5;
const KS6 = P.KS6;
const atanQ = P.atanQ;

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

  // @kernel
  function forward(lonDeg: number, latDeg: number): void {
    // Whole turns first, exactly (% is exact): in radians their rounding error exceeds the NaN cutoff below.
    // The Rust kernels reduce the same way, so all backends agree, including on ±180.
    if (lonDeg > 180 || lonDeg < -180) {
      lonDeg %= 360;
      if (lonDeg > 180) lonDeg -= 360;
      else if (lonDeg < -180) lonDeg += 360;
    }
    const lam = lonDeg * D2R - lon0;

    // sin, cos by double angles from half the angle (|phi / 2| < pi / 4), with the rounding of 1 - z/2 compensated
    // (FreeBSD's k_cos form): these feed atan(sin chi / (cos chi cos lam)), whose error is y's. Poleward of 45 degrees
    // from half the colatitude (exact in degrees there), as the doubled cos is accurate only to a few 1e-16 absolute.
    // lam within 0.8 rad, where the doubled cos keeps its relative accuracy, as wide as UTM ever needs.
    let sp, cp;
    const alat = Math.abs(latDeg);
    if (alat < 90) {
      const hx = 0.5 * D2R * (alat > 45 ? 90 - alat : latDeg);
      const z = hx * hx;
      const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
      const hz = 0.5 * z;
      const w = 1 - hz;
      const cs = w + (1 - w - hz + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6))))));
      const dsin = 2 * sn * cs;
      const dcos = (cs - sn) * (cs + sn);
      // 0 keeps its sign.
      sp = alat > 45 ? (latDeg < 0 ? -dcos : dcos) : latDeg === 0 ? latDeg : dsin;
      cp = alat > 45 ? dsin : dcos;
    } else {
      const phi = latDeg * D2R;
      sp = Math.sin(phi);
      cp = Math.cos(phi);
    }
    const p = 2 - 4 * sp * sp;
    const q1 = cp0 + p * (cp1 + p * (cp2 + p * (cp3 + p * (c5 + p * c6))));
    const dchi = 2 * sp * cp * q1;
    const dd = dchi * dchi;
    const sd = dchi * (1 + dd * (-1 / 6 + dd * (1 / 120)));
    const cd = 1 + dd * (-1 / 2 + dd * (1 / 24));
    const sc = sp * cd + cp * sd;
    const cc = cp * cd - sp * sd;

    let sl, cl;
    if (lam > -0.8 && lam < 0.8) {
      const hx = 0.5 * lam;
      const z = hx * hx;
      const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
      const hz = 0.5 * z;
      const w = 1 - hz;
      const cs = w + (1 - w - hz + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6))))));
      // 0 keeps its sign.
      sl = lam === 0 ? lam : 2 * sn * cs;
      cl = (cs - sn) * (cs + sn);
    } else {
      sl = Math.sin(lam);
      cl = Math.cos(lam);
    }
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
    const xip = ccl > 0 ? atanQ(sc, ccl) : Math.atan2(sc, ccl);
    const she = cc * sl * ir;
    // eta' = asinh(she) = atanh(cc sl), as cosh(eta') = 1 / ir: its series within |cc sl| < 0.1 (about 6 degrees from
    // the central meridian; the next term is below 1e-19 relative). Otherwise log(she + sqrt(1 + she^2)) with that
    // cosh, so only log1p remains; beyond |she| ~ 1e4 (lon within ~1e-7 degrees of +-90 degrees) the argument rounds
    // to -1, so keep asinh there.
    const z = cc * sl;
    const zz = z * z;
    const etap =
      zz < 0.01
        ? z +
          z *
            zz *
            (1 / 3 +
              zz * (1 / 5 + zz * (1 / 7 + zz * (1 / 9 + zz * (1 / 11 + zz * (1 / 13 + zz * (1 / 15 + zz * (1 / 17))))))))
        : she > -1024 && she < 1024
          ? Math.log1p(she + (she * she) / (ir + 1))
          : Math.asinh(she);

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

  // @kernel
  function inverse(x: number, y: number): void {
    const xi = (y - fn) * invKA;
    const eta = (x - fe) * invKA;

    let s1, c1x;
    if (xi > -1.5707963267948966 && xi < 1.5707963267948966) {
      // sin, cos of xi / 2 (|xi / 2| < pi / 4), then double angles.
      const hx = 0.5 * xi;
      const z = hx * hx;
      const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
      const cs = 1 - 0.5 * z + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6)))));
      // xi = 0 keeps its sign.
      s1 = xi === 0 ? xi : 2 * sn * cs;
      c1x = (cs - sn) * (cs + sn);
    } else {
      s1 = Math.sin(xi);
      c1x = Math.cos(xi);
    }
    let ch1, sh1;
    if (eta > -0.35 && eta < 0.35) {
      const w = eta * eta;
      sh1 =
        eta +
        eta * w * (1 / 6 + w * (1 / 120 + w * (1 / 5040 + w * (1 / 362880 + w * (1 / 39916800 + w * (1 / 6227020800))))));
      ch1 = 1 + w * (1 / 2 + w * (1 / 24 + w * (1 / 720 + w * (1 / 40320 + w * (1 / 3628800 + w * (1 / 479001600))))));
    } else {
      const e = Math.exp(eta);
      const ie = 1 / e;
      ch1 = 0.5 * (e + ie);
      sh1 = 0.5 * (e - ie);
    }
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
    const sdx = dxi * (1 + dx2 * (-1 / 6 + dx2 * (1 / 120)));
    const cdx = 1 + dx2 * (-1 / 2 + dx2 * (1 / 24));
    const de2 = deta * deta;
    const shd = deta * (1 + de2 * (1 / 6 + de2 * (1 / 120)));
    const chd = 1 + de2 * (1 / 2 + de2 * (1 / 24));
    const sx = s1 * cdx - c1x * sdx;
    const cx = c1x * cdx + s1 * sdx;
    const she = sh1 * chd - ch1 * shd;

    const h2 = she * she + cx * cx;
    const h = Math.sqrt(h2);
    // Keep atan2 for other quadrants and for zero, NaN or infinite operands (atan(Inf/Inf) is NaN).
    const lam = cx > 0 && Number.isFinite(she) ? atanQ(she, cx) : Math.atan2(she, cx);
    const chi = h > 0 && Number.isFinite(sx) ? atanQ(sx, h) : Math.atan2(sx, h);

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

  // Batch loops over element j of a and b[j + o1], every `step` up to `end`, written to the same places in outA and
  // outB: (0, 1) for separate arrays, (1, 2) interleaved. Each holds a copy of its kernel (see scripts/inline.ts).
  function inverseBatch(
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    outA: Float64Array,
    outB: Float64Array,
    o1: number,
    step: number,
    end: number,
  ): void {
    for (let j = 0; j < end; j += step) {
      // @inline inverse(a[j]!, b[j + o1]!); rx = outA[j]; ry = outB[j + o1]
      {
        const x = a[j]!;
        const y = b[j + o1]!;
        const xi = (y - fn) * invKA;
        const eta = (x - fe) * invKA;

        let s1, c1x;
        if (xi > -1.5707963267948966 && xi < 1.5707963267948966) {
          const hx = 0.5 * xi;
          const z = hx * hx;
          const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
          const cs = 1 - 0.5 * z + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6)))));
          s1 = xi === 0 ? xi : 2 * sn * cs;
          c1x = (cs - sn) * (cs + sn);
        } else {
          s1 = Math.sin(xi);
          c1x = Math.cos(xi);
        }
        let ch1, sh1;
        if (eta > -0.35 && eta < 0.35) {
          const w = eta * eta;
          sh1 =
            eta +
            eta * w * (1 / 6 + w * (1 / 120 + w * (1 / 5040 + w * (1 / 362880 + w * (1 / 39916800 + w * (1 / 6227020800))))));
          ch1 = 1 + w * (1 / 2 + w * (1 / 24 + w * (1 / 720 + w * (1 / 40320 + w * (1 / 3628800 + w * (1 / 479001600))))));
        } else {
          const e = Math.exp(eta);
          const ie = 1 / e;
          ch1 = 0.5 * (e + ie);
          sh1 = 0.5 * (e - ie);
        }
        const s2 = 2 * s1 * c1x;
        const c2x = c1x * c1x - s1 * s1;
        const ch = ch1 * ch1 + sh1 * sh1;
        const sh = 2 * sh1 * ch1;
        const ar = 2 * c2x * ch;
        const ai = -2 * s2 * sh;

        const rho = ar * ar + ai * ai;
        const twiceAr = 2 * ar;
        const u4 = b5 + twiceAr * b6;
        const u3 = bp3 + twiceAr * u4 - rho * b6;
        const u2 = bp2 + twiceAr * u3 - rho * u4;
        const u1 = bp1 + twiceAr * u2 - rho * u3;
        const tr = bp0 + ar * u1 - rho * u2;
        const ti = ai * u1 + 0;

        const sr = s2 * ch;
        const si = c2x * sh;
        const dxi = tr * sr - ti * si;
        const deta = tr * si + ti * sr;

        const dx2 = dxi * dxi;
        const sdx = dxi * (1 + dx2 * (-1 / 6 + dx2 * (1 / 120)));
        const cdx = 1 + dx2 * (-1 / 2 + dx2 * (1 / 24));
        const de2 = deta * deta;
        const shd = deta * (1 + de2 * (1 / 6 + de2 * (1 / 120)));
        const chd = 1 + de2 * (1 / 2 + de2 * (1 / 24));
        const sx = s1 * cdx - c1x * sdx;
        const cx = c1x * cdx + s1 * sdx;
        const she = sh1 * chd - ch1 * shd;

        const h2 = she * she + cx * cx;
        const h = Math.sqrt(h2);
        const lam = cx > 0 && Number.isFinite(she) ? atanQ(she, cx) : Math.atan2(she, cx);
        const chi = h > 0 && Number.isFinite(sx) ? atanQ(sx, h) : Math.atan2(sx, h);

        const sx2 = sx * sx;
        const r2 = sx2 + h2;
        const p = (2 * (h2 - sx2)) / r2;
        const q1 = dp0 + p * (dp1 + p * (dp2 + p * (dp3 + p * (d5 + p * d6))));
        const phi = chi + ((2 * sx * h) / r2) * q1;

        let lon = (lon0 + lam) * R2D;
        if (lon > 180) lon -= 360;
        else if (lon < -180) lon += 360;
        outA[j] = lon;
        outB[j + o1] = phi * R2D;
      }
      // @end
    }
  }

  function forwardBatch(
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    outA: Float64Array,
    outB: Float64Array,
    o1: number,
    step: number,
    end: number,
  ): void {
    for (let j = 0; j < end; j += step) {
      // @inline forward(a[j]!, b[j + o1]!); rx = outA[j]; ry = outB[j + o1]
      {
        let lonDeg = a[j]!;
        const latDeg = b[j + o1]!;
        if (lonDeg > 180 || lonDeg < -180) {
          lonDeg %= 360;
          if (lonDeg > 180) lonDeg -= 360;
          else if (lonDeg < -180) lonDeg += 360;
        }
        const lam = lonDeg * D2R - lon0;

        let sp, cp;
        const alat = Math.abs(latDeg);
        if (alat < 90) {
          const hx = 0.5 * D2R * (alat > 45 ? 90 - alat : latDeg);
          const z = hx * hx;
          const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
          const hz = 0.5 * z;
          const w = 1 - hz;
          const cs = w + (1 - w - hz + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6))))));
          const dsin = 2 * sn * cs;
          const dcos = (cs - sn) * (cs + sn);
          sp = alat > 45 ? (latDeg < 0 ? -dcos : dcos) : latDeg === 0 ? latDeg : dsin;
          cp = alat > 45 ? dsin : dcos;
        } else {
          const phi = latDeg * D2R;
          sp = Math.sin(phi);
          cp = Math.cos(phi);
        }
        const p = 2 - 4 * sp * sp;
        const q1 = cp0 + p * (cp1 + p * (cp2 + p * (cp3 + p * (c5 + p * c6))));
        const dchi = 2 * sp * cp * q1;
        const dd = dchi * dchi;
        const sd = dchi * (1 + dd * (-1 / 6 + dd * (1 / 120)));
        const cd = 1 + dd * (-1 / 2 + dd * (1 / 24));
        const sc = sp * cd + cp * sd;
        const cc = cp * cd - sp * sd;

        let sl, cl;
        if (lam > -0.8 && lam < 0.8) {
          const hx = 0.5 * lam;
          const z = hx * hx;
          const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
          const hz = 0.5 * z;
          const w = 1 - hz;
          const cs = w + (1 - w - hz + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6))))));
          sl = lam === 0 ? lam : 2 * sn * cs;
          cl = (cs - sn) * (cs + sn);
        } else {
          sl = Math.sin(lam);
          cl = Math.cos(lam);
        }
        if (!(cl > 1e-15)) {
          outA[j] = NaN;
          outB[j + o1] = NaN;
          continue;
        }

        const ccl = cc * cl;
        const sc2 = sc * sc;
        const ccl2 = ccl * ccl;
        const ir = 1 / Math.sqrt(sc2 + ccl2);
        const xip = ccl > 0 ? atanQ(sc, ccl) : Math.atan2(sc, ccl);
        const she = cc * sl * ir;
        const z = cc * sl;
        const zz = z * z;
        const etap =
          zz < 0.01
            ? z +
              z *
                zz *
                (1 / 3 +
                  zz * (1 / 5 + zz * (1 / 7 + zz * (1 / 9 + zz * (1 / 11 + zz * (1 / 13 + zz * (1 / 15 + zz * (1 / 17))))))))
            : she > -1024 && she < 1024
              ? Math.log1p(she + (she * she) / (ir + 1))
              : Math.asinh(she);

        const ir2 = ir * ir;
        const s2 = 2 * sc * ccl * ir2;
        const c2x = (ccl2 - sc2) * ir2;
        const ch = ir2 + she * she;
        const sh = 2 * she * ir;
        const ar = 2 * c2x * ch;
        const ai = -2 * s2 * sh;

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

        outA[j] = fe + kA * (etap + tr * si + ti * sr);
        outB[j + o1] = fn + kA * (xip + tr * sr - ti * si);
      }
      // @end
    }
  }

  const converter: Impl<TransverseMercator> = {
    centralMeridian: lon0Deg,
    scaleFactor: k0,
    falseEasting: fe,
    falseNorthing: fn,
    latitudeOfOrigin: 0,
    ellipsoid,
    toLonLat(x, y, lonBuf?, latBuf?) {
      const n = x.length;
      checkSame(n, y.length, 'x and y');
      const lon = output(lonBuf, n, 'lon'),
        lat = output(latBuf, n, 'lat');
      inverseBatch(x, y, lon, lat, 0, 1, n);
      return { lon, lat };
    },
    fromLonLat(lon, lat, xBuf?, yBuf?) {
      const n = lon.length;
      checkSame(n, lat.length, 'lon and lat');
      const x = output(xBuf, n, 'x'),
        y = output(yBuf, n, 'y');
      forwardBatch(lon, lat, x, y, 0, 1, n);
      return { x, y };
    },
    toLonLatInterleaved(xy, outBuf?) {
      const n = xy.length;
      checkEven(n);
      const out = output(outBuf, n, 'out');
      inverseBatch(xy, xy, out, out, 1, 2, n);
      return out;
    },
    fromLonLatInterleaved(lonlat, outBuf?) {
      const n = lonlat.length;
      checkEven(n);
      const out = output(outBuf, n, 'out');
      forwardBatch(lonlat, lonlat, out, out, 1, 2, n);
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
  // Keyed by the method: each converter needs its own toLonLat closure, or the last one registered wins.
  tmInverses.set(converter.toLonLat, {
    lon0Deg,
    lon0,
    fe,
    fn,
    invKA,
    bp0,
    bp1,
    bp2,
    bp3,
    b5,
    b6,
    dp0,
    dp1,
    dp2,
    dp3,
    d5,
    d6,
  });
  return converter;
}
