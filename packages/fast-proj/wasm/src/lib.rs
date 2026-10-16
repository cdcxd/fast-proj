//! Crate root: module wiring and the C-ABI surface (math smoke exports and
//! the UTM batch exports with scalar/simd dispatch).
//!
//! Layout: `math` (coefficients/constants + libm scalar wrappers), `simd`
//! (f64x2 vector math, +simd128 only), `kernel` (UTM series + scalar
//! kernel), `vkernel` (f64x2 kernel, +simd128 only), `gcj` (GCJ-02 constants
//! and scalar reference), `vgcj` (f64x2 GCJ-02 kernel, +simd128 only),
//! `alloc` (bump arena).
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
#[cfg(target_feature = "simd128")]
mod vgcj;
#[cfg(target_feature = "simd128")]
mod vkernel;

// ---------------------------------------------------------------------------
// Math smoke exports
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

#[unsafe(no_mangle)]
pub extern "C" fn noop() {}

/// 1 when built with simd128, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn simd_enabled() -> u32 {
    cfg!(target_feature = "simd128") as u32
}

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

// ---------------------------------------------------------------------------
// UTM batch exports
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
pub unsafe extern "C" fn forward_batch(
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
    let k = kernel::make_k(a, f, zone, south != 0);
    unsafe { run_forward(r(lonp, n), r(latp, n), w(xp, n), w(yp, n), &k) }
}

/// # Safety
/// Each pointer must be non-null and aligned, even when `n` is 0, and address `n` valid f64s; outputs must not
/// overlap any other buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inverse_batch(
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
    let k = kernel::make_k(a, f, zone, south != 0);
    unsafe { run_inverse(r(xp, n), r(yp, n), w(lonp, n), w(latp, n), &k) }
}

// ---------------------------------------------------------------------------
// General transverse Mercator batch exports (lon0 in degrees)
// ---------------------------------------------------------------------------

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
        assert_eq!(k.lon0.to_bits(), (15.0 * D2R).to_bits());
        assert_eq!(k.fnorth, 0.0);
        let ks = make_k(a, f, 31, true);
        assert_eq!(ks.fnorth, FALSE_NORTHING_SOUTH);
        assert_eq!(ks.lon0.to_bits(), (3.0 * D2R).to_bits());
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

    fn gcj_fixture(key: &str) -> Vec<(f64, f64, f64, f64)> {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/gcj02.json"
        ))
        .expect("fixture file");
        let v: serde_json::Value = serde_json::from_str(&raw).expect("fixture json");
        v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let f = |i: usize| {
                    p[i].as_f64()
                        .or_else(|| p[i].as_str().and_then(|s| s.parse().ok()))
                        .unwrap()
                };
                (f(0), f(1), f(2), f(3))
            })
            .collect()
    }

    fn gcj_max_error(rows: &[(f64, f64, f64, f64)], g: impl Fn(f64, f64) -> (f64, f64)) -> f64 {
        rows.iter().fold(0.0, |m, &(lon, lat, rlon, rlat)| {
            let (l, p) = g(lon, lat);
            assert!(l.is_finite() && p.is_finite(), "non-finite result at {lon}, {lat}");
            m.max((l - rlon).abs() * lat.to_radians().cos())
                .max((p - rlat).abs())
        })
    }

    #[test]
    fn gcj_constants_match_libm() {
        use crate::gcj::*;
        let ulp = |a: f64, b: f64| (a.to_bits() as i64 - b.to_bits() as i64).abs();
        assert!(ulp(S35, (35.0 * KY).sin()) <= 1);
        assert!(ulp(C35, (35.0 * KY).cos()) <= 1);
        assert_eq!(KLAT.to_bits(), 0x3EE2F735B2FADDE1);
        assert_eq!(KLON.to_bits(), 0x3EE2D6B638479C2D);
        assert_eq!(KX.to_bits(), 0x3FAACEE9F37BEBD5);
    }

    #[test]
    fn gcj_scalar_matches_reference_fixture() {
        use crate::gcj::sgcj;
        let f = gcj_max_error(&gcj_fixture("fromWgs84"), sgcj::forward);
        let i = gcj_max_error(&gcj_fixture("toWgs84"), sgcj::inverse);
        assert!(f < 2e-14, "forward {f:e}");
        assert!(i < 2e-11, "inverse {i:e}");
    }

    #[test]
    fn gcj_scalar_passthrough() {
        use crate::gcj::sgcj;
        assert_eq!(sgcj::forward(10.0, 50.0), (10.0, 50.0));
        assert_eq!(
            sgcj::inverse(476.391, 39.907).0.to_bits(),
            sgcj::inverse(476.391 - 360.0, 39.907).0.to_bits()
        );
        assert_eq!(sgcj::forward(400.0, 10.0), (40.0, 10.0));
        let (l, p) = sgcj::forward(f64::NAN, 30.0);
        assert!(l.is_nan() && p == 30.0);
    }
}
