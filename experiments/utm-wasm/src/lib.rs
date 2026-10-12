//! Smoke prototype for the UTM wasm experiment: allocator, boundary probes,
//! and the vector-math primitives (sin/cos/atan/exp/log) that dominate the
//! kernel. Built twice: scalar and +simd128; both export the same ABI.
#![no_std]
#![allow(static_mut_refs)]

#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

// ---------------------------------------------------------------------------
// Coefficients (mpmath Chebyshev fits, 60 dps, rounded to double; generator:
// experiments/utm-wasm/tools/gen_coeffs.py)
// ---------------------------------------------------------------------------

/// sin(r) = r + r^3 S(r^2), |r| <= pi/4; fit error 4.5e-18
const S: [f64; 8] = [-1.66666666666666657e-01, 8.33333333333333322e-03, -1.98412698412698385e-04, 2.75573192239810983e-06, -2.50521083823900359e-08, 1.60590427810860551e-10, -7.64696135209432330e-13, 2.79124424334719756e-15];
/// cos(r) = 1 + r^2 C(r^2), |r| <= pi/4; fit error 8.9e-19
const C: [f64; 10] = [-5.00000000000000000e-01, 4.16666666666666644e-02, -1.38888888888888894e-03, 2.48015873015873016e-05, -2.75573192239858830e-07, 2.08767569878650065e-09, -1.14707455965908374e-11, 4.77947707261002709e-14, -1.56188488172443161e-16, 4.08296565861687673e-19];
/// exp(r) = 1 + r + r^2 E(r), |r| <= 0.3466; fit error 2.8e-19
const E: [f64; 11] = [5.00000000000000000e-01, 1.66666666666666713e-01, 4.16666666666666713e-02, 8.33333333332613585e-03, 1.38888888888837503e-03, 1.98412698748158344e-04, 2.48015873255443207e-05, 2.75572554062850442e-06, 2.75572736474510872e-07, 2.51052144747514130e-08, 2.09146851614180674e-09];
/// log(m) = 2s + 2s^3 L(s^2), s = (m-1)/(m+1), |s| <= 0.1716; fit error 1.9e-19
const L: [f64; 9] = [3.33333333333333315e-01, 1.99999999999999956e-01, 1.42857142857176794e-01, 1.11111111099293669e-01, 9.09090929682838111e-02, 7.69228756616504861e-02, 6.66781933491991108e-02, 5.84406182143155511e-02, 5.94099860148072922e-02];
/// atan(u) = u + u^3 P(u^2), |u| <= tan(pi/8); fit error 1.5e-18
const AT: [f64; 13] = [-3.33333333333333315e-01, 1.99999999999999928e-01, -1.42857142857115177e-01, 1.11111111107547289e-01, -9.09090906700999041e-02, 7.69230673600017345e-02, -6.66664202005516626e-02, 5.88192525319286355e-02, -5.25804155429777931e-02, 4.71939503002743316e-02, -4.10443626575508203e-02, 3.06357041129694981e-02, -1.39182292910244292e-02];

// Cody-Waite / range-reduction constants (fdlibm bit patterns)
const TWO_OVER_PI: f64 = f64::from_bits(0x3FE45F306DC9C883);
const PIO2_1: f64 = f64::from_bits(0x3FF921FB54400000);
const PIO2_1T: f64 = f64::from_bits(0x3DD0B4611A626331);
const PIO2_2T: f64 = f64::from_bits(0x3BA3198A2E037073);
const TAN_PI_8: f64 = f64::from_bits(0x3FDA827999FCEF34);
const PI_8: f64 = f64::from_bits(0x3FD921FB54442D18);
const PI_2: f64 = f64::from_bits(0x3FF921FB54442D18);
const SQRT2: f64 = f64::from_bits(0x3FF6A09E667F3BCD);
const LN2_HI: f64 = f64::from_bits(0x3FE62E42FEE00000);
const LOG2E: f64 = f64::from_bits(0x3FF71547652B82FE);
const LN2_LO: f64 = f64::from_bits(0x3DEA39EF35793C76);

// ---------------------------------------------------------------------------
// Scalar path (same algorithms, plain f64)
// ---------------------------------------------------------------------------

mod scalar {
    // Proven scalar implementations (musl port); also a cross-check for the
    // hand-written vector math in the +simd128 build.
    pub fn sincos(x: f64) -> (f64, f64) {
        (libm::sin(x), libm::cos(x))
    }

    pub fn atan(x: f64) -> f64 {
        libm::atan(x)
    }

