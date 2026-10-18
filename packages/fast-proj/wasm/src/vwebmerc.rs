//! f64x2 Web Mercator (EPSG:3857) kernel — the vector twin of src/webmerc.ts.
//!
//! - forward: y = R asinh(tan phi) as log1p(tan phi + sec phi - 1), from one sincos of the latitude, or of the
//!   colatitude poleward of 45 degrees (exact there; the TS kernel does the same);
//! - inverse: phi = atan(sinh(y / R)), sinh from a Taylor series below |y / R| = 1/4 and from exp above, clamped at
//!   |y / R| = 40, where atan already rounds to pi/2.

use crate::kernel::{reduce_lon, D2R, R2D};
use core::arch::wasm32::{
    f64x2, f64x2_abs, f64x2_add, f64x2_div, f64x2_extract_lane, f64x2_gt, f64x2_lt, f64x2_mul, f64x2_pmin,
    f64x2_splat, f64x2_sub, i64x2_splat, v128, v128_and, v128_any_true, v128_bitselect, v128_or,
};

use crate::simd::{load_pair, store_pair, vatan_q, vexp_eo, vlog1p_eo, vsincos_eo};

/// The WGS84 semi-major axis, the sphere's radius.
pub const R: f64 = 6378137.0;
/// Metres per degree of longitude, rounded as in the TS kernel so that pi R divides to exactly 180.
const K: f64 = R * core::f64::consts::PI / 180.0;

#[inline]
fn spl(x: f64) -> v128 {
    f64x2_splat(x)
}

#[inline]
fn finite(x: v128) -> v128 {
    f64x2_lt(f64x2_abs(x), spl(f64::INFINITY))
}

/// `m` with the sign bit of `s`.
#[inline]
fn copysign(m: v128, s: v128) -> v128 {
    v128_bitselect(s, m, i64x2_splat(i64::MIN))
}

/// Rare: whole turns are removed per lane by the scalar reduction, so both kernels agree.
#[inline]
fn reduce(lon: v128) -> v128 {
    let out = v128_or(f64x2_gt(lon, spl(180.0)), f64x2_lt(lon, spl(-180.0)));
    if !v128_any_true(out) {
        return lon;
    }
    let r = |l: f64| if l > 180.0 || l < -180.0 { reduce_lon(l) } else { l };
    f64x2(r(f64x2_extract_lane::<0>(lon)), r(f64x2_extract_lane::<1>(lon)))
}

pub fn forward2(lon: v128, lat: v128) -> (v128, v128) {
    let alat = f64x2_abs(lat);
    // The poles have no finite y; NaN latitudes fail the comparison too.
    let ok = v128_and(f64x2_lt(alat, spl(90.0)), finite(lon));
    let x = f64x2_mul(reduce(lon), spl(K));

    let polar = f64x2_gt(alat, spl(45.0));
    let ang = v128_bitselect(f64x2_sub(spl(90.0), alat), alat, polar);
    let (s, c) = vsincos_eo(f64x2_mul(ang, spl(D2R)));
    // asinh(tan phi) = log1p(u), u = tan phi + sec phi - 1, as one quotient of positive terms: s (1 + c + s) /
    // (c (1 + c)) from the latitude, (1 + c - s) / s from the colatitude.
    let n_eq = f64x2_mul(s, f64x2_add(f64x2_add(spl(1.0), c), s));
    let d_eq = f64x2_mul(c, f64x2_add(spl(1.0), c));
    let n_po = f64x2_sub(f64x2_add(spl(1.0), c), s);
    let u = f64x2_div(v128_bitselect(n_po, n_eq, polar), v128_bitselect(s, d_eq, polar));
    let y = f64x2_mul(copysign(vlog1p_eo(u), lat), spl(R));

    let nan = spl(f64::NAN);
    (v128_bitselect(x, nan, ok), v128_bitselect(y, nan, ok))
}

pub fn inverse2(x: v128, y: v128) -> (v128, v128) {
    let ok = v128_and(finite(x), finite(y));
    let lon = reduce(f64x2_div(x, spl(K)));

    let v = f64x2_pmin(f64x2_abs(f64x2_div(y, spl(R))), spl(40.0));
    let small = f64x2_lt(v, spl(0.25));
    let (v0, v1) = (f64x2_extract_lane::<0>(v), f64x2_extract_lane::<1>(v));
    // atan(n / d) = atan(sinh v): n = sinh v, d = 1 from the series, or n = e^2 - 1, d = 2e from e = exp(v).
    let (mut n, mut d) = (spl(0.0), spl(1.0));
    if v0 < 0.25 || v1 < 0.25 {
        // sinh v = v (1 + v^2/3! + ... + v^10/11!); the next term is below 1e-17 relative at v = 1/4.
        let v2 = f64x2_mul(v, v);
        let mut p = spl(1.0 / 39916800.0);
        for k in [362880.0, 5040.0, 120.0, 6.0] {
            p = f64x2_add(spl(1.0 / k), f64x2_mul(v2, p));
        }
        n = f64x2_add(v, f64x2_mul(f64x2_mul(v, v2), p));
    }
    if !(v0 < 0.25 && v1 < 0.25) {
        let e = vexp_eo(v);
        n = v128_bitselect(n, f64x2_sub(f64x2_mul(e, e), spl(1.0)), small);
        d = v128_bitselect(d, f64x2_add(e, e), small);
    }
    let lat = f64x2_mul(copysign(vatan_q(n, d), y), spl(R2D));

    let nan = spl(f64::NAN);
    (v128_bitselect(lon, nan, ok), v128_bitselect(lat, nan, ok))
}

pub fn forward_batch(lon: &[f64], lat: &[f64], x: &mut [f64], y: &mut [f64]) {
    let mut i = 0;
    while i < lon.len() {
        let (a, b) = forward2(load_pair(lon, i), load_pair(lat, i));
        store_pair(a, x, i);
        store_pair(b, y, i);
        i += 2;
    }
}

pub fn inverse_batch(x: &[f64], y: &[f64], lon: &mut [f64], lat: &mut [f64]) {
    let mut i = 0;
    while i < x.len() {
        let (a, b) = inverse2(load_pair(x, i), load_pair(y, i));
        store_pair(a, lon, i);
        store_pair(b, lat, i);
        i += 2;
    }
}
