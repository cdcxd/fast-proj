//! f64x2 GCJ-02 kernel (passthrough mode) — the vector twin of `gcj::sgcj`
//! and src/gcj02.ts.
//!
//! Out-of-box lanes compute garbage (wasm float ops don't trap) and select
//! their (reduced) input at the end; pairs with both lanes out of the box skip
//! the math. The inverse's extra steps near longitude 105 are masked per lane,
//! so each lane takes exactly the steps the TS loop would.

use crate::gcj::*;
use crate::kernel::reduce_lon;
use core::arch::wasm32::{
    f64x2, f64x2_abs, f64x2_add, f64x2_div, f64x2_extract_lane, f64x2_ge, f64x2_gt, f64x2_le,
    f64x2_lt, f64x2_mul, f64x2_splat, f64x2_sqrt, f64x2_sub, v128, v128_and, v128_any_true,
    v128_bitselect, v128_or,
};

use crate::simd::{load_pair, store_pair, vsincos};

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

/// 2ab
#[inline]
fn dbl(a: v128, b: v128) -> v128 {
    mul(spl(2.0), mul(a, b))
}

/// 1 - 2a^2
#[inline]
fn one_m2(a: v128) -> v128 {
    sub(spl(1.0), mul(spl(2.0), mul(a, a)))
}

/// a(3 - 4a^2)
#[inline]
fn triple_s(a: v128) -> v128 {
    mul(a, sub(spl(3.0), mul(spl(4.0), mul(a, a))))
}

/// a(4a^2 - 3)
#[inline]
fn triple_c(a: v128) -> v128 {
    mul(a, sub(mul(spl(4.0), mul(a, a)), spl(3.0)))
}

#[inline(never)]
fn offset(x: v128, y: v128, s1: v128, c1: v128, u1: v128, v1: v128) -> (v128, v128) {
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

    let sp = add(mul(u1, spl(C35)), mul(v1, spl(S35)));
    let cp = sub(mul(v1, spl(C35)), mul(u1, spl(S35)));

    let r = f64x2_sqrt(f64x2_abs(x));
    let common = mul(spl(40.0 / 3.0), add(s360, s120));
    let xy = mul(mul(spl(0.1), x), y);
    // Summed left to right, as in the TS kernel.
    let mut dlat = add(spl(-100.0), mul(spl(2.0), x));
    dlat = add(dlat, mul(spl(3.0), y));
    dlat = add(dlat, mul(mul(spl(0.2), y), y));
    dlat = add(dlat, xy);
    dlat = add(dlat, mul(spl(0.2), r));
    dlat = add(dlat, common);
    dlat = add(dlat, mul(spl(40.0 / 3.0), u180));
    dlat = add(dlat, mul(spl(80.0 / 3.0), u60));
    dlat = add(dlat, mul(spl(320.0 / 3.0), u15));
    dlat = add(dlat, mul(spl(640.0 / 3.0), u6));
    let mut dlon = add(spl(300.0), x);
    dlon = add(dlon, mul(spl(2.0), y));
    dlon = add(dlon, mul(mul(spl(0.1), x), x));
    dlon = add(dlon, xy);
    dlon = add(dlon, mul(spl(0.1), r));
    dlon = add(dlon, common);
    dlon = add(dlon, mul(spl(40.0 / 3.0), s60));
    dlon = add(dlon, mul(spl(80.0 / 3.0), s20));
    dlon = add(dlon, mul(spl(100.0), s5));
    dlon = add(dlon, mul(spl(200.0), s2));
    let m = sub(spl(1.0), mul(mul(spl(EE), sp), sp));
    let sm = f64x2_sqrt(m);
    (
        f64x2_div(mul(mul(dlon, spl(KLON)), sm), cp),
        mul(mul(mul(dlat, spl(KLAT)), m), sm),
    )
}

/// Reduces lanes outside [-180, 180] by the scalar fmod (rare), and returns the box mask.
#[inline]
fn prepare(mut lon: v128, lat: v128) -> (v128, v128) {
    if v128_any_true(v128_or(
        f64x2_gt(lon, spl(180.0)),
        f64x2_lt(lon, spl(-180.0)),
    )) {
        let r = |l: f64| {
            if l > 180.0 || l < -180.0 {
                reduce_lon(l)
            } else {
                l
            }
        };
        lon = f64x2(
            r(f64x2_extract_lane::<0>(lon)),
            r(f64x2_extract_lane::<1>(lon)),
        );
    }
    let inbox = v128_and(
        v128_and(f64x2_ge(lon, spl(LON_MIN)), f64x2_le(lon, spl(LON_MAX))),
        v128_and(f64x2_ge(lat, spl(LAT_MIN)), f64x2_le(lat, spl(LAT_MAX))),
    );
    (lon, inbox)
}

