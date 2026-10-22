// fdlibm __kernel_sin / __kernel_cos coefficients, for |x| <= pi/4: sin x = x + x z S(z), cos x = 1 - z/2 + z^2 C(z)
// with z = x^2, the cos without fdlibm's correction term (about 1.2 ulp; the tmerc forward compensates 1 - z/2). The
// kernels apply them to half angles and double: sin 2x = 2 sin x cos x is within a few ulp; cos 2x = (cos x - sin x)
// (cos x + sin x) within a few 1e-16 absolute, so not relatively accurate near +-pi/2, where callers use it only in
// sums, start from the complement or fall back to Math.
export const KS1 = -1.66666666666666324348e-1,
  KS2 = 8.33333333332248946124e-3,
  KS3 = -1.98412698298579493134e-4,
  KS4 = 2.75573137070700676789e-6,
  KS5 = -2.50507602534068634195e-8,
  KS6 = 1.58969099521155010221e-10;
export const KC1 = 4.16666666666666019037e-2,
  KC2 = -1.38888888888741095749e-3,
  KC3 = 2.48015872894767294178e-5,
  KC4 = -2.75573143513906633035e-7,
  KC5 = 2.0875723212981748279e-9,
  KC6 = -1.13596475577881948265e-11;

// atan(u) = u + u^3 A(u^2), |u| <= tan(pi/8), within 1.6 ulp (atanQ within 2.3 with its reduction); exp(r) = 1 + r +
// r^2 E(r), |r| <= ln 2 / 2 (a few ulp beyond, from the Web Mercator reduction), expm1(r) within 1.2 ulp:
// least-squares fits on Chebyshev nodes, shorter than the wasm kernels' (wasm/src/math.rs).
export const KA0 = -0.3333333333333325,
  KA1 = 0.19999999999901275,
  KA2 = -0.14285714266539506,
  KA3 = 0.11111109662900268,
  KA4 = -0.09090853344129342,
  KA5 = 0.07691068361407245,
  KA6 = -0.06649743882366685,
  KA7 = 0.05737080629289906,
  KA8 = -0.04485655846626989,
  KA9 = 0.022780530526983894;
export const KE0 = 0.5000000000000001,
  KE1 = 0.1666666666666667,
  KE2 = 0.04166666666662416,
  KE3 = 0.008333333333326141,
  KE4 = 0.0013888888917198588,
  KE5 = 0.00019841269874802173,
  KE6 = 2.4801521319879672e-5,
  KE7 = 2.755725542387984e-6,
  KE8 = 2.762007691611333e-7,
  KE9 = 2.510520706464424e-8;
export const TAN_PI_8 = 0.41421356237309503;

const PI_8 = Math.PI / 8;
const PI_2 = Math.PI / 2;

/** atan(n / d) for d > 0 and finite n, with one division: the quotient and the pi/8 reduction share it. */
export function atanQ(n: number, d: number): number {
  const a = Math.abs(n);
  const num = a < d ? a : d;
  const den = a < d ? d : a;
  let nn = num;
  let dd = den;
  let g = 0;
  if (num > den * TAN_PI_8) {
    nn = num - den * TAN_PI_8;
    dd = den + num * TAN_PI_8;
    g = PI_8;
  }
  const u = nn / dd;
  const t = u * u;
  const t2 = t * t;
  const ae = KA0 + t2 * (KA2 + t2 * (KA4 + t2 * (KA6 + t2 * KA8)));
  const ao = KA1 + t2 * (KA3 + t2 * (KA5 + t2 * (KA7 + t2 * KA9)));
  const r = g + (u + u * t * (ae + t * ao));
  // n = -0 keeps its sign.
  return (a < d ? r : PI_2 - r) * Math.sign(n);
}
