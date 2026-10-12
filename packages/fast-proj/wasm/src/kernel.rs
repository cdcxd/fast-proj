//! UTM series construction and the scalar (libm-backed) kernel — a
//! formula-for-formula port of `packages/utm/src/utm.ts` @ bb3620d and the
//! bit-exact reference for the f64x2 twin in `vkernel.rs`.
//!
//! Math: C. F. Karney, "Transverse Mercator with an accuracy of a few
//! nanometers", J. Geodesy 85 (2011) 475-485, doi:10.1007/s00190-011-0445-3.
//! - forward: conformal latitude, then xi'/eta' (Eq. 10), Krüger series
//!   (Eq. 11), scaling (Eq. 13) — easting ~ eta', northing ~ xi';
//! - inverse: Eqs. (15)-(16), then geodetic latitude from the conformal one;
//! - `make_k` builds A, alpha, beta from Eqs. (29)/(35)/(36) to order n^6;
//!   the fixed trig series are precomputed there as polynomials equivalent
//!   to Clenshaw summation (see `poly6` and the K fields).
//! As in the TS kernel: conformal latitude via its Fourier series in n (no
//! Newton iteration), double-angle identities and short Taylor expansions of
//! the small corrections (< 4e-3 rad for f < 0.01) replace most transcendental
//! calls. Deviations of the vector twin: PROPOSAL.md and RESULTS.md.
//!
//! Notation (local names follow utm.ts):
//! - `phi`/`lam`: geodetic latitude; longitude offset from the central meridian
//! - `sp cp`/`sc cc`/`sl cl`: sin/cos of phi, of the conformal latitude chi, of lam
//! - `xip`/`etap`: conformal-sphere coordinates xi'/eta'; `she` is Karney's
//!   tau' = sinh(eta'), so `etap = asinh(she)` in its log1p form
//! - `ar ai`: the complex argument of the Krüger series (2*Re/Im of the
//!   double-angle terms); `u1..u4 tr ti` its Clenshaw recurrence and result;
//!   `sr si` rotate the correction back onto xi'/eta'

pub(crate) const D2R: f64 = core::f64::consts::PI / 180.0;
pub(crate) const R2D: f64 = 180.0 / core::f64::consts::PI;
pub(crate) const K0: f64 = 0.9996;
pub(crate) const FALSE_EASTING: f64 = 500000.0;
pub(crate) const FALSE_NORTHING_SOUTH: f64 = 10000000.0;

/// Series coefficients and derived polynomial forms for one zone/ellipsoid.
pub(crate) struct K {
    pub k_a: f64,
    pub inv_k_a: f64,
    pub lon0: f64,
    pub feast: f64,
    pub fnorth: f64,
    pub ap: [f64; 4],
    pub bp: [f64; 4],
    pub cp: [f64; 6], // [cp0, cp1, cp2, cp3, c5, c6]
    pub dp: [f64; 6], // [dp0, dp1, dp2, dp3, d5, d6]
    pub a56: [f64; 2],
    pub b56: [f64; 2],
}

/// Removes whole turns from a longitude outside [-180, 180], exactly (fmod is exact), as the TS kernel does.
/// In radians their rounding error would exceed the forward NaN cutoff.
pub(crate) fn reduce_lon(lon: f64) -> f64 {
    let r = libm::fmod(lon, 360.0);
    if r > 180.0 {
        r - 360.0
    } else if r < -180.0 {
        r + 360.0
    } else {
        r
    }
}

pub(crate) fn make_k(a: f64, f: f64, zone: u32, south: bool) -> K {
    let fnorth = if south { FALSE_NORTHING_SOUTH } else { 0.0 };
    make_k_tm(a, f, (zone as i32 * 6 - 183) as f64, K0, FALSE_EASTING, fnorth)
}

