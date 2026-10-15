/**
 * GCJ-02 ("Mars coordinates"), the obfuscated datum required for maps of China: the published WGS84 -> GCJ-02 offset
 * formula on the Krasovsky ellipsoid, as in gcoord and coordtransform.
 *
 * The 11 sines of the formula come from two sin/cos pairs, sin(x pi/60) and sin(y pi/180), by multiple-angle
 * identities. The inverse has no closed form; four fixed-point steps w = g - offset(w) converge to ~1e-11 degrees, and
 * after the first step the two pairs are rotated by the step rather than recomputed.
 */
import { checkEven, checkOut } from './checks.js';
import type { GeographicTransform } from './types.js';

export interface Gcj02Options {
  /**
   * Points outside the China bounding box (longitude 72.004 to 137.8347, latitude 0.8293 to 55.8271): `'passthrough'`
   * (default) returns them unchanged, `'transform'` applies the offset everywhere.
   */
  outsideChina?: 'passthrough' | 'transform';
}

const A = 6378245;
const EE = 0.006693421622965943;
const KX = Math.PI / 60;
const KY = Math.PI / 180;
const S35 = Math.sin(35 * KY);
const C35 = Math.cos(35 * KY);
const KLAT = 180 / (A * (1 - EE) * Math.PI);
const KLON = 180 / (A * Math.PI);
const STEPS = 4;

