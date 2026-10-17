//! Crate root: module wiring and the C-ABI surface (the transverse Mercator
//! batch exports with scalar/simd dispatch, and the GCJ-02 batch exports).
//!
//! Layout: `math` (coefficients/constants + libm scalar wrappers), `simd`
//! (f64x2 vector math, +simd128 only), `kernel` (UTM series + scalar
//! kernel), `vkernel` (f64x2 kernel, +simd128 only), `gcj` (GCJ-02 constants
//! and scalar reference), `vgcj` (f64x2 GCJ-02 kernel, +simd128 only),
//! `alloc` (bump arena), `smoke` (math smoke exports), `tests` (host tests).
#![cfg_attr(not(test), no_std)]
#![allow(static_mut_refs)]

mod alloc;
#[cfg_attr(not(target_feature = "simd128"), allow(dead_code))]
mod gcj;
mod kernel;
// The constants serve the SIMD math (and the host tests that pin them); unused in the scalar build.
#[cfg_attr(not(target_feature = "simd128"), allow(dead_code))]
mod math;
#[cfg(target_feature = "simd128")]
mod simd;
mod smoke;
#[cfg(target_feature = "simd128")]
mod vgcj;
#[cfg(target_feature = "simd128")]
mod vkernel;

// ---------------------------------------------------------------------------
// Pointer helpers and the feature probe
// ---------------------------------------------------------------------------

/// # Safety
/// `p` must be non-null and aligned, even when `n` is 0, and address `n` valid f64s that nothing writes for `'a`.
unsafe fn r<'a>(p: *const f64, n: usize) -> &'a [f64] {
    unsafe { core::slice::from_raw_parts(p, n) }
}

/// # Safety
/// `p` must be non-null and aligned, even when `n` is 0, and address `n` valid f64s that nothing else accesses
/// for `'a`.
unsafe fn w<'a>(p: *mut f64, n: usize) -> &'a mut [f64] {
    unsafe { core::slice::from_raw_parts_mut(p, n) }
}

/// 1 when built with simd128, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn simd_enabled() -> u32 {
    cfg!(target_feature = "simd128") as u32
}

// ---------------------------------------------------------------------------
// Transverse Mercator batch exports (lon0 in degrees)
// ---------------------------------------------------------------------------

fn run_forward(lon: &[f64], lat: &[f64], x: &mut [f64], y: &mut [f64], k: &kernel::K) {
    #[cfg(target_feature = "simd128")]
    vkernel::forward_batch(lon, lat, x, y, k);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..lon.len() {
        (x[i], y[i]) = kernel::skernel::forward(lon[i], lat[i], k);
    }
}

fn run_inverse(x: &[f64], y: &[f64], lon: &mut [f64], lat: &mut [f64], k: &kernel::K) {
    #[cfg(target_feature = "simd128")]
    vkernel::inverse_batch(x, y, lon, lat, k);
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..x.len() {
        (lon[i], lat[i]) = kernel::skernel::inverse(x[i], y[i], k);
    }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tm_forward_batch(
    lonp: *const f64,
    latp: *const f64,
    xp: *mut f64,
    yp: *mut f64,
    n: usize,
    lon0: f64,
    k0: f64,
    feast: f64,
    fnorth: f64,
    a: f64,
    f: f64,
) {
    let k = kernel::make_k_tm(a, f, lon0, k0, feast, fnorth);
    unsafe { run_forward(r(lonp, n), r(latp, n), w(xp, n), w(yp, n), &k) }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tm_inverse_batch(
    xp: *const f64,
    yp: *const f64,
    lonp: *mut f64,
    latp: *mut f64,
    n: usize,
    lon0: f64,
    k0: f64,
    feast: f64,
    fnorth: f64,
    a: f64,
    f: f64,
) {
    let k = kernel::make_k_tm(a, f, lon0, k0, feast, fnorth);
    unsafe { run_inverse(r(xp, n), r(yp, n), w(lonp, n), w(latp, n), &k) }
}

// ---------------------------------------------------------------------------
// GCJ-02 batch exports (passthrough mode; simd128 only, so a scalar build
// falls back to the JavaScript kernel)
// ---------------------------------------------------------------------------

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn gcj_forward_batch(
    lonp: *const f64,
    latp: *const f64,
    olonp: *mut f64,
    olatp: *mut f64,
    n: usize,
) {
    unsafe { vgcj::forward_batch(r(lonp, n), r(latp, n), w(olonp, n), w(olatp, n)) }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn gcj_inverse_batch(
    lonp: *const f64,
    latp: *const f64,
    olonp: *mut f64,
    olatp: *mut f64,
    n: usize,
) {
    unsafe { vgcj::inverse_batch(r(lonp, n), r(latp, n), w(olonp, n), w(olatp, n)) }
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // Trap in every wasm variant (both simd and scalar): exhaustion and
    // assertion panics must surface as a catchable RuntimeError, not hang the
    // host (the scalar build used to spin here). Native non-test builds keep
    // a loop so the handler compiles off-target (cargo check --release).
    #[cfg(target_arch = "wasm32")]
    core::arch::wasm32::unreachable();
    #[cfg(not(target_arch = "wasm32"))]
    loop {}
}

#[cfg(test)]
mod tests;
