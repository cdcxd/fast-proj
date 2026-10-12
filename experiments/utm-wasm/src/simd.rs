//! f64x2 vector math (+simd128): sincos, atan, atan2, exp, log, log1p, and
//! pair load/store helpers shared by the batch loops.
#![allow(unsafe_op_in_unsafe_fn)]

use crate::math::*;
use core::arch::wasm32::{
    f32x4_demote_f64x2_zero, f64x2, f64x2_abs, f64x2_add, f64x2_div, f64x2_eq, f64x2_ge,
    f64x2_gt, f64x2_le, f64x2_lt, f64x2_mul, f64x2_neg, f64x2_ne, f64x2_nearest, f64x2_pmax,
    f64x2_pmin, f64x2_splat, f64x2_sub, i32x4_trunc_sat_f32x4, i32x4_trunc_sat_f64x2_zero,
    i64x2_add, i64x2_extend_low_i32x4, i64x2_lt, i64x2_shl, i64x2_splat, i64x2_sub,
    u64x2_shr, v128, v128_and, v128_bitselect, v128_or,
};

#[inline]
fn spl(x: f64) -> v128 {
    f64x2_splat(x)
}

#[inline]
#[target_feature(enable = "simd128")]
pub unsafe fn poly(t: v128, c: &[f64]) -> v128 {
    let mut r = spl(0.0);
    for k in c.iter().rev() {
        r = f64x2_add(f64x2_mul(r, t), spl(*k));
    }
    r
}

/// Load a pair; odd tails splat the last point into both lanes.
#[inline]
pub unsafe fn load_pair(inp: *const f64, i: usize, n: usize) -> v128 {
    if i + 1 < n {
        f64x2(*inp.add(i), *inp.add(i + 1))
    } else {
        f64x2_splat(*inp.add(i))
    }
}

/// Store both lanes; an odd tail writes lane 0 only.
#[inline]
pub unsafe fn store_pair(v: v128, out: *mut f64, i: usize, n: usize) {
    use core::arch::wasm32::f64x2_extract_lane;
    *out.add(i) = f64x2_extract_lane::<0>(v);
    if i + 1 < n {
        *out.add(i + 1) = f64x2_extract_lane::<1>(v);
    }
}

/// atan(x) — the single-argument vector atan (|x| any; NaN/±0/±Inf handled).
#[target_feature(enable = "simd128")]
pub unsafe fn vatan(x: v128) -> v128 {
    let a = f64x2_abs(x);
    let gt1 = f64x2_gt(a, spl(1.0));
    let t = v128_bitselect(f64x2_div(spl(1.0), a), a, gt1);
    let big = f64x2_gt(t, spl(TAN_PI_8));
    // reduced argument in (0, tan(pi/8)) for t in (tan(pi/8), 1]
    let u_r = f64x2_div(
        f64x2_sub(t, spl(TAN_PI_8)),
        f64x2_add(spl(1.0), f64x2_mul(t, spl(TAN_PI_8))),
    );
    let u = v128_bitselect(u_r, t, big);
    let t2 = f64x2_mul(u, u);
    let pr = f64x2_add(u, f64x2_mul(t2, f64x2_mul(u, poly(t2, &AT))));
    // atan(t) = atan(u) + pi/8 when the transform fired
    let r = f64x2_add(pr, v128_bitselect(spl(PI_8), spl(0.0), big));
    // |x| > 1: atan(x) = pi/2 - atan(1/x); restore sign of x (incl. -0)
    let comp = v128_bitselect(f64x2_sub(spl(PI_2), r), r, gt1);
    v128_bitselect(f64x2_neg(comp), comp, i64x2_lt(x, i64x2_splat(0)))
}

