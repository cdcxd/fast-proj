//! Host unit tests (target-independent logic; the f64x2 paths are gated by the JS suites bench/sweeps.mts and
//! bench/checks.mts against the artifact).

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
    assert!(i < 3e-12, "inverse {i:e}");
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