/// General transverse Mercator: central meridian in degrees, scale k0, false easting/northing in metres.
pub(crate) fn make_k_tm(a: f64, f: f64, lon0_deg: f64, k0: f64, feast: f64, fnorth: f64) -> K {
    let n = f / (2.0 - f);
    let n2 = n * n;
    let n3 = n2 * n;
    let n4 = n3 * n;
    let n5 = n4 * n;
    let n6 = n5 * n;
    let big_a = (a / (1.0 + n)) * (1.0 + n2 / 4.0 + n4 / 64.0 + n6 / 256.0);
    let alpha = [
        n / 2.0 - (2.0 * n2) / 3.0 + (5.0 * n3) / 16.0 + (41.0 * n4) / 180.0 - (127.0 * n5) / 288.0 + (7891.0 * n6) / 37800.0,
        (13.0 * n2) / 48.0 - (3.0 * n3) / 5.0 + (557.0 * n4) / 1440.0 + (281.0 * n5) / 630.0 - (1983433.0 * n6) / 1935360.0,
        (61.0 * n3) / 240.0 - (103.0 * n4) / 140.0 + (15061.0 * n5) / 26880.0 + (167603.0 * n6) / 181440.0,
        (49561.0 * n4) / 161280.0 - (179.0 * n5) / 168.0 + (6601661.0 * n6) / 7257600.0,
        (34729.0 * n5) / 80640.0 - (3418889.0 * n6) / 1995840.0,
        (212378941.0 * n6) / 319334400.0,
    ];
    let beta = [
        n / 2.0 - (2.0 * n2) / 3.0 + (37.0 * n3) / 96.0 - n4 / 360.0 - (81.0 * n5) / 512.0 + (96199.0 * n6) / 604800.0,
        n2 / 48.0 + n3 / 15.0 - (437.0 * n4) / 1440.0 + (46.0 * n5) / 105.0 - (1118711.0 * n6) / 3870720.0,
        (17.0 * n3) / 480.0 - (37.0 * n4) / 840.0 - (209.0 * n5) / 4480.0 + (5569.0 * n6) / 90720.0,
        (4397.0 * n4) / 161280.0 - (11.0 * n5) / 504.0 - (830251.0 * n6) / 7257600.0,
        (4583.0 * n5) / 161280.0 - (108847.0 * n6) / 3991680.0,
        (20648693.0 * n6) / 638668800.0,
    ];
    let c = [
        -2.0 * n + (2.0 * n2) / 3.0 + (4.0 * n3) / 3.0 - (82.0 * n4) / 45.0 + (32.0 * n5) / 45.0 + (4642.0 * n6) / 4725.0,
        (5.0 * n2) / 3.0 - (16.0 * n3) / 15.0 - (13.0 * n4) / 9.0 + (904.0 * n5) / 315.0 - (1522.0 * n6) / 945.0,
        (-26.0 * n3) / 15.0 + (34.0 * n4) / 21.0 + (8.0 * n5) / 5.0 - (12686.0 * n6) / 2835.0,
        (1237.0 * n4) / 630.0 - (12.0 * n5) / 5.0 - (24832.0 * n6) / 14175.0,
        (-734.0 * n5) / 315.0 + (109598.0 * n6) / 31185.0,
        (444337.0 * n6) / 155925.0,
    ];
    let d = [
        2.0 * n - (2.0 * n2) / 3.0 - 2.0 * n3 + (116.0 * n4) / 45.0 + (26.0 * n5) / 45.0 - (2854.0 * n6) / 675.0,
        (7.0 * n2) / 3.0 - (8.0 * n3) / 5.0 - (227.0 * n4) / 45.0 + (2704.0 * n5) / 315.0 + (2323.0 * n6) / 945.0,
        (56.0 * n3) / 15.0 - (136.0 * n4) / 35.0 - (1262.0 * n5) / 105.0 + (73814.0 * n6) / 2835.0,
        (4279.0 * n4) / 630.0 - (332.0 * n5) / 35.0 - (399572.0 * n6) / 14175.0,
        (4174.0 * n5) / 315.0 - (144838.0 * n6) / 6237.0,
        (601676.0 * n6) / 22275.0,
    ];
    let k_a = k0 * big_a;
    let [a1, a2, a3, a4, a5, a6] = alpha;
    let [b1, b2, b3, b4, b5, b6] = beta;
    let [c1, c2, c3, c4, c5, c6] = c;
    let [d1, d2, d3, d4, d5, d6] = d;
    K {
        k_a,
        inv_k_a: 1.0 / k_a,
        lon0: lon0_deg * D2R,
        feast,
        fnorth,
        ap: [a1 - a3 + a5, a2 - 2.0 * a4 + 3.0 * a6, a3 - 3.0 * a5, a4 - 4.0 * a6],
        bp: [b1 - b3 + b5, b2 - 2.0 * b4 + 3.0 * b6, b3 - 3.0 * b5, b4 - 4.0 * b6],
        cp: [c1 - c3 + c5, c2 - 2.0 * c4 + 3.0 * c6, c3 - 3.0 * c5, c4 - 4.0 * c6, c5, c6],
        dp: [d1 - d3 + d5, d2 - 2.0 * d4 + 3.0 * d6, d3 - 3.0 * d5, d4 - 4.0 * d6, d5, d6],
        a56: [a5, a6],
        b56: [b5, b6],
    }
}