/// atan2(y, x) — magnitude path plus exact-zero and quadrant handling.
#[target_feature(enable = "simd128")]
pub unsafe fn vatan2(y: v128, x: v128) -> v128 {
    let ay = f64x2_abs(y);
    let ax = f64x2_abs(x);
    let mx = f64x2_pmax(ax, ay);
    let mn = f64x2_pmin(ax, ay);
    let r0 = vatan(f64x2_div(mn, mx)); // in [0, pi/4]
    let r1 = v128_bitselect(f64x2_sub(spl(PI_2), r0), r0, f64x2_gt(ay, ax));
    let neg_x = i64x2_lt(x, i64x2_splat(0)); // true for -0 too
    let neg_y = i64x2_lt(y, i64x2_splat(0));
    let m = v128_bitselect(f64x2_sub(spl(M_PI), r1), r1, neg_x);
    let m = v128_bitselect(f64x2_neg(m), m, neg_y);
    // x = +-0: Math.atan2/glibc return +-pi/2 by sign of y for any nonzero y
    // (the x sign only matters when y is also zero). i64 compares catch -0.
    let v_pi = v128_bitselect(spl(-M_PI), spl(M_PI), neg_y);
    let v_zero = v128_bitselect(spl(-0.0), spl(0.0), neg_y);
    let both_zero = v128_bitselect(v_pi, v_zero, neg_x);
    let v_half = v128_bitselect(f64x2_neg(spl(PI_2)), spl(PI_2), neg_y);
    let x_zero = f64x2_eq(ax, spl(0.0));
    let v_xz = v128_bitselect(both_zero, v_half, f64x2_eq(ay, spl(0.0)));
    let m = v128_bitselect(v_xz, m, x_zero);
    // both infinite: +-pi/4 (x > 0) or +-3pi/4 (x < 0) — mn/mx is NaN there
    let both_inf = v128_and(
        f64x2_eq(ay, spl(f64::INFINITY)),
        f64x2_eq(ax, spl(f64::INFINITY)),
    );
    let v_inf = v128_bitselect(
        spl(PI_4),
        f64x2_sub(spl(M_PI), spl(PI_4)),
        f64x2_gt(x, spl(0.0)),
    );
    let v_inf = v128_bitselect(f64x2_neg(v_inf), v_inf, neg_y);
    let m = v128_bitselect(v_inf, m, both_inf);
    // NaN in either operand propagates: pmin/pmax can drop a NaN lane
    let nan_in = v128_or(f64x2_ne(y, y), f64x2_ne(x, x));
    v128_bitselect(spl(f64::NAN), m, nan_in)
}

#[target_feature(enable = "simd128")]
pub unsafe fn vsincos(x: v128) -> (v128, v128) {
    let k = f64x2_nearest(f64x2_mul(x, spl(TWO_OVER_PI)));
    let r = f64x2_sub(
        f64x2_sub(f64x2_sub(x, f64x2_mul(k, spl(PIO2_1))), f64x2_mul(k, spl(PIO2_1T))),
        f64x2_mul(k, spl(PIO2_2T)),
    );
    let t = f64x2_mul(r, r);
    let sp = f64x2_add(r, f64x2_mul(t, f64x2_mul(r, poly(t, &S))));
    let cp = f64x2_add(spl(1.0), f64x2_mul(t, poly(t, &C)));
    // quadrant masks must be f64-lane masks: i32 lane masks from
    // trunc_sat_f64x2_zero do not align with 64-bit lanes; the residue must
    // be unsigned — a signed -1 would take the q==1 pattern
    let quarter = f64x2_nearest(f64x2_mul(k, spl(0.25)));
    let q2s = f64x2_sub(k, f64x2_mul(spl(4.0), quarter)); // k mod 4, in (-2,2]
    let q2 = v128_bitselect(f64x2_add(q2s, spl(4.0)), q2s, f64x2_lt(q2s, spl(0.0)));
    let rem_odd = f64x2_sub(q2, f64x2_mul(spl(2.0), f64x2_nearest(f64x2_mul(q2, spl(0.5)))));
    let m_odd = f64x2_ne(rem_odd, spl(0.0));
    let m_two = f64x2_ge(q2, spl(1.5));
    // sin: q=0 sp, 1 cp, 2 -sp, 3 -cp; cos: q=0 cp, 1 -sp, 2 -cp, 3 sp
    let s1 = v128_bitselect(cp, sp, m_odd);
    let sin_v = v128_bitselect(f64x2_neg(s1), s1, m_two);
    let c1 = v128_bitselect(f64x2_neg(sp), cp, m_odd);
    let cos_v = v128_bitselect(f64x2_neg(c1), c1, m_two);
    // sin(±0) = ±0: the reduction loses the input's sign (x − k·π/2 rounds
    // −0 up to +0, so the selected value is +0 on zero lanes); selecting the
    // input itself restores it. cos(±0) = +1 is unaffected.
    let sin_v = v128_bitselect(x, sin_v, f64x2_eq(x, spl(0.0)));
    (sin_v, cos_v)
}

