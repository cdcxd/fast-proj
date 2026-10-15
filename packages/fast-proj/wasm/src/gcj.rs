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
pub(crate) const STEPS: usize = 4;
pub(crate) const CUSP: f64 = 1e-4;
pub(crate) const CUSP_STEPS: usize = 6;
pub(crate) const LON_MIN: f64 = 72.004;
pub(crate) const LON_MAX: f64 = 137.8347;
pub(crate) const LAT_MIN: f64 = 0.8293;
pub(crate) const LAT_MAX: f64 = 55.8271;

#[cfg(test)]
pub(crate) mod sgcj {
    use super::*;
    use crate::kernel::reduce_lon;

    pub fn offset(x: f64, y: f64, s1: f64, c1: f64, u1: f64, v1: f64) -> (f64, f64) {
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
        ((dlon * KLON * sm) / cp, dlat * KLAT * m * sm)
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
        let (ox, oy) = offset(
            x,
            y,
            libm::sin(x * KX),
            libm::cos(x * KX),
            libm::sin(y * KY),
            libm::cos(y * KY),
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
        let (mut ox, mut oy) = offset(wx - 105.0, wy - 35.0, s, c, u, v);
        let mut k = 1;
        while k < STEPS || (k < CUSP_STEPS && (wx - 105.0).abs() < CUSP) {
            let nx = lon - ox;
            let ny = lat - oy;
            let d = (nx - wx) * KX;
            let e = (ny - wy) * KY;
            let d2 = d * d;
            let e2 = e * e;
            let sd = d * (1.0 - d2 / 6.0);
            let cd = 1.0 - d2 * (0.5 - d2 / 24.0);
            let se = e * (1.0 - e2 / 6.0);
            let ce = 1.0 - e2 * (0.5 - e2 / 24.0);
            (s, c) = (s * cd + c * sd, c * cd - s * sd);
            (u, v) = (u * ce + v * se, v * ce - u * se);
            wx = nx;
            wy = ny;
            (ox, oy) = offset(wx - 105.0, wy - 35.0, s, c, u, v);
            k += 1;
        }
        (lon - ox, lat - oy)
    }
}
