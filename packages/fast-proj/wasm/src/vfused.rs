//! f64x2 transverse Mercator inverse fused with GCJ-02's passthrough forward — the vector twin of the fused kernel
//! in src/gcj02-fused.ts. The offset's sin/cos pairs come from the inverse's conformal latitude and longitude by
//! angle addition, saving both `vsincos` calls of `vgcj::forward_batch`.

use crate::gcj::*;
use crate::kernel::K;
use crate::simd::{load_pair, store_pair};
use crate::vkernel::{inverse_parts, splat_k};
use core::arch::wasm32::{
    f64x2_abs, f64x2_add, f64x2_div, f64x2_ge, f64x2_le, f64x2_mul, f64x2_splat, f64x2_sqrt, f64x2_sub, v128, v128_and,
    v128_any_true, v128_bitselect,
};

#[inline]
fn spl(x: f64) -> v128 {
    f64x2_splat(x)
}

#[inline]
fn add(a: v128, b: v128) -> v128 {
    f64x2_add(a, b)
}

#[inline]
fn sub(a: v128, b: v128) -> v128 {
    f64x2_sub(a, b)
}

#[inline]
fn mul(a: v128, b: v128) -> v128 {
    f64x2_mul(a, b)
}

#[inline]
fn dbl(a: v128, b: v128) -> v128 {
    mul(spl(2.0), mul(a, b))
}

#[inline]
fn one_m2(a: v128) -> v128 {
    sub(spl(1.0), mul(spl(2.0), mul(a, a)))
}

#[inline]
fn triple_s(a: v128) -> v128 {
    mul(a, sub(spl(3.0), mul(add(a, a), add(a, a))))
}

#[inline]
fn triple_c(a: v128) -> v128 {
    mul(a, sub(mul(add(a, a), add(a, a)), spl(3.0)))
}