pub fn forward_batch(lon: &[f64], lat: &[f64], olon: &mut [f64], olat: &mut [f64]) {
    let mut i = 0;
    while i < lon.len() {
        let (l, inbox) = prepare(load_pair(lon, i), load_pair(lat, i));
        let p = load_pair(lat, i);
        if !v128_any_true(inbox) {
            store_pair(l, olon, i);
            store_pair(p, olat, i);
            i += 2;
            continue;
        }
        let x = sub(l, spl(105.0));
        let y = sub(p, spl(35.0));
        let (s, c) = vsincos(mul(x, spl(KX)));
        let (u, v) = vsincos(mul(y, spl(KY)));
        let (ox, oy) = offset(x, y, s, c, u, v);
        store_pair(v128_bitselect(add(l, ox), l, inbox), olon, i);
        store_pair(v128_bitselect(add(p, oy), p, inbox), olat, i);
        i += 2;
    }
}

/// Fixed-point state: iterate (wx, wy), its sin/cos pairs, and the offset at it.
#[derive(Clone, Copy)]
struct W {
    wx: v128,
    wy: v128,
    s: v128,
    c: v128,
    u: v128,
    v: v128,
    ox: v128,
    oy: v128,
}

/// One step w = g - offset(w), rotating the sin/cos pairs by the step (series terms scaled by reciprocals, not
/// divided: the difference is far below an ulp of the result).
#[inline]
fn step(lon: v128, lat: v128, w: W) -> W {
    let nx = sub(lon, w.ox);
    let ny = sub(lat, w.oy);
    let d = mul(sub(nx, w.wx), spl(KX));
    let e = mul(sub(ny, w.wy), spl(KY));
    let d2 = mul(d, d);
    let e2 = mul(e, e);
    let sd = mul(d, sub(spl(1.0), mul(d2, spl(1.0 / 6.0))));
    let cd = sub(spl(1.0), mul(d2, sub(spl(0.5), mul(d2, spl(1.0 / 24.0)))));
    let se = mul(e, sub(spl(1.0), mul(e2, spl(1.0 / 6.0))));
    let ce = sub(spl(1.0), mul(e2, sub(spl(0.5), mul(e2, spl(1.0 / 24.0)))));
    let s = add(mul(w.s, cd), mul(w.c, sd));
    let c = sub(mul(w.c, cd), mul(w.s, sd));
    let u = add(mul(w.u, ce), mul(w.v, se));
    let v = sub(mul(w.v, ce), mul(w.u, se));
    let (ox, oy) = offset(sub(nx, spl(105.0)), sub(ny, spl(35.0)), s, c, u, v);
    W {
        wx: nx,
        wy: ny,
        s,
        c,
        u,
        v,
        ox,
        oy,
    }
}

#[inline]
fn near_cusp(w: &W) -> v128 {
    f64x2_lt(f64x2_abs(sub(w.wx, spl(105.0))), spl(CUSP))
}

pub fn inverse_batch(lon: &[f64], lat: &[f64], olon: &mut [f64], olat: &mut [f64]) {
    let mut i = 0;
    while i < lon.len() {
        let (l, inbox) = prepare(load_pair(lon, i), load_pair(lat, i));
        let p = load_pair(lat, i);
        if !v128_any_true(inbox) {
            store_pair(l, olon, i);
            store_pair(p, olat, i);
            i += 2;
            continue;
        }
        let x = sub(l, spl(105.0));
        let y = sub(p, spl(35.0));
        let (s, c) = vsincos(mul(x, spl(KX)));
        let (u, v) = vsincos(mul(y, spl(KY)));
        let (ox, oy) = offset(x, y, s, c, u, v);
        let mut w = W {
            wx: l,
            wy: p,
            s,
            c,
            u,
            v,
            ox,
            oy,
        };
        for _ in 1..STEPS {
            w = step(l, p, w);
        }
        let mut active = v128_and(inbox, near_cusp(&w));
        for _ in STEPS..CUSP_STEPS {
            if !v128_any_true(active) {
                break;
            }
            let n = step(l, p, w);
            let sel = |a: v128, b: v128| v128_bitselect(a, b, active);
            w = W {
                wx: sel(n.wx, w.wx),
                wy: sel(n.wy, w.wy),
                s: sel(n.s, w.s),
                c: sel(n.c, w.c),
                u: sel(n.u, w.u),
                v: sel(n.v, w.v),
                ox: sel(n.ox, w.ox),
                oy: sel(n.oy, w.oy),
            };
            active = v128_and(active, near_cusp(&w));
        }
        store_pair(v128_bitselect(sub(l, w.ox), l, inbox), olon, i);
        store_pair(v128_bitselect(sub(p, w.oy), p, inbox), olat, i);
        i += 2;
    }
}
