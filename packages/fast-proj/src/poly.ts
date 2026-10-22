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
