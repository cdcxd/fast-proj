//! GCJ-02 constants and the scalar reference kernel (passthrough mode) — a
//! statement-for-statement port of src/gcj02.ts. The scalar kernel only
//! backs the host tests; `vgcj` is the shipped f64x2 twin.

pub(crate) const EE: f64 = 0.006693421622965943;
pub(crate) const KX: f64 = core::f64::consts::PI / 60.0;
pub(crate) const KY: f64 = core::f64::consts::PI / 180.0;
/// Math.sin/cos(35 * KY) as V8 prints them (libm may differ by an ulp).
pub(crate) const S35: f64 = f64::from_bits(0x3FE25ABCF87C4978);
pub(crate) const C35: f64 = f64::from_bits(0x3FEA367E59158747);
pub(crate) const KLAT: f64 = 180.0 / (6378245.0 * (1.0 - EE) * core::f64::consts::PI);
pub(crate) const KLON: f64 = 180.0 / (6378245.0 * core::f64::consts::PI);
pub(crate) const STEPS: usize = 2;
pub(crate) const CUSP: f64 = 1e-4;
pub(crate) const DERIV_CUT: f64 = 1e-10;
pub(crate) const CUSP_STEPS: usize = 6;
// Derivatives of the offset's sine terms, per degree (see src/gcj02.ts).
pub(crate) const JS360: f64 = (40.0 / 3.0) * 360.0 * KX;
pub(crate) const JS120: f64 = (40.0 / 3.0) * 120.0 * KX;
pub(crate) const JS60: f64 = (40.0 / 3.0) * 60.0 * KX;
pub(crate) const JS20: f64 = (80.0 / 3.0) * 20.0 * KX;
pub(crate) const JS5: f64 = 100.0 * 5.0 * KX;
pub(crate) const JS2: f64 = 200.0 * 2.0 * KX;
pub(crate) const JU180: f64 = (40.0 / 3.0) * 180.0 * KY;
pub(crate) const JU60: f64 = (80.0 / 3.0) * 60.0 * KY;
pub(crate) const JU15: f64 = (320.0 / 3.0) * 15.0 * KY;
pub(crate) const JU6: f64 = (640.0 / 3.0) * 6.0 * KY;
pub(crate) const LON_MIN: f64 = 72.004;
pub(crate) const LON_MAX: f64 = 137.8347;
pub(crate) const LAT_MIN: f64 = 0.8293;
pub(crate) const LAT_MAX: f64 = 55.8271;

#[cfg(test)]
pub(crate) mod sgcj {
    use super::*;
    use crate::kernel::reduce_lon;

    /// The offset and the Newton matrix I + J at (x, y): (ox, oy, ja, jb, jc, jd), without the sqrt(|x|) term's
    /// derivative within `cut` of 0.
    #[allow(clippy::too_many_arguments)]
    pub fn offset(x: f64, y: f64, s1: f64, c1: f64, u1: f64, v1: f64, cut: f64) -> (f64, f64, f64, f64, f64, f64) {
        let s2 = 2.0 * s1 * c1;
        let c2 = 1.0 - 2.0 * s1 * s1;
        let s4 = 2.0 * s2 * c2;
        let c4 = 1.0 - 2.0 * s2 * s2;
        let s5 = s4 * c1 + c4 * s1;
        let c5 = c4 * c1 - s4 * s1;
        let s10 = 2.0 * s5 * c5;
        let c10 = 1.0 - 2.0 * s5 * s5;
        let s20 = 2.0 * s10 * c10;
        let c20 = 1.0 - 2.0 * s10 * s10;
        let s60 = s20 * (3.0 - 4.0 * s20 * s20);
        let c60 = c20 * (4.0 * c20 * c20 - 3.0);
        let s120 = 2.0 * s60 * c60;
        let s360 = s120 * (3.0 - 4.0 * s120 * s120);

        let u3 = u1 * (3.0 - 4.0 * u1 * u1);
        let v3 = v1 * (4.0 * v1 * v1 - 3.0);
        let u6 = 2.0 * u3 * v3;
        let v6 = 1.0 - 2.0 * u3 * u3;
        let u12 = 2.0 * u6 * v6;
        let v12 = 1.0 - 2.0 * u6 * u6;
        let u15 = u12 * v3 + v12 * u3;
        let v15 = v12 * v3 - u12 * u3;
        let u30 = 2.0 * u15 * v15;
        let v30 = 1.0 - 2.0 * u15 * u15;
        let u60 = 2.0 * u30 * v30;
        let u180 = u60 * (3.0 - 4.0 * u60 * u60);

        let sp = u1 * C35 + v1 * S35;
        let cp = v1 * C35 - u1 * S35;

        let r = x.abs().sqrt();
        let common = (40.0 / 3.0) * (s360 + s120);
        let dlat = -100.0
            + 2.0 * x
            + 3.0 * y
            + 0.2 * y * y
            + 0.1 * x * y
            + 0.2 * r
            + common
            + (40.0 / 3.0) * u180
            + (80.0 / 3.0) * u60
            + (320.0 / 3.0) * u15
            + (640.0 / 3.0) * u6;
        let dlon = 300.0
            + x
            + 2.0 * y
            + 0.1 * x * x
            + 0.1 * x * y
            + 0.1 * r
            + common
            + (40.0 / 3.0) * s60
            + (80.0 / 3.0) * s20
            + 100.0 * s5
            + 200.0 * s2;
        let m = 1.0 - EE * sp * sp;
        let sm = m.sqrt();
        let ox = (dlon * KLON * sm) / cp;
        let oy = dlat * KLAT * m * sm;
        let c120 = 1.0 - 2.0 * s60 * s60;
        let c360 = c120 * (4.0 * c120 * c120 - 3.0);
        let v60 = 1.0 - 2.0 * u30 * u30;
        let v180 = v60 * (4.0 * v60 * v60 - 3.0);
        let dr = if x.abs() > cut { (if x > 0.0 { 0.05 } else { -0.05 }) / r } else { 0.0 };
        let dcommon = JS360 * c360 + JS120 * c120;
        let dlon_x = 1.0 + 0.2 * x + 0.1 * y + dr + dcommon + JS60 * c60 + JS20 * c20 + JS5 * c5 + JS2 * c2;
        let dlat_x = 2.0 + 0.1 * y + 2.0 * dr + dcommon;
        let dlat_y = 3.0 + 0.4 * y + 0.1 * x + JU180 * v180 + JU60 * v60 + JU15 * v15 + JU6 * v6;
        let flon = (KLON * sm) / cp;
        let flat = KLAT * m * sm;
        let t = (sp / cp) * KY;
        let em = (EE * sp * cp * KY) / m;
        (
            ox,
            oy,
            1.0 + dlon_x * flon,
            (2.0 + 0.1 * x) * flon + ox * (t - em),
            dlat_x * flat,
            1.0 + dlat_y * flat - 3.0 * oy * em,
        )
    }