    pub fn exp(x: f64) -> f64 {
        libm::exp(x)
    }

    pub fn log(x: f64) -> f64 {
        libm::log(x)
    }
}

// ---------------------------------------------------------------------------
// f64x2 path (+simd128)
// ---------------------------------------------------------------------------

#[cfg(target_feature = "simd128")]
mod simd {
    use super::*;
    use core::arch::wasm32::{
        f32x4_demote_f64x2_zero, f64x2, f64x2_abs, f64x2_add, f64x2_div, f64x2_ge, f64x2_gt,
        f64x2_mul, f64x2_ne, f64x2_neg, f64x2_nearest, f64x2_pmax, f64x2_pmin, f64x2_splat,
        f64x2_sub, i32x4_trunc_sat_f32x4,
        i64x2_add, i64x2_extract_lane, i64x2_extend_low_i32x4, i64x2_lt, i64x2_shl,
        i64x2_splat, i64x2_sub, u64x2_shr, v128, v128_and, v128_bitselect, v128_or,
    };

    #[inline]
    fn spl(x: f64) -> v128 {
        f64x2_splat(x)
    }

    #[inline]
    #[target_feature(enable = "simd128")]
    unsafe fn poly(t: v128, c: &[f64]) -> v128 {
        let mut r = spl(0.0);
        for k in c.iter().rev() {
            r = f64x2_add(f64x2_mul(r, t), spl(*k));
        }
        r
    }

    #[target_feature(enable = "simd128")]
    pub unsafe fn sincos2(x: v128) -> (v128, v128) {
        let k = f64x2_nearest(f64x2_mul(x, spl(TWO_OVER_PI)));
        let r = f64x2_sub(
            f64x2_sub(f64x2_sub(x, f64x2_mul(k, spl(PIO2_1))), f64x2_mul(k, spl(PIO2_1T))),
            f64x2_mul(k, spl(PIO2_2T)),
        );
        let t = f64x2_mul(r, r);
        let sp = f64x2_add(r, f64x2_mul(t, f64x2_mul(r, poly(t, &S))));
        let cp = f64x2_add(spl(1.0), f64x2_mul(t, poly(t, &C)));
        // quadrant masks must be f64-lane masks: i32 lane masks from
        // trunc_sat_f64x2_zero do not align with 64-bit lanes
        let quarter = f64x2_nearest(f64x2_mul(k, spl(0.25)));
        let q2 = f64x2_sub(k, f64x2_mul(spl(4.0), quarter)); // k mod 4, in [-3,3]
        let rem_odd = f64x2_sub(q2, f64x2_mul(spl(2.0), f64x2_nearest(f64x2_mul(q2, spl(0.5)))));
        let m_odd = f64x2_ne(rem_odd, spl(0.0));
        let m_two = f64x2_ge(f64x2_abs(q2), spl(1.5));
        let s1 = v128_bitselect(cp, sp, m_odd);
        let sin_v = v128_bitselect(f64x2_neg(s1), s1, m_two);
        let c1 = v128_bitselect(f64x2_neg(sp), cp, m_odd);
        let cos_v = v128_bitselect(f64x2_neg(c1), c1, m_two);
        (sin_v, cos_v)
    }

