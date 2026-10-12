//! f64x2 UTM kernel — the vector twin of `skernel` (see `kernel.rs` for the
//! math, the Karney reference, and the notation glossary; the phase banners
//! there match this file statement-for-statement).
//!
//! Deviations from the scalar twin, all accuracy-gated in bench/:
//! - transcendental calls go to the hand-written f64x2 primitives in
//!   `simd.rs` (≤ 2 ulp on the kernel ranges, `bench/sweeps.mjs`);
//! - the guarded atan/log1p sites branch per pair: in-domain lanes take the
//!   fast path, any out-of-domain lane falls back to the atan2/asinh blend;
//! - `vexp` clamps its exponent term at ±1000 (RESULTS.md documents the
//!   boundary where classification diverges from libm).
#![allow(unsafe_op_in_unsafe_fn)]

use crate::kernel::{reduce_lon, K, D2R, R2D};
use core::arch::wasm32::{
    f64x2, f64x2_abs, f64x2_add, f64x2_div, f64x2_extract_lane, f64x2_gt, f64x2_lt, f64x2_mul,
    f64x2_neg, f64x2_splat, f64x2_sqrt, f64x2_sub, i64x2_splat, v128, v128_and, v128_any_true, v128_bitselect,
    v128_or, v128_xor,
};

use crate::simd::{vatan, vatan2, vexp, vlog1p, vsincos};

#[inline]
fn spl(x: f64) -> v128 {
    f64x2_splat(x)
}

/// Kernel parameters splatted across both lanes.
pub struct KS {
    d2r: v128,
    lon0: v128,
    feast: v128,
    k_a: v128,
    inv_k_a: v128,
    fnorth: v128,
    ap: [v128; 4],
    bp: [v128; 4],
    cp: [v128; 6],
    dp: [v128; 6],
    a5: v128,
    a6: v128,
    b5: v128,
    b6: v128,
}

fn splat_k(k: &K) -> KS {
    let s = spl;
    let s4 = |a: &[f64; 4]| [s(a[0]), s(a[1]), s(a[2]), s(a[3])];
    let s6 = |a: &[f64; 6]| [s(a[0]), s(a[1]), s(a[2]), s(a[3]), s(a[4]), s(a[5])];
    KS {
        d2r: s(D2R),
        lon0: s(k.lon0),
        feast: s(k.feast),
        k_a: s(k.k_a),
        inv_k_a: s(k.inv_k_a),
        fnorth: s(k.fnorth),
        ap: s4(&k.ap),
        bp: s4(&k.bp),
        cp: s6(&k.cp),
        dp: s6(&k.dp),
        a5: s(k.a56[0]),
        a6: s(k.a56[1]),
        b5: s(k.b56[0]),
        b6: s(k.b56[1]),
    }
}

#[inline]
unsafe fn poly6(p: v128, c: &[v128; 6]) -> v128 {
    let mut r = f64x2_add(c[4], f64x2_mul(p, c[5]));
    r = f64x2_add(c[3], f64x2_mul(p, r));
    r = f64x2_add(c[2], f64x2_mul(p, r));
    r = f64x2_add(c[1], f64x2_mul(p, r));
    f64x2_add(c[0], f64x2_mul(p, r))
}

/// Per-32-bit-lane-all-ones mask when the f64 lane is finite.
#[inline]
unsafe fn is_finite(x: v128) -> v128 {
    f64x2_lt(f64x2_abs(x), spl(f64::INFINITY))
}

