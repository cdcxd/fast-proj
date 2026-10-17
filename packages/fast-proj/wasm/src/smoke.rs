//! Math smoke exports: the vector math on its own, for the raw-export benches and checks.

use crate::{r, w};
#[cfg(not(target_feature = "simd128"))]
use crate::math;
#[cfg(target_feature = "simd128")]
use crate::simd;

#[unsafe(no_mangle)]
pub extern "C" fn noop() {}

/// # Safety
/// `dst` and `src` must be non-null and aligned, even when `n` is 0, address `n` valid f64s each, and not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn copy_f64(dst: *mut f64, src: *const f64, n: usize) {
    unsafe { core::ptr::copy_nonoverlapping(src, dst, n) }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sincos_batch(inp: *const f64, s_out: *mut f64, c_out: *mut f64, n: usize) {
    let (inp, s_out, c_out) = unsafe { (r(inp, n), w(s_out, n), w(c_out, n)) };
    #[cfg(target_feature = "simd128")]
    {
        let mut i = 0;
        while i < n {
            let (s, c) = simd::vsincos(simd::load_pair(inp, i));
            simd::store_pair(s, s_out, i);
            simd::store_pair(c, c_out, i);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        (s_out[i], c_out[i]) = math::scalar::sincos(inp[i]);
    }
}

#[cfg(target_feature = "simd128")]
fn map(inp: &[f64], out: &mut [f64], f: impl Fn(core::arch::wasm32::v128) -> core::arch::wasm32::v128) {
    let mut i = 0;
    while i < inp.len() {
        simd::store_pair(f(simd::load_pair(inp, i)), out, i);
        i += 2;
    }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn atan_batch(inp: *const f64, out: *mut f64, n: usize) {
    let (inp, out) = unsafe { (r(inp, n), w(out, n)) };
    #[cfg(target_feature = "simd128")]
    map(inp, out, simd::vatan);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        out[i] = math::scalar::atan(inp[i]);
    }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn exp_batch(inp: *const f64, out: *mut f64, n: usize) {
    let (inp, out) = unsafe { (r(inp, n), w(out, n)) };
    #[cfg(target_feature = "simd128")]
    map(inp, out, simd::vexp);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        out[i] = math::scalar::exp(inp[i]);
    }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn atan2_batch(yp: *const f64, xp: *const f64, out: *mut f64, n: usize) {
    let (y, x, out) = unsafe { (r(yp, n), r(xp, n), w(out, n)) };
    #[cfg(target_feature = "simd128")]
    {
        let mut i = 0;
        while i < n {
            simd::store_pair(simd::vatan2(simd::load_pair(y, i), simd::load_pair(x, i)), out, i);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        out[i] = libm::atan2(y[i], x[i]);
    }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn log_batch(inp: *const f64, out: *mut f64, n: usize) {
    let (inp, out) = unsafe { (r(inp, n), w(out, n)) };
    #[cfg(target_feature = "simd128")]
    map(inp, out, simd::vlog);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        out[i] = math::scalar::log(inp[i]);
    }
}

/// Math-smoke export for the guarded log1p paths and odd tails.
///
/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn log1p_batch(inp: *const f64, out: *mut f64, n: usize) {
    let (inp, out) = unsafe { (r(inp, n), w(out, n)) };
    #[cfg(target_feature = "simd128")]
    map(inp, out, simd::vlog1p);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        out[i] = libm::log1p(inp[i]);
    }
}