/// exp with the exponent k clamped to +-1000 (|x| <= ~693 covers the UTM
/// kernel and the diagnostics suite; beyond that, classification differs
/// from libm — documented in RESULTS.md).
#[target_feature(enable = "simd128")]
pub unsafe fn vexp(x: v128) -> v128 {
    let k = f64x2_nearest(f64x2_mul(x, spl(LOG2E)));
    let r = f64x2_sub(f64x2_sub(x, f64x2_mul(k, spl(LN2_HI))), f64x2_mul(k, spl(LN2_LO)));
    let p = f64x2_add(f64x2_add(spl(1.0), r), f64x2_mul(f64x2_mul(r, r), poly(r, &E)));
    let kc = f64x2_pmin(f64x2_pmax(k, spl(-1000.0)), spl(1000.0));
    // k is integral and |k| <= 1000, exact through f32 and i32
    let ki32 = i32x4_trunc_sat_f32x4(f32x4_demote_f64x2_zero(kc));
    let bits = i64x2_shl(i64x2_add(i64x2_extend_low_i32x4(ki32), i64x2_splat(1023)), 52);
    f64x2_mul(p, bits)
}

/// log for positive normals; mantissa normalized into [sqrt(0.5), sqrt(2)),
/// the L fit domain.
#[target_feature(enable = "simd128")]
pub unsafe fn vlog(x: v128) -> v128 {
    let e_i = i64x2_sub(
        v128_and(u64x2_shr(x, 52), i64x2_splat(0x7ff)),
        i64x2_splat(1023),
    );
    let m1 = v128_or(
        v128_and(x, i64x2_splat(!((0x7ffu64 as i64) << 52))),
        i64x2_splat(1023 << 52),
    );
    let big = f64x2_ge(m1, spl(SQRT2));
    let mant = v128_bitselect(f64x2_mul(m1, spl(0.5)), m1, big);
    let e2 = i64x2_add(e_i, v128_bitselect(i64x2_splat(1), i64x2_splat(0), big));
    let s = f64x2_div(f64x2_sub(mant, spl(1.0)), f64x2_add(mant, spl(1.0)));
    let t = f64x2_mul(s, s);
    let ef = f64x2(
        i64x2_extract_lane0(e2) as f64,
        i64x2_extract_lane1(e2) as f64,
    );
    let r = f64x2_add(
        f64x2_add(
            f64x2_add(
                f64x2_mul(spl(2.0), s),
                f64x2_mul(f64x2_mul(spl(2.0), t), f64x2_mul(s, poly(t, &L))),
            ),
            f64x2_mul(ef, spl(LN2_HI)),
        ),
        f64x2_mul(ef, spl(LN2_LO)),
    );
    // domain completion: +Inf -> +Inf, +0/-0 -> -Inf, x < 0 or NaN -> NaN.
    // Positive subnormals are out of domain and return garbage (the poly runs
    // with exponent -1023); the kernel only feeds positive normals.
    let r = v128_bitselect(spl(f64::INFINITY), r, f64x2_eq(x, spl(f64::INFINITY)));
    let r = v128_bitselect(spl(f64::NEG_INFINITY), r, f64x2_eq(x, spl(0.0)));
    let nan_or_neg = v128_or(f64x2_lt(x, spl(0.0)), f64x2_ne(x, x));
    v128_bitselect(spl(f64::NAN), r, nan_or_neg)
}

#[inline]
fn i64x2_extract_lane0(v: v128) -> i64 {
    use core::arch::wasm32::i64x2_extract_lane;
    i64x2_extract_lane::<0>(v)
}

#[inline]
fn i64x2_extract_lane1(v: v128) -> i64 {
    use core::arch::wasm32::i64x2_extract_lane;
    i64x2_extract_lane::<1>(v)
}

/// log1p(t) for t in [-0.75, 2048]; ~1 ulp.
#[target_feature(enable = "simd128")]
pub unsafe fn vlog1p(t: v128) -> v128 {
    let at = f64x2_abs(t);
    let small = f64x2_lt(at, spl(f64::from_bits(0x3CA0000000000000))); // 2^-53
    let mid = f64x2_le(at, spl(0.25));
    // s = t/(2+t) in [-1/7, 1/9], inside the L fit domain
    let s = f64x2_div(t, f64x2_add(spl(2.0), t));
    let s2 = f64x2_mul(s, s);
    let lm = f64x2_add(
        f64x2_mul(spl(2.0), s),
        f64x2_mul(f64x2_mul(spl(2.0), s2), f64x2_mul(s, poly(s2, &L))),
    );
    let lg = vlog(f64x2_add(spl(1.0), t));
    let base = v128_bitselect(lm, lg, mid);
    v128_bitselect(t, base, small)
}