#[target_feature(enable = "simd128")]
pub unsafe fn forward2(mut lon: v128, lat: v128, q: &KS) -> (v128, v128) {
    let phi = f64x2_mul(lat, q.d2r);
    // Rare: whole turns are removed per lane by the scalar reduction, so both kernels agree.
    let out = v128_or(f64x2_gt(lon, spl(180.0)), f64x2_lt(lon, spl(-180.0)));
    if v128_any_true(out) {
        let (l0, l1) = (f64x2_extract_lane::<0>(lon), f64x2_extract_lane::<1>(lon));
        let r = |l: f64| if l > 180.0 || l < -180.0 { reduce_lon(l) } else { l };
        lon = f64x2(r(l0), r(l1));
    }
    let lam = f64x2_sub(f64x2_mul(lon, q.d2r), q.lon0);

    let (sp, cp) = vsincos(phi);
    let p = f64x2_sub(spl(2.0), f64x2_mul(spl(4.0), f64x2_mul(sp, sp)));
    let q1 = poly6(p, &q.cp);
    let dchi = f64x2_mul(f64x2_mul(f64x2_add(sp, sp), cp), q1);
    let dd = f64x2_mul(dchi, dchi);
    let sd = f64x2_mul(
        dchi,
        f64x2_add(
            spl(1.0),
            f64x2_mul(dd, f64x2_add(spl(-1.0 / 6.0), f64x2_mul(dd, spl(1.0 / 120.0)))),
        ),
    );
    let cd = f64x2_add(
        spl(1.0),
        f64x2_mul(dd, f64x2_add(spl(-0.5), f64x2_mul(dd, spl(1.0 / 24.0)))),
    );
    let sc = f64x2_add(f64x2_mul(sp, cd), f64x2_mul(cp, sd));
    let cc = f64x2_sub(f64x2_mul(cp, cd), f64x2_mul(sp, sd));

    let (sl, cl) = vsincos(lam);
    // !(cl > 1e-15) -> NaN pair (mirrors the early return in the TS kernel)
    let bad = v128_xor(f64x2_gt(cl, spl(1e-15)), i64x2_splat(-1));

    let ccl = f64x2_mul(cc, cl);
    let sc2 = f64x2_mul(sc, sc);
    let ccl2 = f64x2_mul(ccl, ccl);
    let ir = f64x2_div(spl(1.0), f64x2_sqrt(f64x2_add(sc2, ccl2)));
    let ccl0 = f64x2_extract_lane::<0>(ccl);
    let ccl1 = f64x2_extract_lane::<1>(ccl);
    let xip = if ccl0 > 0.0 && ccl1 > 0.0 {
        // every lane in-domain: atan alone matches atan2 for x > 0
        vatan(f64x2_div(sc, ccl))
    } else {
        v128_bitselect(
            vatan(f64x2_div(sc, ccl)),
            vatan2(sc, ccl),
            f64x2_gt(ccl, spl(0.0)),
        )
    };
    let she = f64x2_mul(f64x2_mul(cc, sl), ir);
    // log1p eta' with the |she| <= 1024 guard; the test is hoisted out of the
    // lanes (select-based fallbacks would pay the asinh chain every iteration)
    let sh0 = f64x2_extract_lane::<0>(she);
    let sh1 = f64x2_extract_lane::<1>(she);
    let etap = if sh0 > -1024.0 && sh0 < 1024.0 && sh1 > -1024.0 && sh1 < 1024.0 {
        vlog1p(f64x2_add(
            she,
            f64x2_div(f64x2_mul(she, she), f64x2_add(ir, spl(1.0))),
        ))
    } else {
        f64x2(libm::asinh(sh0), libm::asinh(sh1))
    };

    let ir2 = f64x2_mul(ir, ir);
    let s2 = f64x2_mul(f64x2_mul(f64x2_mul(spl(2.0), sc), ccl), ir2);
    let c2x = f64x2_mul(f64x2_sub(ccl2, sc2), ir2);
    let ch = f64x2_add(ir2, f64x2_mul(she, she));
    let sh = f64x2_mul(f64x2_mul(spl(2.0), she), ir);
    let ar = f64x2_mul(f64x2_mul(spl(2.0), c2x), ch);
    let ai = f64x2_neg(f64x2_mul(f64x2_mul(spl(2.0), s2), sh));
    let rho = f64x2_add(f64x2_mul(ar, ar), f64x2_mul(ai, ai));
    let ta = f64x2_add(ar, ar);
    let u4 = f64x2_add(q.a5, f64x2_mul(ta, q.a6));
    let u3 = f64x2_sub(f64x2_add(q.ap[3], f64x2_mul(ta, u4)), f64x2_mul(rho, q.a6));
    let u2 = f64x2_sub(f64x2_add(q.ap[2], f64x2_mul(ta, u3)), f64x2_mul(rho, u4));
    let u1 = f64x2_sub(f64x2_add(q.ap[1], f64x2_mul(ta, u2)), f64x2_mul(rho, u3));
    let tr = f64x2_sub(f64x2_add(q.ap[0], f64x2_mul(ar, u1)), f64x2_mul(rho, u2));
    let ti = f64x2_mul(ai, u1);
    let sr = f64x2_mul(s2, ch);
    let si = f64x2_mul(c2x, sh);

    let x = f64x2_add(
        q.feast,
        f64x2_mul(
            q.k_a,
            f64x2_add(etap, f64x2_add(f64x2_mul(tr, si), f64x2_mul(ti, sr))),
        ),
    );
    let y = f64x2_add(
        q.fnorth,
        f64x2_mul(
            q.k_a,
            f64x2_sub(f64x2_add(xip, f64x2_mul(tr, sr)), f64x2_mul(ti, si)),
        ),
    );
    (
        v128_bitselect(spl(f64::NAN), x, bad),
        v128_bitselect(spl(f64::NAN), y, bad),
    )
}

