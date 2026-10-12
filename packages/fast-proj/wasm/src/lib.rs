//! Crate root: module wiring and the C-ABI surface (math smoke exports and
//! the UTM batch exports with scalar/simd dispatch).
//!
//! Layout: `math` (coefficients/constants + libm scalar wrappers), `simd`
//! (f64x2 vector math, +simd128 only), `kernel` (UTM series + scalar
//! kernel), `vkernel` (f64x2 kernel, +simd128 only), `alloc` (bump arena).
#![cfg_attr(not(test), no_std)]
#![allow(unsafe_op_in_unsafe_fn)]
#![allow(static_mut_refs)]

#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

mod alloc;
mod kernel;
mod math;
#[cfg(target_feature = "simd128")]
mod simd;
#[cfg(target_feature = "simd128")]
mod vkernel;

// ---------------------------------------------------------------------------
// Math smoke exports
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn noop() {}

/// 1 when built with simd128, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn simd_enabled() -> u32 {
    cfg!(target_feature = "simd128") as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn copy_f64(dst: *mut f64, src: *const f64, n: usize) {
    unsafe { core::ptr::copy_nonoverlapping(src, dst, n) }
}

#[unsafe(no_mangle)]
pub extern "C" fn sincos_batch(inp: *const f64, s_out: *mut f64, c_out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            let x = simd::load_pair(inp, i, n);
            let (s, c) = simd::vsincos(x);
            simd::store_pair(s, s_out, i, n);
            simd::store_pair(c, c_out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        let (s, c) = math::scalar::sincos(unsafe { *inp.add(i) });
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
            simd::store_pair(simd::vatan(simd::load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = math::scalar::atan(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}

#[unsafe(no_mangle)]
pub extern "C" fn exp_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            simd::store_pair(simd::vexp(simd::load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = math::scalar::exp(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}


#[unsafe(no_mangle)]
pub extern "C" fn atan2_batch(yp: *const f64, xp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            let y = simd::load_pair(yp, i, n);
            let x = simd::load_pair(xp, i, n);
            simd::store_pair(simd::vatan2(y, x), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = libm::atan2(*yp.add(i), *xp.add(i)) }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn log_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            simd::store_pair(simd::vlog(simd::load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = math::scalar::log(*inp.add(i)) }
    }
    let _ = (inp, out, n);
}

/// Math-smoke export for the guarded log1p paths and odd tails.
#[unsafe(no_mangle)]
pub extern "C" fn log1p_batch(inp: *const f64, out: *mut f64, n: usize) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        let mut i = 0;
        while i < n {
            simd::store_pair(simd::vlog1p(simd::load_pair(inp, i, n)), out, i, n);
            i += 2;
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        unsafe { *out.add(i) = libm::log1p(*inp.add(i)) }
    }
}

// ---------------------------------------------------------------------------
// UTM batch exports
// ---------------------------------------------------------------------------

fn run_forward(lonp: *const f64, latp: *const f64, xp: *mut f64, yp: *mut f64, n: usize, k: &kernel::K) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        vkernel::forward_batch(lonp, latp, xp, yp, n, k);
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        let (x, y) = kernel::skernel::forward(unsafe { *lonp.add(i) }, unsafe { *latp.add(i) }, k);
        unsafe {
            *xp.add(i) = x;
            *yp.add(i) = y;
        }
    }
}

fn run_inverse(xp: *const f64, yp: *const f64, lonp: *mut f64, latp: *mut f64, n: usize, k: &kernel::K) {
    #[cfg(target_feature = "simd128")]
    unsafe {
        vkernel::inverse_batch(xp, yp, lonp, latp, n, k);
    }
    #[cfg(not(target_feature = "simd128"))]
    for i in 0..n {
        let (lon, lat) = kernel::skernel::inverse(unsafe { *xp.add(i) }, unsafe { *yp.add(i) }, k);
        unsafe {
            *lonp.add(i) = lon;
            *latp.add(i) = lat;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn forward_batch(
    lonp: *const f64,
    latp: *const f64,
    xp: *mut f64,
    yp: *mut f64,
    n: usize,
    zone: u32,
    south: u32,
    a: f64,
    f: f64,
) {
    run_forward(lonp, latp, xp, yp, n, &kernel::make_k(a, f, zone, south != 0));
}

#[unsafe(no_mangle)]
pub extern "C" fn inverse_batch(
    xp: *const f64,
    yp: *const f64,
    lonp: *mut f64,
    latp: *mut f64,
    n: usize,
    zone: u32,
    south: u32,
    a: f64,
    f: f64,
) {
    run_inverse(xp, yp, lonp, latp, n, &kernel::make_k(a, f, zone, south != 0));
}

// ---------------------------------------------------------------------------
// General transverse Mercator batch exports (lon0 in degrees)
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn tm_forward_batch(
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
    run_forward(lonp, latp, xp, yp, n, &kernel::make_k_tm(a, f, lon0, k0, feast, fnorth));
}

#[unsafe(no_mangle)]
pub extern "C" fn tm_inverse_batch(
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
    run_inverse(xp, yp, lonp, latp, n, &kernel::make_k_tm(a, f, lon0, k0, feast, fnorth));
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // Trap in every wasm variant (both simd and scalar): exhaustion and
    // assertion panics must surface as a catchable RuntimeError, not hang the
    // host (the scalar build used to spin here). Native non-test builds keep
    // a loop so the handler compiles off-target (cargo check --release).
    #[cfg(target_arch = "wasm32")]
    unsafe {
        core::arch::wasm32::unreachable()
    }
    #[cfg(not(target_arch = "wasm32"))]
    loop {}
}

// ---------------------------------------------------------------------------
// Host unit tests (target-independent logic; the f64x2 paths are gated by
// the JS suites bench/sweeps.mjs and bench/checks.mjs against the artifact)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use crate::kernel::{make_k, skernel, D2R, FALSE_NORTHING_SOUTH};
    use crate::math::*;
    use std::f64::consts::{LN_2, PI};

    fn wgs84() -> (f64, f64) {
        (6378137.0, 1.0 / 298.257223563)
    }

    #[test]
    fn constants_decode_to_computed_values() {
        assert_eq!(PI_8.to_bits(), (PI / 8.0).to_bits());
        assert_eq!(PI_2.to_bits(), (PI / 2.0).to_bits());
        assert_eq!(SQRT2.to_bits(), 2.0f64.sqrt().to_bits());
        assert_eq!(TAN_PI_8.to_bits(), (2.0f64.sqrt() - 1.0).to_bits());
        assert_eq!(TWO_OVER_PI.to_bits(), (2.0 / PI).to_bits());
        assert_eq!(LOG2E.to_bits(), (1.0 / LN_2).to_bits());
        assert!((LN2_HI + LN2_LO - LN_2).abs() < 1e-24);
    }

    #[test]
    fn series_sanity() {
        let (a, f) = wgs84();
        let k = make_k(a, f, 33, false);
        assert!((6364900.0..=6364910.0).contains(&k.k_a), "kA {}", k.k_a);
        assert_eq!(k.lon0, 15.0);
        assert_eq!(k.fnorth, 0.0);
        let ks = make_k(a, f, 31, true);
        assert_eq!(ks.fnorth, FALSE_NORTHING_SOUTH);
        assert_eq!(ks.lon0, 3.0);
        // sphere: every series term is zero
        let ks0 = make_k(1.0, 0.0, 33, false);
        assert_eq!(ks0.ap.iter().sum::<f64>(), 0.0);
        assert_eq!(ks0.bp.iter().sum::<f64>(), 0.0);
        assert_eq!(ks0.cp.iter().sum::<f64>(), 0.0);
        assert_eq!(ks0.dp.iter().sum::<f64>(), 0.0);
    }

    fn fixture() -> Vec<(f64, f64, f64, f64)> {
        // (lon, lat, x, y) — zone 31 (CM 3°E), WGS84, k0 = 0.9996; decimal
        // strings carry the full independent reference precision
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/reference.json"
        ))
        .expect("fixture file");
        let v: serde_json::Value = serde_json::from_str(&raw).expect("fixture json");
        v["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    3.0 + p["dlon"].as_f64().unwrap(),
                    p["lat"].as_f64().unwrap(),
                    p["x"].as_str().unwrap().parse().unwrap(),
                    p["y"].as_str().unwrap().parse().unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn scalar_forward_matches_reference_fixture() {
        let (a, f) = wgs84();
        let k = make_k(a, f, 31, false);
        let mut max_dx = 0.0f64;
        let mut max_dy = 0.0f64;
        for (lon, lat, x, y) in fixture() {
            let (gx, gy) = skernel::forward(lon, lat, &k);
            if !gx.is_finite() {
                continue; // out-of-domain fixture rows
            }
            max_dx = max_dx.max((gx - x).abs());
            max_dy = max_dy.max((gy - y).abs());
        }
        assert!(max_dx < 5e-9, "max dx {max_dx:e}");
        assert!(max_dy < 5e-9, "max dy {max_dy:e}");
    }

    #[test]
    fn scalar_inverse_matches_reference_fixture() {
        let (a, f) = wgs84();
        let k = make_k(a, f, 31, false);
        let mut max_dl = 0.0f64;
        let mut max_dt = 0.0f64;
        for (lon, lat, x, y) in fixture() {
            let (glon, glat) = skernel::inverse(x, y, &k);
            if !glon.is_finite() {
                continue;
            }
            // circular distance; longitude error scales with sec(lat), so the
            // repo fixture test weights by cos(lat) the same way
            let dl = (glon - lon + 180.0).rem_euclid(360.0) - 180.0;
            let dl = dl * lat.to_radians().cos();
            max_dl = max_dl.max(dl.abs());
            max_dt = max_dt.max((glat - lat).abs());
        }
        assert!(max_dl < 1e-13, "max dlon {max_dl:e}");
        assert!(max_dt < 1e-13, "max dlat {max_dt:e}");
    }

    #[test]
    fn forward_guard_nan_beyond_90_degrees() {
        let (a, f) = wgs84();
        let k = make_k(a, f, 31, false);
        let (x, y) = skernel::forward(3.0 - 90.0, 10.0, &k);
        assert!(x.is_nan() && y.is_nan());
        let (x, y) = skernel::forward(3.0 - 89.9999999, 10.0, &k);
        assert!(x.is_finite() && y.is_finite());
    }

    #[test]
    fn scalar_kernel_sphere_and_flattening_edges() {
        for f in [0.0, 0.005, 0.0099999] {
            let k = make_k(6378137.0, f, 33, false);
            let (x, y) = skernel::forward(15.0, 60.0, &k);
            assert!(x.is_finite() && y.is_finite());
            let (lon, lat) = skernel::inverse(x, y, &k);
            assert!((lon - 15.0).abs() < 1e-11, "f {f}: lon {lon}");
            assert!((lat - 60.0).abs() < 1e-11, "f {f}: lat {lat}");
        }
    }
}

