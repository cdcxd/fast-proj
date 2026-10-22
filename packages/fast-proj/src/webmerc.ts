/**
 * Web Mercator (EPSG:3857): the spherical Mercator on a sphere of radius WGS84.a, applied to WGS84 longitude/latitude.
 *
 * - forward: x = R lambda, y = R ln tan(pi/4 + phi/2) from sin and cos of phi/2, with log1p near the equator, and from
 *   the colatitude poleward of 45 degrees, accurate near the poles;
 * - inverse: lambda = x / R, phi = atan(sinh(y / R)), the Gudermannian, as 2 atan(tanh(y / 2R)) from an inline exp and
 *   atan (Math.sinh and Math.atan are calls into C++ in V8).
 */
import * as P from './poly.js';
import { checkEven, checkOptions, checkSame, output } from './checks.js';
import { checkGeographic, withGeographic } from './geographic.js';
import type { Geographic, Impl, Projection } from './types.js';

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

export interface WebMercatorOptions {
  /** Geographic system of `toLonLat`/`fromLonLat`. Default WGS84. */
  geographic?: Geographic;
}

const OPTIONS = ['geographic'];
const R = 6378137;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
// Metres per degree of longitude, rounded so that pi R (the double nearest the half-circumference) divides to 180.
const K = (R * Math.PI) / 180;
const LOG2E = Math.LOG2E;
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const TAN_PI_8 = 0.41421356237309503;
const PI_4 = Math.PI / 4;
const PI_2 = Math.PI / 2;
const POW2 = new Float64Array(59).map((_, k) => 2 ** k);
// exp(r) = 1 + r + r^2 E(r), |r| <= ln 2 / 2; atan(u) = u + u^3 A(u^2), |u| <= tan(pi/8) (wasm/src/math.rs)
const KE0 = 5.0e-1,
  KE1 = 1.66666666666666713e-1,
  KE2 = 4.16666666666666713e-2,
  KE3 = 8.33333333332613585e-3,
  KE4 = 1.38888888888837503e-3,
  KE5 = 1.98412698748158344e-4,
  KE6 = 2.48015873255443207e-5,
  KE7 = 2.75572554062850442e-6,
  KE8 = 2.75572736474510872e-7,
  KE9 = 2.5105214474751413e-8,
  KE10 = 2.09146851614180674e-9;
const KA0 = -3.33333333333333315e-1,
  KA1 = 1.99999999999999928e-1,
  KA2 = -1.42857142857115177e-1,
  KA3 = 1.11111111107547289e-1,
  KA4 = -9.09090906700999041e-2,
  KA5 = 7.69230673600017345e-2,
  KA6 = -6.66664202005516626e-2,
  KA7 = 5.88192525319286355e-2,
  KA8 = -5.25804155429777931e-2,
  KA9 = 4.71939503002743316e-2,
  KA10 = -4.10443626575508203e-2,
  KA11 = 3.06357041129694981e-2,
  KA12 = -1.39182292910244292e-2;

/** Web Mercator, EPSG:3857. Latitudes beyond ±85.0511° (the square tile limit) are not clamped. */
export function webMercator(options: WebMercatorOptions = {}): Projection {
  const [p, g] = parseWebMercator(options);
  return withGeographic(p, g);
}

/** Validates the options and builds the JavaScript converter without its geographic step. */
export function parseWebMercator(options: WebMercatorOptions = {}): [Projection, Geographic | undefined] {
  checkOptions(options, 'webMercator', OPTIONS);
  const { geographic } = options;
  checkGeographic(geographic);
  return [sphericalMercator(), geographic];
}