// The SIMD build uses vkernel; this scalar kernel serves the scalar build and the host tests.
#[cfg(not(target_feature = "simd128"))]
pub(crate) mod skernel {
    use super::*;

    pub fn forward(mut lon_deg: f64, lat_deg: f64, k: &K) -> (f64, f64) {
        // -- geodetic -> conformal latitude chi: the Fourier series (in n)
        //    yields only the small difference dchi; sd/cd come from a short
        //    Taylor run, then sc/cc = sin/cos chi by angle addition
        let phi = lat_deg * D2R;
        if lon_deg > 180.0 || lon_deg < -180.0 {
            lon_deg = reduce_lon(lon_deg);
        }
        let lam = lon_deg * D2R - k.lon0;
        let sp = libm::sin(phi);
        let cp = libm::cos(phi);
        let p = 2.0 - 4.0 * sp * sp;
        let q1 = poly6(p, &k.cp);
        let dchi = 2.0 * sp * cp * q1;
        let dd = dchi * dchi;
        let sd = dchi * (1.0 + dd * (-1.0 / 6.0 + dd / 120.0));
        let cd = 1.0 + dd * (-0.5 + dd / 24.0);
        let sc = sp * cd + cp * sd;
        let cc = cp * cd - sp * sd;
        // -- (chi, lam) -> conformal-sphere xi'/eta', Eq. (10); NaN beyond
        //    |lam| >= 90° where cos(lam) collapses (TS kernel guard)
        let sl = libm::sin(lam);
        let cl = libm::cos(lam);
        if !(cl > 1e-15) {
            return (f64::NAN, f64::NAN);
        }
        let ccl = cc * cl;
        let sc2 = sc * sc;
        let ccl2 = ccl * ccl;
        let ir = 1.0 / libm::sqrt(sc2 + ccl2);
        let xip = if ccl > 0.0 { libm::atan(sc / ccl) } else { libm::atan2(sc, ccl) };
        let she = cc * sl * ir;
        let etap = if she > -1024.0 && she < 1024.0 {
            libm::log1p(she + (she * she) / (ir + 1.0))
        } else {
            libm::asinh(she)
        };
        // -- Krüger series, Eq. (11): complex Clenshaw recurrence over
        //    (ar, ai) with the alpha coefficients, then rotate the correction
        //    back onto (etap, xip) and scale, Eq. (13)
        let ir2 = ir * ir;
        let s2 = 2.0 * sc * ccl * ir2;
        let c2x = (ccl2 - sc2) * ir2;
        let ch = ir2 + she * she;
        let sh = 2.0 * she * ir;
        let ar = 2.0 * c2x * ch;
        let ai = -2.0 * s2 * sh;
        let rho = ar * ar + ai * ai;
        let twice_ar = 2.0 * ar;
        let u4 = k.a56[0] + twice_ar * k.a56[1];
        let u3 = k.ap[3] + twice_ar * u4 - rho * k.a56[1];
        let u2 = k.ap[2] + twice_ar * u3 - rho * u4;
        let u1 = k.ap[1] + twice_ar * u2 - rho * u3;
        let tr = k.ap[0] + ar * u1 - rho * u2;
        let ti = ai * u1;
        let sr = s2 * ch;
        let si = c2x * sh;
        (
            k.feast + k.k_a * (etap + tr * si + ti * sr),
            k.fnorth + k.k_a * (xip + tr * sr - ti * si),
        )
    }