    #[target_feature(enable = "simd128")]
    pub unsafe fn atan2v(x: v128) -> v128 {
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

    #[target_feature(enable = "simd128")]
    pub unsafe fn exp2v(x: v128) -> v128 {
        let k = f64x2_nearest(f64x2_mul(x, spl(LOG2E)));
        let r = f64x2_sub(f64x2_sub(x, f64x2_mul(k, spl(LN2_HI))), f64x2_mul(k, spl(LN2_LO)));
        let p = f64x2_add(f64x2_add(spl(1.0), r), f64x2_mul(f64x2_mul(r, r), poly(r, &E)));
        let kc = f64x2_pmin(f64x2_pmax(k, spl(-1000.0)), spl(1000.0));
        // k is integral and |k| <= 1000, exact through f32 and i32
        let ki32 = i32x4_trunc_sat_f32x4(f32x4_demote_f64x2_zero(kc));
        let bits = i64x2_shl(
            i64x2_add(i64x2_extend_low_i32x4(ki32), i64x2_splat(1023)),
            52,
        );
        f64x2_mul(p, bits)
    }

    #[target_feature(enable = "simd128")]
    pub unsafe fn log2v(x: v128) -> v128 {
        let e_i = i64x2_sub(
            v128_and(u64x2_shr(x, 52), i64x2_splat(0x7ff)),
            i64x2_splat(1023),
        );
        let m1 = v128_or(
            v128_and(x, i64x2_splat(!((0x7ffu64 as i64) << 52))),
            i64x2_splat(1023 << 52),
        );
        // normalize mantissa into [sqrt(0.5), sqrt(2)), the L fit domain
        let big = f64x2_ge(m1, spl(SQRT2));
        let mant = v128_bitselect(f64x2_mul(m1, spl(0.5)), m1, big);
        let e2 = i64x2_add(e_i, v128_bitselect(i64x2_splat(1), i64x2_splat(0), big));
        let s = f64x2_div(f64x2_sub(mant, spl(1.0)), f64x2_add(mant, spl(1.0)));
        let t = f64x2_mul(s, s);
        let ef = f64x2(
            i64x2_extract_lane::<0>(e2) as f64,
            i64x2_extract_lane::<1>(e2) as f64,
        );
        f64x2_add(
            f64x2_add(
                f64x2_add(
                    f64x2_mul(spl(2.0), s),
                    f64x2_mul(f64x2_mul(spl(2.0), t), f64x2_mul(s, poly(t, &L))),
                ),
                f64x2_mul(ef, spl(LN2_HI)),
            ),
            f64x2_mul(ef, spl(LN2_LO)),
        )
    }
}

// ---------------------------------------------------------------------------
// Allocator (bump; buffers live in wasm linear memory, zero-copy from JS)
// ---------------------------------------------------------------------------

const HEAP_SIZE: usize = 1 << 28; // 256 MiB in bss; engines commit lazily
#[repr(align(8))]
struct AlignedHeap([u8; HEAP_SIZE]);
static mut HEAP: AlignedHeap = AlignedHeap([0; HEAP_SIZE]);
static mut OFFSET: usize = 0;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(n_f64: usize) -> *mut f64 {
    unsafe {
        let o = OFFSET;
        OFFSET = o + n_f64 * 8;
        debug_assert!(OFFSET <= HEAP_SIZE);
        HEAP.0.as_mut_ptr().add(o) as *mut f64
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn heap_used() -> usize {
    unsafe { OFFSET }
}

// ---------------------------------------------------------------------------
// Batch exports
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn noop() {}

#[unsafe(no_mangle)]
pub extern "C" fn copy_f64(dst: *mut f64, src: *const f64, n: usize) {
    unsafe { core::ptr::copy_nonoverlapping(src, dst, n) }
}

/// Load a pair; odd tails splat the last point into both lanes.
#[cfg(target_feature = "simd128")]
#[inline]
unsafe fn load_pair(inp: *const f64, i: usize, n: usize) -> core::arch::wasm32::v128 {
    use core::arch::wasm32::{f64x2, f64x2_splat};
    if i + 1 < n {
        f64x2(*inp.add(i), *inp.add(i + 1))
    } else {
        f64x2_splat(*inp.add(i))
    }
}

#[cfg(target_feature = "simd128")]
#[inline]
unsafe fn store_pair(v: core::arch::wasm32::v128, out: *mut f64, i: usize, n: usize) {
    use core::arch::wasm32::f64x2_extract_lane;
    *out.add(i) = f64x2_extract_lane::<0>(v);
    if i + 1 < n {
        *out.add(i + 1) = f64x2_extract_lane::<1>(v);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sincos_batch(inp: *const f64, s_out: *mut f64, c_out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            let x = load_pair(inp, i, n);
            let (s, c) = simd::sincos2(x);
            store_pair(s, s_out, i, n);
            store_pair(c, c_out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        let (s, c) = scalar::sincos(unsafe { *inp.add(i) });
        unsafe {
            *s_out.add(i) = s;
            *c_out.add(i) = c;
        }
    }
    let _ = (inp, s_out, c_out, n);
}

#[unsafe(no_mangle)]
pub extern "C" fn atan_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            store_pair(simd::atan2v(load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = scalar::atan(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}

#[unsafe(no_mangle)]
pub extern "C" fn exp_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            store_pair(simd::exp2v(load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = scalar::exp(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}

#[unsafe(no_mangle)]
pub extern "C" fn log_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            store_pair(simd::log2v(load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = scalar::log(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    #[cfg(target_feature = "simd128")]
    unsafe {
        core::arch::wasm32::unreachable()
    }
    #[cfg(not(target_feature = "simd128"))]
    loop {}
}