function sphericalMercator(): Projection {
  let rx = 0;
  let ry = 0;

  // @kernel
  function wmForward(lonDeg: number, latDeg: number): void {
    // The poles have no finite y (tan(pi/2) rounds to a finite 1.6e16); infinite longitudes have no x.
    if (!(latDeg < 90 && latDeg > -90 && Math.abs(lonDeg) < Infinity)) {
      rx = NaN;
      ry = NaN;
      return;
    }
    // Whole turns first, exactly, as in tmerc.ts.
    if (lonDeg > 180 || lonDeg < -180) {
      lonDeg %= 360;
      if (lonDeg > 180) lonDeg -= 360;
      else if (lonDeg < -180) lonDeg += 360;
    }
    rx = K * lonDeg;
    // y = R ln tan(pi/4 + phi/2) = R ln((c + s) / (c - s)) for s, c = sin, cos(phi/2): log1p for the accuracy near the
    // equator; poleward of 45, R ln(c' / s') from half the colatitude, which is exact there (phi in radians would lose
    // digits as it nears pi/2).
    const alat = Math.abs(latDeg);
    const hx = 0.5 * D2R * (alat <= 45 ? latDeg : 90 - alat);
    const z = hx * hx;
    const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
    const cs = 1 - 0.5 * z + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6)))));
    // latDeg = 0 keeps its sign.
    ry =
      alat <= 45
        ? latDeg === 0
          ? latDeg
          : R * Math.log1p((2 * sn) / (cs - sn))
        : R * Math.sign(latDeg) * Math.log(cs / sn);
  }

  // @kernel
  function wmInverse(x: number, y: number): void {
    // An infinite y would give ±90; keep infinite input NaN, as in the other projections.
    if (!(Math.abs(x) < Infinity && Math.abs(y) < Infinity)) {
      rx = NaN;
      ry = NaN;
      return;
    }
    let lon = x / K;
    if (lon > 180 || lon < -180) {
      lon %= 360;
      if (lon > 180) lon -= 360;
      else if (lon < -180) lon += 360;
    }
    rx = lon;
    // phi = 2 atan(tanh(v/2)) for v = |y| / R, with tanh(v/2) = m / (m + 2), m = expm1(v): m = 2^k (1 + q) - 1 from
    // q = expm1(r), v = k ln 2 + r, so exact cancellation for k = 0. Beyond v = 40, phi rounds to pi/2.
    let v = Math.abs(y / R);
    if (v > 40) v = 40;
    const k = Math.round(v * LOG2E);
    const r = v - k * LN2_HI - k * LN2_LO;
    const r2 = r * r;
    const qe = KE0 + r2 * (KE2 + r2 * (KE4 + r2 * (KE6 + r2 * (KE8 + r2 * KE10))));
    const qo = KE1 + r2 * (KE3 + r2 * (KE5 + r2 * (KE7 + r2 * KE9)));
    const s = POW2[k]!;
    const m = s * (r + r2 * (qe + r * qo)) + (s - 1);
    // atan(m / (m + 2)), reduced by pi/8 above tan(pi/8).
    let num = m;
    let den = m + 2;
    let g = 0;
    if (m > den * TAN_PI_8) {
      num = m - den * TAN_PI_8;
      den += m * TAN_PI_8;
      g = PI_4;
    }
    const u = num / den;
    const t = u * u;
    const t2 = t * t;
    const ae = KA0 + t2 * (KA2 + t2 * (KA4 + t2 * (KA6 + t2 * (KA8 + t2 * (KA10 + t2 * KA12)))));
    const ao = KA1 + t2 * (KA3 + t2 * (KA5 + t2 * (KA7 + t2 * (KA9 + t2 * KA11))));
    g += 2 * (u + u * t * (ae + t * ao));
    // y = -0 keeps its sign.
    ry = (g < PI_2 ? g : PI_2) * Math.sign(y) * R2D;
  }

  return {
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
      wmInverse(x, y);
      return [rx, ry];
    },
    fromLonLatPoint(lon, lat) {
      wmForward(lon, lat);
      return [rx, ry];
    },
  } satisfies Impl<Projection>;
}

// Batch loops as in tmerc.ts: (o1, step) = (0, 1) for separate arrays, (1, 2) interleaved.
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
    // @inline wmInverse(a[j]!, b[j + o1]!); rx = outA[j]; ry = outB[j + o1]
    {
      const x = a[j]!;
      const y = b[j + o1]!;
      if (!(Math.abs(x) < Infinity && Math.abs(y) < Infinity)) {
        outA[j] = NaN;
        outB[j + o1] = NaN;
        continue;
      }
      let lon = x / K;
      if (lon > 180 || lon < -180) {
        lon %= 360;
        if (lon > 180) lon -= 360;
        else if (lon < -180) lon += 360;
      }
      outA[j] = lon;
      let v = Math.abs(y / R);
      if (v > 40) v = 40;
      const k = Math.round(v * LOG2E);
      const r = v - k * LN2_HI - k * LN2_LO;
      const r2 = r * r;
      const qe = KE0 + r2 * (KE2 + r2 * (KE4 + r2 * (KE6 + r2 * (KE8 + r2 * KE10))));
      const qo = KE1 + r2 * (KE3 + r2 * (KE5 + r2 * (KE7 + r2 * KE9)));
      const s = POW2[k]!;
      const m = s * (r + r2 * (qe + r * qo)) + (s - 1);
      let num = m;
      let den = m + 2;
      let g = 0;
      if (m > den * TAN_PI_8) {
        num = m - den * TAN_PI_8;
        den += m * TAN_PI_8;
        g = PI_4;
      }
      const u = num / den;
      const t = u * u;
      const t2 = t * t;
      const ae = KA0 + t2 * (KA2 + t2 * (KA4 + t2 * (KA6 + t2 * (KA8 + t2 * (KA10 + t2 * KA12)))));
      const ao = KA1 + t2 * (KA3 + t2 * (KA5 + t2 * (KA7 + t2 * (KA9 + t2 * KA11))));
      g += 2 * (u + u * t * (ae + t * ao));
      outB[j + o1] = (g < PI_2 ? g : PI_2) * Math.sign(y) * R2D;
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
    // @inline wmForward(a[j]!, b[j + o1]!); rx = outA[j]; ry = outB[j + o1]
    {
      let lonDeg = a[j]!;
      const latDeg = b[j + o1]!;
      if (!(latDeg < 90 && latDeg > -90 && Math.abs(lonDeg) < Infinity)) {
        outA[j] = NaN;
        outB[j + o1] = NaN;
        continue;
      }
      if (lonDeg > 180 || lonDeg < -180) {
        lonDeg %= 360;
        if (lonDeg > 180) lonDeg -= 360;
        else if (lonDeg < -180) lonDeg += 360;
      }
      outA[j] = K * lonDeg;
      const alat = Math.abs(latDeg);
      const hx = 0.5 * D2R * (alat <= 45 ? latDeg : 90 - alat);
      const z = hx * hx;
      const sn = hx + hx * z * (KS1 + z * (KS2 + z * (KS3 + z * (KS4 + z * (KS5 + z * KS6)))));
      const cs = 1 - 0.5 * z + z * z * (KC1 + z * (KC2 + z * (KC3 + z * (KC4 + z * (KC5 + z * KC6)))));
      outB[j + o1] =
        alat <= 45
          ? latDeg === 0
            ? latDeg
            : R * Math.log1p((2 * sn) / (cs - sn))
          : R * Math.sign(latDeg) * Math.log(cs / sn);
    }
    // @end
  }
}
