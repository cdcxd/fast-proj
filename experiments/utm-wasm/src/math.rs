//! Shared constants: vector-math polynomial coefficients (mpmath Chebyshev
//! fits at 60 dps, rounded to double; regenerate with tools/gen_coeffs.py)
//! and Cody-Waite / range-reduction constants (fdlibm bit patterns).

/// sin(r) = r + r^3 S(r^2), |r| <= pi/4; fit error 4.5e-18
pub(crate) const S: [f64; 8] = [-1.66666666666666657e-01, 8.33333333333333322e-03, -1.98412698412698385e-04, 2.75573192239810983e-06, -2.50521083823900359e-08, 1.60590427810860551e-10, -7.64696135209432330e-13, 2.79124424334719756e-15];
/// cos(r) = 1 + r^2 C(r^2), |r| <= pi/4; fit error 8.9e-19
pub(crate) const C: [f64; 10] = [-5.00000000000000000e-01, 4.16666666666666644e-02, -1.38888888888888894e-03, 2.48015873015873016e-05, -2.75573192239858830e-07, 2.08767569878650065e-09, -1.14707455965908374e-11, 4.77947707261002709e-14, -1.56188488172443161e-16, 4.08296565861687673e-19];
/// exp(r) = 1 + r + r^2 E(r), |r| <= 0.3466; fit error 2.8e-19
pub(crate) const E: [f64; 11] = [5.00000000000000000e-01, 1.66666666666666713e-01, 4.16666666666666713e-02, 8.33333333332613585e-03, 1.38888888888837503e-03, 1.98412698748158344e-04, 2.48015873255443207e-05, 2.75572554062850442e-06, 2.75572736474510872e-07, 2.51052144747514130e-08, 2.09146851614180674e-09];
/// log(m) = 2s + 2s^3 L(s^2), s = (m-1)/(m+1), |s| <= 0.1716; fit error 1.9e-19
pub(crate) const L: [f64; 9] = [3.33333333333333315e-01, 1.99999999999999956e-01, 1.42857142857176794e-01, 1.11111111099293669e-01, 9.09090929682838111e-02, 7.69228756616504861e-02, 6.66781933491991108e-02, 5.84406182143155511e-02, 5.94099860148072922e-02];
/// atan(u) = u + u^3 P(u^2), |u| <= tan(pi/8); fit error 1.5e-18
pub(crate) const AT: [f64; 13] = [-3.33333333333333315e-01, 1.99999999999999928e-01, -1.42857142857115177e-01, 1.11111111107547289e-01, -9.09090906700999041e-02, 7.69230673600017345e-02, -6.66664202005516626e-02, 5.88192525319286355e-02, -5.25804155429777931e-02, 4.71939503002743316e-02, -4.10443626575508203e-02, 3.06357041129694981e-02, -1.39182292910244292e-02];

pub(crate) const TWO_OVER_PI: f64 = f64::from_bits(0x3FE45F306DC9C883);
pub(crate) const PIO2_1: f64 = f64::from_bits(0x3FF921FB54400000);
pub(crate) const PIO2_1T: f64 = f64::from_bits(0x3DD0B4611A626331);
pub(crate) const PIO2_2T: f64 = f64::from_bits(0x3BA3198A2E037073);
pub(crate) const TAN_PI_8: f64 = f64::from_bits(0x3FDA827999FCEF34);
pub(crate) const PI_4: f64 = f64::from_bits(0x3FE921FB54442D18);
pub(crate) const PI_8: f64 = f64::from_bits(0x3FD921FB54442D18);
pub(crate) const PI_2: f64 = f64::from_bits(0x3FF921FB54442D18);
pub(crate) const M_PI: f64 = f64::from_bits(0x400921FB54442D18);
pub(crate) const SQRT2: f64 = f64::from_bits(0x3FF6A09E667F3BCD);
pub(crate) const LN2_HI: f64 = f64::from_bits(0x3FE62E42FEE00000);
pub(crate) const LOG2E: f64 = f64::from_bits(0x3FF71547652B82FE);
pub(crate) const LN2_LO: f64 = f64::from_bits(0x3DEA39EF35793C76);

/// Proven scalar implementations (musl port) for the scalar wasm build and
/// as a cross-check for the hand-written vector math.
pub mod scalar {
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