    fn in_box(lon: f64, lat: f64) -> bool {
        (LON_MIN..=LON_MAX).contains(&lon) && (LAT_MIN..=LAT_MAX).contains(&lat)
    }

    pub fn forward(mut lon: f64, lat: f64) -> (f64, f64) {
        if lon > 180.0 || lon < -180.0 {
            lon = reduce_lon(lon);
        }
        if !in_box(lon, lat) {
            return (lon, lat);
        }
        let x = lon - 105.0;
        let y = lat - 35.0;
        let (ox, oy, ..) = offset(
            x,
            y,
            libm::sin(x * KX),
            libm::cos(x * KX),
            libm::sin(y * KY),
            libm::cos(y * KY),
            CUSP,
        );
        (lon + ox, lat + oy)
    }

    pub fn inverse(mut lon: f64, lat: f64) -> (f64, f64) {
        if lon > 180.0 || lon < -180.0 {
            lon = reduce_lon(lon);
        }
        if !in_box(lon, lat) {
            return (lon, lat);
        }
        let mut s = libm::sin((lon - 105.0) * KX);
        let mut c = libm::cos((lon - 105.0) * KX);
        let mut u = libm::sin((lat - 35.0) * KY);
        let mut v = libm::cos((lat - 35.0) * KY);
        let mut wx = lon;
        let mut wy = lat;
        let mut k = 1;
        loop {
            let cut = if k == 1 { CUSP } else { DERIV_CUT };
            let (ox, oy, ja, jb, jc, jd) = offset(wx - 105.0, wy - 35.0, s, c, u, v, cut);
            let gx = lon - ox - wx;
            let gy = lat - oy - wy;
            let idet = 1.0 / (ja * jd - jb * jc);
            let dx = (jd * gx - jb * gy) * idet;
            let dy = (ja * gy - jc * gx) * idet;
            wx += dx;
            wy += dy;
            // Negated, as in the TS kernel, so a NaN iterate stops too.
            #[allow(clippy::neg_cmp_op_on_partial_ord)]
            let stop = k >= STEPS && (k == CUSP_STEPS || !((wx - 105.0).abs() < CUSP));
            if stop {
                break;
            }
            let d = dx * KX;
            let e = dy * KY;
            let d2 = d * d;
            let e2 = e * e;
            let sd = d * (1.0 - d2 / 6.0);
            let cd = 1.0 - d2 * (0.5 - d2 / 24.0);
            let se = e * (1.0 - e2 / 6.0);
            let ce = 1.0 - e2 * (0.5 - e2 / 24.0);
            (s, c) = (s * cd + c * sd, c * cd - s * sd);
            (u, v) = (u * ce + v * se, v * ce - u * se);
            k += 1;
        }
        (wx, wy)
    }
}