function reduce(lon: number): number {
  lon %= 360;
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

function wrap(lon: number): number {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

export function gcj02({ outsideChina = 'passthrough' }: Gcj02Options = {}): GeographicTransform {
  if (outsideChina !== 'passthrough' && outsideChina !== 'transform') {
    throw new RangeError(`outsideChina must be 'passthrough' or 'transform', got ${String(outsideChina)}`);
  }
  const all = outsideChina === 'transform';

  let ox = 0;
  let oy = 0;
  let rx = 0;
  let ry = 0;

  // x = lon - 105, y = lat - 35; s1, c1 = sin, cos(x pi/60); u1, v1 = sin, cos(y pi/180).
  function offset(x: number, y: number, s1: number, c1: number, u1: number, v1: number): void {
    const s2 = 2 * s1 * c1;
    const c2 = 1 - 2 * s1 * s1;
    const s4 = 2 * s2 * c2;
    const c4 = 1 - 2 * s2 * s2;
    const s5 = s4 * c1 + c4 * s1;
    const c5 = c4 * c1 - s4 * s1;
    const s10 = 2 * s5 * c5;
    const c10 = 1 - 2 * s5 * s5;
    const s20 = 2 * s10 * c10;
    const c20 = 1 - 2 * s10 * s10;
    const s60 = s20 * (3 - 4 * s20 * s20);
    const c60 = c20 * (4 * c20 * c20 - 3);
    const s120 = 2 * s60 * c60;
    const s360 = s120 * (3 - 4 * s120 * s120);

    const u3 = u1 * (3 - 4 * u1 * u1);
    const v3 = v1 * (4 * v1 * v1 - 3);
    const u6 = 2 * u3 * v3;
    const v6 = 1 - 2 * u3 * u3;
    const u12 = 2 * u6 * v6;
    const v12 = 1 - 2 * u6 * u6;
    const u15 = u12 * v3 + v12 * u3;
    const v15 = v12 * v3 - u12 * u3;
    const u30 = 2 * u15 * v15;
    const v30 = 1 - 2 * u15 * u15;
    const u60 = 2 * u30 * v30;
    const u180 = u60 * (3 - 4 * u60 * u60);

    // sin/cos of the latitude itself, by angle addition from y = lat - 35.
    const sp = u1 * C35 + v1 * S35;
    const cp = v1 * C35 - u1 * S35;

    const r = Math.sqrt(Math.abs(x));
    const common = (40 / 3) * (s360 + s120);
    const dLat =
      -100 +
      2 * x +
      3 * y +
      0.2 * y * y +
      0.1 * x * y +
      0.2 * r +
      common +
      (40 / 3) * u180 +
      (80 / 3) * u60 +
      (320 / 3) * u15 +
      (640 / 3) * u6;
    const dLon =
      300 +
      x +
      2 * y +
      0.1 * x * x +
      0.1 * x * y +
      0.1 * r +
      common +
      (40 / 3) * s60 +
      (80 / 3) * s20 +
      100 * s5 +
      200 * s2;
    const m = 1 - EE * sp * sp;
    const sm = Math.sqrt(m);
    ox = (dLon * KLON * sm) / cp;
    oy = dLat * KLAT * m * sm;
  }

  function inDomain(lon: number, lat: number): boolean {
    return all ? lat > -90 && lat < 90 : lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
  }

  function fromWgs84(lon: number, lat: number): void {
    if (lon > 180 || lon < -180) lon = reduce(lon);
    if (!inDomain(lon, lat)) {
      rx = all ? NaN : lon;
      ry = all ? NaN : lat;
      return;
    }
    const x = lon - 105;
    const y = lat - 35;
    offset(x, y, Math.sin(x * KX), Math.cos(x * KX), Math.sin(y * KY), Math.cos(y * KY));
    rx = wrap(lon + ox);
    ry = lat + oy;
  }

  function toWgs84(lon: number, lat: number): void {
    if (lon > 180 || lon < -180) lon = reduce(lon);
    if (!inDomain(lon, lat)) {
      rx = all ? NaN : lon;
      ry = all ? NaN : lat;
      return;
    }
    let s = Math.sin((lon - 105) * KX);
    let c = Math.cos((lon - 105) * KX);
    let u = Math.sin((lat - 35) * KY);
    let v = Math.cos((lat - 35) * KY);
    let wx = lon;
    let wy = lat;
    offset(wx - 105, wy - 35, s, c, u, v);
    for (let k = 1; k < STEPS; k++) {
      const nx = lon - ox;
      const ny = lat - oy;
      // Rotate the sines by the step instead of recomputing them; inside the China box a step is below 6e-4 rad.
      const d = (nx - wx) * KX;
      const e = (ny - wy) * KY;
      if (all && !(Math.abs(d) < 1e-3 && Math.abs(e) < 1e-3)) {
        s = Math.sin((nx - 105) * KX);
        c = Math.cos((nx - 105) * KX);
        u = Math.sin((ny - 35) * KY);
        v = Math.cos((ny - 35) * KY);
      } else {
        const d2 = d * d;
        const e2 = e * e;
        const sd = d * (1 - d2 / 6);
        const cd = 1 - d2 * (0.5 - d2 / 24);
        const se = e * (1 - e2 / 6);
        const ce = 1 - e2 * (0.5 - e2 / 24);
        const s0 = s;
        const u0 = u;
        s = s0 * cd + c * sd;
        c = c * cd - s0 * sd;
        u = u0 * ce + v * se;
        v = v * ce - u0 * se;
      }
      wx = nx;
      wy = ny;
      offset(wx - 105, wy - 35, s, c, u, v);
    }
    rx = wrap(lon - ox);
    ry = lat - oy;
  }

  return {
    toWgs84(lon, lat, outLon, outLat) {
      const n = lon.length;
      if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
      if (outLon) checkOut(outLon, n, 'outLon');
      else outLon = new Float64Array(n);
      if (outLat) checkOut(outLat, n, 'outLat');
      else outLat = new Float64Array(n);
      const res = { lon: outLon, lat: outLat };
      for (let i = 0; i < n; i++) {
        toWgs84(lon[i]!, lat[i]!);
        outLon[i] = rx;
        outLat[i] = ry;
      }
      return res;
    },
    fromWgs84(lon, lat, outLon, outLat) {
      const n = lon.length;
      if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
      if (outLon) checkOut(outLon, n, 'outLon');
      else outLon = new Float64Array(n);
      if (outLat) checkOut(outLat, n, 'outLat');
      else outLat = new Float64Array(n);
      const res = { lon: outLon, lat: outLat };
      for (let i = 0; i < n; i++) {
        fromWgs84(lon[i]!, lat[i]!);
        outLon[i] = rx;
        outLat[i] = ry;
      }
      return res;
    },
    toWgs84Interleaved(lonlat, out) {
      const n = lonlat.length;
      checkEven(n);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        toWgs84(lonlat[i]!, lonlat[i + 1]!);
        out[i] = rx;
        out[i + 1] = ry;
      }
      return out;
    },
    fromWgs84Interleaved(lonlat, out) {
      const n = lonlat.length;
      checkEven(n);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        fromWgs84(lonlat[i]!, lonlat[i + 1]!);
        out[i] = rx;
        out[i + 1] = ry;
      }
      return out;
    },
    toWgs84Point(lon, lat) {
      toWgs84(lon, lat);
      return [rx, ry];
    },
    fromWgs84Point(lon, lat) {
      fromWgs84(lon, lat);
      return [rx, ry];
    },
  };
}