    pub fn inverse(x: f64, y: f64, k: &K) -> (f64, f64) {
        // -- strip the false origin and the k0*A scale: (xi, eta)
        let xi = (y - k.fnorth) * k.inv_k_a;
        let eta = (x - k.feast) * k.inv_k_a;
        // -- complex sinh/cosh of (xi + i eta): s1/c1x from xi, ch1/sh1 from eta
        let s1 = libm::sin(xi);
        let c1x = libm::cos(xi);
        let e = libm::exp(eta);
        let ie = 1.0 / e;
        let ch1 = 0.5 * (e + ie);
        let sh1 = 0.5 * (e - ie);
        let s2 = 2.0 * s1 * c1x;
        let c2x = c1x * c1x - s1 * s1;
        let ch = ch1 * ch1 + sh1 * sh1;
        let sh = 2.0 * sh1 * ch1;
        // -- Krüger series, Eqs. (15)-(16): complex Clenshaw with the beta
        //    coefficients gives the corrections (dxi, deta)
        let ar = 2.0 * c2x * ch;
        let ai = -2.0 * s2 * sh;
        let rho = ar * ar + ai * ai;
        let twice_ar = 2.0 * ar;
        let u4 = k.b56[0] + twice_ar * k.b56[1];
        let u3 = k.bp[3] + twice_ar * u4 - rho * k.b56[1];
        let u2 = k.bp[2] + twice_ar * u3 - rho * u4;
        let u1 = k.bp[1] + twice_ar * u2 - rho * u3;
        let tr = k.bp[0] + ar * u1 - rho * u2;
        let ti = ai * u1 + 0.0; // retains the Clenshaw +0 sign at the equator
        let sr = s2 * ch;
        let si = c2x * sh;
        let dxi = tr * sr - ti * si;
        let deta = tr * si + ti * sr;
        // -- undo the (xi + dxi, eta + deta) split: angle/hyperbolic addition
        //    (short Taylor again) returns to (lam, chi) with the TS guards on
        //    the atan sites
        let dx2 = dxi * dxi;
        let sdx = dxi * (1.0 + dx2 * (-1.0 / 6.0 + dx2 / 120.0));
        let cdx = 1.0 + dx2 * (-0.5 + dx2 / 24.0);
        let de2 = deta * deta;
        let shd = deta * (1.0 + de2 * (1.0 / 6.0 + de2 / 120.0));
        let chd = 1.0 + de2 * (0.5 + de2 / 24.0);
        let sx = s1 * cdx - c1x * sdx;
        let cx = c1x * cdx + s1 * sdx;
        let she = sh1 * chd - ch1 * shd;
        let h2 = she * she + cx * cx;
        let h = libm::sqrt(h2);
        let lam = if cx > 0.0 && she.is_finite() {
            libm::atan(she / cx)
        } else {
            libm::atan2(she, cx)
        };
        let chi = if h > 0.0 && sx.is_finite() {
            libm::atan(sx / h)
        } else {
            libm::atan2(sx, h)
        };
        // -- conformal -> geodetic latitude: the inverse Fourier series in n
        //    (fromConformal), same polynomial form as the forward direction
        let sx2 = sx * sx;
        let r2 = sx2 + h2;
        let p = (2.0 * (h2 - sx2)) / r2;
        let q1 = poly6(p, &k.dp);
        let phi = chi + ((2.0 * sx * h) / r2) * q1;
        let mut lon = (k.lon0 + lam) * R2D;
        if lon > 180.0 {
            lon -= 360.0;
        } else if lon < -180.0 {
            lon += 360.0;
        }
        (lon, phi * R2D)
    }

    fn poly6(p: f64, c: &[f64; 6]) -> f64 {
        let mut r = c[4] + p * c[5];
        r = c[3] + p * r;
        r = c[2] + p * r;
        r = c[1] + p * r;
        c[0] + p * r
    }
}