/// `lon0_deg` is the central meridian in degrees, as passed to `make_k_tm`.
pub fn tm_gcj_batch(x: &[f64], y: &[f64], olon: &mut [f64], olat: &mut [f64], k: &K, lon0_deg: f64) {
    let q = splat_k(k);
    // (lon - 105) pi/60 is three times the longitude from the central meridian, plus this.
    let s3k = spl(libm::sin((lon0_deg - 105.0) * KX));
    let c3k = spl(libm::cos((lon0_deg - 105.0) * KX));
    let mut i = 0;
    while i < x.len() {
        let t = inverse_parts(load_pair(x, i), load_pair(y, i), &q);
        let (l, p) = (t.lon, t.lat);
        let inbox = v128_and(
            v128_and(f64x2_ge(l, spl(LON_MIN)), f64x2_le(l, spl(LON_MAX))),
            v128_and(f64x2_ge(p, spl(LAT_MIN)), f64x2_le(p, spl(LAT_MAX))),
        );
        if !v128_any_true(inbox) {
            store_pair(l, olon, i);
            store_pair(p, olat, i);
            i += 2;
            continue;
        }
        // sin, cos of 3 lam + (lon0 - 105) pi/60: (cx + i she)^3 / h^3, rotated. Normalized before cubing, so a
        // far-out x (h near 1e154) can't overflow.
        let ih = f64x2_div(spl(1.0), t.h);
        let sl = mul(t.she, ih);
        let cl = mul(t.cx, ih);
        let cl2 = mul(cl, cl);
        let sl2 = mul(sl, sl);
        let s3 = mul(sl, sub(mul(spl(3.0), cl2), sl2));
        let c3 = mul(cl, sub(cl2, mul(spl(3.0), sl2)));
        let s1 = add(mul(s3, c3k), mul(c3, s3k));
        let c1 = sub(mul(c3, c3k), mul(s3, s3k));
        // sin, cos of the latitude: the conformal latitude chi plus phi - chi, below 0.01 rad.
        let ir = f64x2_div(spl(1.0), f64x2_sqrt(t.r2));
        let s_chi = mul(t.sx, ir);
        let c_chi = mul(t.h, ir);
        let dc = t.dchi;
        let dc2 = mul(dc, dc);
        let sdc = mul(dc, add(spl(1.0), mul(dc2, spl(-1.0 / 6.0))));
        let cdc = add(spl(1.0), mul(dc2, add(spl(-0.5), mul(dc2, spl(1.0 / 24.0)))));
        let sp = add(mul(s_chi, cdc), mul(c_chi, sdc));
        let cp = sub(mul(c_chi, cdc), mul(s_chi, sdc));
        // sin, cos of lat - 35.
        let u1 = sub(mul(sp, spl(C35)), mul(cp, spl(S35)));
        let v1 = add(mul(cp, spl(C35)), mul(sp, spl(S35)));

        // `vgcj::offset::<false>`, with the series reordered for latency (the rounding differs by an ulp or so).
        let s2 = dbl(s1, c1);
        let c2 = one_m2(s1);
        let s4 = dbl(s2, c2);
        let c4 = one_m2(s2);
        let s5 = add(mul(s4, c1), mul(c4, s1));
        let c5 = sub(mul(c4, c1), mul(s4, s1));
        let s10 = dbl(s5, c5);
        let c10 = one_m2(s5);
        let s20 = dbl(s10, c10);
        let c20 = one_m2(s10);
        let s60 = triple_s(s20);
        let c60 = triple_c(c20);
        let s120 = dbl(s60, c60);
        let s360 = triple_s(s120);

        let u3 = triple_s(u1);
        let v3 = triple_c(v1);
        let u6 = dbl(u3, v3);
        let v6 = one_m2(u3);
        let u12 = dbl(u6, v6);
        let v12 = one_m2(u6);
        let u15 = add(mul(u12, v3), mul(v12, u3));
        let v15 = sub(mul(v12, v3), mul(u12, u3));
        let u30 = dbl(u15, v15);
        let v30 = one_m2(u15);
        let u60 = dbl(u30, v30);
        let u180 = triple_s(u60);

        // The ellipsoid factors, ready before the series.
        let m = sub(spl(1.0), mul(mul(spl(EE), sp), sp));
        let sm = f64x2_sqrt(m);
        let fx = f64x2_div(mul(spl(KLON), sm), cp);
        let fy = mul(mul(spl(KLAT), m), sm);

        let xx = sub(l, spl(105.0));
        let yy = sub(p, spl(35.0));
        let r = f64x2_sqrt(f64x2_abs(xx));
        let xy = mul(mul(spl(0.1), xx), yy);
        // The series, summed latest-arriving terms last.
        let mut dlat = add(spl(-100.0), mul(spl(2.0), xx));
        dlat = add(dlat, mul(spl(3.0), yy));
        dlat = add(dlat, mul(mul(spl(0.2), yy), yy));
        dlat = add(dlat, xy);
        dlat = add(dlat, mul(spl(0.2), r));
        let mut dlon = add(spl(300.0), xx);
        dlon = add(dlon, mul(spl(2.0), yy));
        dlon = add(dlon, mul(mul(spl(0.1), xx), xx));
        dlon = add(dlon, xy);
        dlon = add(dlon, mul(spl(0.1), r));
        dlon = add(dlon, add(mul(spl(100.0), s5), mul(spl(200.0), s2)));
        dlon = add(dlon, add(mul(spl(80.0 / 3.0), s20), mul(spl(40.0 / 3.0), s60)));
        let common = mul(spl(40.0 / 3.0), add(s360, s120));
        let ulo = add(mul(spl(320.0 / 3.0), u15), mul(spl(640.0 / 3.0), u6));
        let uhi = add(mul(spl(80.0 / 3.0), u60), mul(spl(40.0 / 3.0), u180));
        dlat = add(dlat, add(ulo, uhi));
        let ox = mul(add(dlon, common), fx);
        let oy = mul(add(dlat, common), fy);
        store_pair(v128_bitselect(add(l, ox), l, inbox), olon, i);
        store_pair(v128_bitselect(add(p, oy), p, inbox), olat, i);
        i += 2;
    }
}