#[target_feature(enable = "simd128")]
pub unsafe fn inverse2(x: v128, y: v128, q: &KS) -> (v128, v128) {
    let xi = f64x2_mul(f64x2_sub(y, q.fnorth), q.inv_k_a);
    let eta = f64x2_mul(f64x2_sub(x, q.feast), q.inv_k_a);

    let (s1, c1x) = vsincos(xi);
    let e = vexp(eta);
    let ie = f64x2_div(spl(1.0), e);
    let ch1 = f64x2_mul(spl(0.5), f64x2_add(e, ie));
    let sh1 = f64x2_mul(spl(0.5), f64x2_sub(e, ie));
    let s2 = f64x2_mul(f64x2_mul(spl(2.0), s1), c1x);
    let c2x = f64x2_sub(f64x2_mul(c1x, c1x), f64x2_mul(s1, s1));
    let ch = f64x2_add(f64x2_mul(ch1, ch1), f64x2_mul(sh1, sh1));
    let sh = f64x2_mul(f64x2_mul(spl(2.0), sh1), ch1);
    let ar = f64x2_mul(f64x2_mul(spl(2.0), c2x), ch);
    let ai = f64x2_neg(f64x2_mul(f64x2_mul(spl(2.0), s2), sh));
    let rho = f64x2_add(f64x2_mul(ar, ar), f64x2_mul(ai, ai));
    let ta = f64x2_add(ar, ar);
    let u4 = f64x2_add(q.b5, f64x2_mul(ta, q.b6));
    let u3 = f64x2_sub(f64x2_add(q.bp[3], f64x2_mul(ta, u4)), f64x2_mul(rho, q.b6));
    let u2 = f64x2_sub(f64x2_add(q.bp[2], f64x2_mul(ta, u3)), f64x2_mul(rho, u4));
    let u1 = f64x2_sub(f64x2_add(q.bp[1], f64x2_mul(ta, u2)), f64x2_mul(rho, u3));
    let tr = f64x2_sub(f64x2_add(q.bp[0], f64x2_mul(ar, u1)), f64x2_mul(rho, u2));
    let ti = f64x2_add(f64x2_mul(ai, u1), spl(0.0)); // retains the Clenshaw +0 sign
    let sr = f64x2_mul(s2, ch);
    let si = f64x2_mul(c2x, sh);
    let dxi = f64x2_sub(f64x2_mul(tr, sr), f64x2_mul(ti, si));
    let deta = f64x2_add(f64x2_mul(tr, si), f64x2_mul(ti, sr));

    let dx2 = f64x2_mul(dxi, dxi);
    let sdx = f64x2_mul(
        dxi,
        f64x2_add(
            spl(1.0),
            f64x2_mul(dx2, f64x2_add(spl(-1.0 / 6.0), f64x2_mul(dx2, spl(1.0 / 120.0)))),
        ),
    );
    let cdx = f64x2_add(
        spl(1.0),
        f64x2_mul(dx2, f64x2_add(spl(-0.5), f64x2_mul(dx2, spl(1.0 / 24.0)))),
    );
    let de2 = f64x2_mul(deta, deta);
    let shd = f64x2_mul(
        deta,
        f64x2_add(
            spl(1.0),
            f64x2_mul(de2, f64x2_add(spl(1.0 / 6.0), f64x2_mul(de2, spl(1.0 / 120.0)))),
        ),
    );
    let chd = f64x2_add(
        spl(1.0),
        f64x2_mul(de2, f64x2_add(spl(0.5), f64x2_mul(de2, spl(1.0 / 24.0)))),
    );
    let sx = f64x2_sub(f64x2_mul(s1, cdx), f64x2_mul(c1x, sdx));
    let cx = f64x2_add(f64x2_mul(c1x, cdx), f64x2_mul(s1, sdx));
    let she = f64x2_sub(f64x2_mul(sh1, chd), f64x2_mul(ch1, shd));

    let h2 = f64x2_add(f64x2_mul(she, she), f64x2_mul(cx, cx));
    let h = f64x2_sqrt(h2);
    // guarded atan sites hoisted per pair: in-domain lanes (cx > 0, she finite)
    // pay only atan; any out-of-domain lane falls back to the atan2 blend
    let cx0 = f64x2_extract_lane::<0>(cx);
    let cx1 = f64x2_extract_lane::<1>(cx);
    let she0 = f64x2_extract_lane::<0>(she);
    let she1 = f64x2_extract_lane::<1>(she);
    let lam = if cx0 > 0.0 && cx1 > 0.0 && she0.is_finite() && she1.is_finite() {
        vatan(f64x2_div(she, cx))
    } else {
        v128_bitselect(
            vatan(f64x2_div(she, cx)),
            vatan2(she, cx),
            v128_and(f64x2_gt(cx, spl(0.0)), is_finite(she)),
        )
    };
    let h0 = f64x2_extract_lane::<0>(h);
    let h1 = f64x2_extract_lane::<1>(h);
    let sx0 = f64x2_extract_lane::<0>(sx);
    let sx1 = f64x2_extract_lane::<1>(sx);
    let chi = if h0 > 0.0 && h1 > 0.0 && sx0.is_finite() && sx1.is_finite() {
        vatan(f64x2_div(sx, h))
    } else {
        v128_bitselect(
            vatan(f64x2_div(sx, h)),
            vatan2(sx, h),
            v128_and(f64x2_gt(h, spl(0.0)), is_finite(sx)),
        )
    };

    let sx2 = f64x2_mul(sx, sx);
    let r2 = f64x2_add(sx2, h2);
    let p = f64x2_div(f64x2_mul(spl(2.0), f64x2_sub(h2, sx2)), r2);
    let q1 = poly6(p, &q.dp);
    let phi = f64x2_add(
        chi,
        f64x2_mul(
            f64x2_div(f64x2_mul(f64x2_mul(spl(2.0), sx), h), r2),
            q1,
        ),
    );

    let mut lon = f64x2_mul(f64x2_add(q.lon0, lam), spl(R2D));
    lon = v128_bitselect(f64x2_sub(lon, spl(360.0)), lon, f64x2_gt(lon, spl(180.0)));
    lon = v128_bitselect(f64x2_add(lon, spl(360.0)), lon, f64x2_lt(lon, spl(-180.0)));
    (lon, f64x2_mul(phi, spl(R2D)))
}

pub unsafe fn forward_batch(
    lonp: *const f64,
    latp: *const f64,
    xp: *mut f64,
    yp: *mut f64,
    n: usize,
    k: &K,
) {
    let q = splat_k(k);
    let mut i = 0;
    while i < n {
        let lon = crate::simd::load_pair(lonp, i, n);
        let lat = crate::simd::load_pair(latp, i, n);
        let (x, y) = forward2(lon, lat, &q);
        crate::simd::store_pair(x, xp, i, n);
        crate::simd::store_pair(y, yp, i, n);
        i += 2;
    }
}

pub unsafe fn inverse_batch(
    xp: *const f64,
    yp: *const f64,
    lonp: *mut f64,
    latp: *mut f64,
    n: usize,
    k: &K,
) {
    let q = splat_k(k);
    let mut i = 0;
    while i < n {
        let x = crate::simd::load_pair(xp, i, n);
        let y = crate::simd::load_pair(yp, i, n);
        let (lon, lat) = inverse2(x, y, &q);
        crate::simd::store_pair(lon, lonp, i, n);
        crate::simd::store_pair(lat, latp, i, n);
        i += 2;
    }
}
