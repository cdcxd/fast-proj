/**
 * Web Mercator (EPSG:3857): the spherical Mercator on a sphere of radius WGS84.a, applied to WGS84 longitude/latitude.
 *
 * - forward: x = R lambda, y = R asinh(tan phi), equal to R ln tan(pi/4 + phi/2) but accurate near the equator, and
 *   from the colatitude poleward of 45 degrees, accurate near the poles;
 * - inverse: lambda = x / R, phi = atan(sinh(y / R)), the Gudermannian.
 */
import { checkEven, checkOptions, checkSame, output } from './checks.js';
import { checkGeographic, withGeographic } from './geographic.js';
import type { Geographic, Projection } from './types.js';

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
    // Poleward of 45, from the colatitude, which is exact there: phi in radians would lose digits as it nears pi/2.
    const alat = Math.abs(latDeg);
    ry =
      alat <= 45
        ? R * Math.asinh(Math.tan(latDeg * D2R))
        : R * Math.sign(latDeg) * Math.asinh(1 / Math.tan((90 - alat) * D2R));
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
    ry = Math.atan(Math.sinh(y / R)) * R2D;
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
  };
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
      outB[j + o1] = Math.atan(Math.sinh(y / R)) * R2D;
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
      outB[j + o1] =
        alat <= 45
          ? R * Math.asinh(Math.tan(latDeg * D2R))
          : R * Math.sign(latDeg) * Math.asinh(1 / Math.tan((90 - alat) * D2R));
    }
    // @end
  }
}
