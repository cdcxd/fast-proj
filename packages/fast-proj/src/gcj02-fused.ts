/**
 * x/y on a JavaScript transverse Mercator -> GCJ-02 in one pass: tmerc's inverse fused with GCJ-02's fromWgs84, copied
 * in from both by scripts/inline.ts. gcj02.ts registers the builder for its converters.
 */
import * as P from './poly.js';
import * as K from './gcj02-constants.js';
import type { FusedInverse, TmInverse } from './geographic.js';

// Bound here, not imported, as in gcj02.ts.
const atanQ = P.atanQ;
const C35 = K.C35;
const KX = K.KX;
const LAT_MAX = K.LAT_MAX;
const LAT_MIN = K.LAT_MIN;
const LON_MAX = K.LON_MAX;
const LON_MIN = K.LON_MIN;
const reduce = K.reduce;
const S35 = K.S35;

/** The fused builder for one mode of GCJ-02. */
export function fuser(mode: 'passthrough' | 'transform'): (t: TmInverse) => FusedInverse {
  const all = mode === 'transform';

  let rx = 0;
  let ry = 0;

  function inDomain(lon: number, lat: number): boolean {
    return all ? lat > -90 && lat < 90 : lon >= LON_MIN && lon <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
  }

  // x/y on a JavaScript transverse Mercator -> this system, its inverse fused with fromWgs84. The offset's sin/cos pairs
  // come from the inverse's conformal latitude and longitude by angle addition, saving four of its six calls; results
  // match the two passes within a few ulp.
  function fuse(t: TmInverse): FusedInverse {
    const { lon0Deg, lon0, fe, fn, invKA, bp0, bp1, bp2, bp3, b5, b6, dp0, dp1, dp2, dp3, d5, d6 } = t;
    // (lon - 105) pi/60 is three times the longitude from the central meridian, plus this.
    const S3 = Math.sin((lon0Deg - 105) * KX);
    const C3 = Math.cos((lon0Deg - 105) * KX);

    // @kernel
    function tmToGcj(x: number, y: number): void {
      let wl = 0;
      let wp = 0;
      let offLon = 0;
      let offLat = 0;
      // @inline inverse(x, y); rx = wl; ry = wp; scope = open
      const xi = (y - fn) * invKA;
      const eta = (x - fe) * invKA;

      let s1, c1x;
      if (xi > -1.5707963267948966 && xi < 1.5707963267948966) {
        const hx = 0.5 * xi;
        const z = hx * hx;
        const sn =
          hx +
          hx *
            z *
            (-0.16666666666666632 +
              z *
                (0.00833333333332249 +
                  z *
                    (-0.0001984126982985795 +
                      z * (0.0000027557313707070068 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))));
        const cs =
          1 -
          0.5 * z +
          z *
            z *
            (0.0416666666666666 +
              z *
                (-0.001388888888887411 +
                  z *
                    (0.00002480158728947673 +
                      z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
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
          eta *
            w *
            (1 / 6 + w * (1 / 120 + w * (1 / 5040 + w * (1 / 362880 + w * (1 / 39916800 + w * (1 / 6227020800))))));
        ch1 =
          1 + w * (1 / 2 + w * (1 / 24 + w * (1 / 720 + w * (1 / 40320 + w * (1 / 3628800 + w * (1 / 479001600))))));
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

      let lon = (lon0 + lam) * 57.29577951308232;
      if (lon > 180) lon -= 360;
      else if (lon < -180) lon += 360;
      wl = lon;
      wp = phi * 57.29577951308232;
      // @end
      if (!inDomain(wl, wp)) {
        rx = all ? NaN : wl;
        ry = all ? NaN : wp;
        return;
      }
      if (wl === -180) wl = 180;
      // sin, cos of the latitude: the conformal latitude chi plus phi - chi, below 0.01 rad.
      const ir = 1 / Math.sqrt(r2);
      const sChi = sx * ir;
      const cChi = h * ir;
      const dc = phi - chi;
      const dc2 = dc * dc;
      const sdc = dc * (1 + dc2 * (-1 / 6 + dc2 * (1 / 120)));
      const cdc = 1 + dc2 * (-1 / 2 + dc2 * (1 / 24));
      const sPhi = sChi * cdc + cChi * sdc;
      const cPhi = cChi * cdc - sChi * sdc;
      // sin, cos of lat - 35 and of 3 lam + (lon0 - 105) pi/60 (lam = atan(she / cx)).
      const gu = sPhi * C35 - cPhi * S35;
      const gv = cPhi * C35 + sPhi * S35;
      const ih = 1 / h;
      const sl = she * ih;
      const cl = cx * ih;
      const s3 = sl * (3 - 4 * sl * sl);
      const c3 = cl * (4 * cl * cl - 3);
      const gs = s3 * C3 + c3 * S3;
      const gc = c3 * C3 - s3 * S3;
      const gx = wl - 105;
      const gy = wp - 35;
      // @inline offset(gx, gy, gs, gc, gu, gv); ox = offLon; oy = offLat; x = gx; y = gy; s1 = gs; c1 = gc; u1 = gu; v1 = gv; s2 = gs2; u3 = gu3
      {
        const gs2 = 2 * gs * gc;
        const c2 = 1 - 2 * gs * gs;
        const s4 = 2 * gs2 * c2;
        const c4 = 1 - 2 * gs2 * gs2;
        const s5 = s4 * gc + c4 * gs;
        const c5 = c4 * gc - s4 * gs;
        const s10 = 2 * s5 * c5;
        const c10 = 1 - 2 * s5 * s5;
        const s20 = 2 * s10 * c10;
        const c20 = 1 - 2 * s10 * s10;
        const s60 = s20 * (3 - 4 * s20 * s20);
        const c60 = c20 * (4 * c20 * c20 - 3);
        const s120 = 2 * s60 * c60;
        const s360 = s120 * (3 - 4 * s120 * s120);

        const gu3 = gu * (3 - 4 * gu * gu);
        const v3 = gv * (4 * gv * gv - 3);
        const u6 = 2 * gu3 * v3;
        const v6 = 1 - 2 * gu3 * gu3;
        const u12 = 2 * u6 * v6;
        const v12 = 1 - 2 * u6 * u6;
        const u15 = u12 * v3 + v12 * gu3;
        const v15 = v12 * v3 - u12 * gu3;
        const u30 = 2 * u15 * v15;
        const v30 = 1 - 2 * u15 * u15;
        const u60 = 2 * u30 * v30;
        const u180 = u60 * (3 - 4 * u60 * u60);

        const sp = gu * 0.8191520442889918 + gv * 0.573576436351046;
        const cp = gv * 0.8191520442889918 - gu * 0.573576436351046;

        const r = Math.sqrt(Math.abs(gx));
        const common = (40 / 3) * (s360 + s120);
        const dLat =
          -100 +
          2 * gx +
          3 * gy +
          0.2 * gy * gy +
          0.1 * gx * gy +
          0.2 * r +
          common +
          (40 / 3) * u180 +
          (80 / 3) * u60 +
          (320 / 3) * u15 +
          (640 / 3) * u6;
        const dLon =
          300 +
          gx +
          2 * gy +
          0.1 * gx * gx +
          0.1 * gx * gy +
          0.1 * r +
          common +
          (40 / 3) * s60 +
          (80 / 3) * s20 +
          100 * s5 +
          200 * gs2;
        const m = 1 - 0.006693421622965943 * sp * sp;
        const sm = Math.sqrt(m);
        const qcm = 1 / (cp * m);
        const icp = m * qcm;
        const fLon = 0.000008983000733443498 * sm * icp;
        offLon = dLon * fLon;
        offLat = dLat * 0.000009043532912185927 * m * sm;
      }
      // @end
      if (!all) {
        rx = wl + offLon;
        ry = wp + offLat;
        return;
      }
      const shifted = wp + offLat;
      if (Math.abs(shifted) <= 90) {
        rx = reduce(wl + offLon);
        ry = shifted;
      } else {
        rx = NaN;
        ry = NaN;
      }
    }

    return {
      batch(a, b, outA, outB, o1, step, end) {
        for (let j = 0; j < end; j += step) {
          // @inline tmToGcj(a[j]!, b[j + o1]!); rx = outA[j]; ry = outB[j + o1]
          {
            const x = a[j]!;
            const y = b[j + o1]!;
            let wl = 0;
            let wp = 0;
            let offLon = 0;
            let offLat = 0;
            const xi = (y - fn) * invKA;
            const eta = (x - fe) * invKA;

            let s1, c1x;
            if (xi > -1.5707963267948966 && xi < 1.5707963267948966) {
              const hx = 0.5 * xi;
              const z = hx * hx;
              const sn =
                hx +
                hx *
                  z *
                  (-0.16666666666666632 +
                    z *
                      (0.00833333333332249 +
                        z *
                          (-0.0001984126982985795 +
                            z * (0.0000027557313707070068 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))));
              const cs =
                1 -
                0.5 * z +
                z *
                  z *
                  (0.0416666666666666 +
                    z *
                      (-0.001388888888887411 +
                        z *
                          (0.00002480158728947673 +
                            z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
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
                eta *
                  w *
                  (1 / 6 +
                    w * (1 / 120 + w * (1 / 5040 + w * (1 / 362880 + w * (1 / 39916800 + w * (1 / 6227020800))))));
              ch1 =
                1 +
                w * (1 / 2 + w * (1 / 24 + w * (1 / 720 + w * (1 / 40320 + w * (1 / 3628800 + w * (1 / 479001600))))));
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

            let lon = (lon0 + lam) * 57.29577951308232;
            if (lon > 180) lon -= 360;
            else if (lon < -180) lon += 360;
            wl = lon;
            wp = phi * 57.29577951308232;
            if (!inDomain(wl, wp)) {
              outA[j] = all ? NaN : wl;
              outB[j + o1] = all ? NaN : wp;
              continue;
            }
            if (wl === -180) wl = 180;
            const ir = 1 / Math.sqrt(r2);
            const sChi = sx * ir;
            const cChi = h * ir;
            const dc = phi - chi;
            const dc2 = dc * dc;
            const sdc = dc * (1 + dc2 * (-1 / 6 + dc2 * (1 / 120)));
            const cdc = 1 + dc2 * (-1 / 2 + dc2 * (1 / 24));
            const sPhi = sChi * cdc + cChi * sdc;
            const cPhi = cChi * cdc - sChi * sdc;
            const gu = sPhi * 0.8191520442889918 - cPhi * 0.573576436351046;
            const gv = cPhi * 0.8191520442889918 + sPhi * 0.573576436351046;
            const ih = 1 / h;
            const sl = she * ih;
            const cl = cx * ih;
            const s3 = sl * (3 - 4 * sl * sl);
            const c3 = cl * (4 * cl * cl - 3);
            const gs = s3 * C3 + c3 * S3;
            const gc = c3 * C3 - s3 * S3;
            const gx = wl - 105;
            const gy = wp - 35;
            {
              const gs2 = 2 * gs * gc;
              const c2 = 1 - 2 * gs * gs;
              const s4 = 2 * gs2 * c2;
              const c4 = 1 - 2 * gs2 * gs2;
              const s5 = s4 * gc + c4 * gs;
              const c5 = c4 * gc - s4 * gs;
              const s10 = 2 * s5 * c5;
              const c10 = 1 - 2 * s5 * s5;
              const s20 = 2 * s10 * c10;
              const c20 = 1 - 2 * s10 * s10;
              const s60 = s20 * (3 - 4 * s20 * s20);
              const c60 = c20 * (4 * c20 * c20 - 3);
              const s120 = 2 * s60 * c60;
              const s360 = s120 * (3 - 4 * s120 * s120);

              const gu3 = gu * (3 - 4 * gu * gu);
              const v3 = gv * (4 * gv * gv - 3);
              const u6 = 2 * gu3 * v3;
              const v6 = 1 - 2 * gu3 * gu3;
              const u12 = 2 * u6 * v6;
              const v12 = 1 - 2 * u6 * u6;
              const u15 = u12 * v3 + v12 * gu3;
              const v15 = v12 * v3 - u12 * gu3;
              const u30 = 2 * u15 * v15;
              const v30 = 1 - 2 * u15 * u15;
              const u60 = 2 * u30 * v30;
              const u180 = u60 * (3 - 4 * u60 * u60);

              const sp = gu * 0.8191520442889918 + gv * 0.573576436351046;
              const cp = gv * 0.8191520442889918 - gu * 0.573576436351046;

              const r = Math.sqrt(Math.abs(gx));
              const common = (40 / 3) * (s360 + s120);
              const dLat =
                -100 +
                2 * gx +
                3 * gy +
                0.2 * gy * gy +
                0.1 * gx * gy +
                0.2 * r +
                common +
                (40 / 3) * u180 +
                (80 / 3) * u60 +
                (320 / 3) * u15 +
                (640 / 3) * u6;
              const dLon =
                300 +
                gx +
                2 * gy +
                0.1 * gx * gx +
                0.1 * gx * gy +
                0.1 * r +
                common +
                (40 / 3) * s60 +
                (80 / 3) * s20 +
                100 * s5 +
                200 * gs2;
              const m = 1 - 0.006693421622965943 * sp * sp;
              const sm = Math.sqrt(m);
              const qcm = 1 / (cp * m);
              const icp = m * qcm;
              const fLon = 0.000008983000733443498 * sm * icp;
              offLon = dLon * fLon;
              offLat = dLat * 0.000009043532912185927 * m * sm;
            }
            if (!all) {
              outA[j] = wl + offLon;
              outB[j + o1] = wp + offLat;
              continue;
            }
            const shifted = wp + offLat;
            if (Math.abs(shifted) <= 90) {
              outA[j] = reduce(wl + offLon);
              outB[j + o1] = shifted;
            } else {
              outA[j] = NaN;
              outB[j + o1] = NaN;
            }
          }
          // @end
        }
      },
      point(x, y) {
        tmToGcj(x, y);
        return [rx, ry];
      },
    };
  }

  return fuse;
}
