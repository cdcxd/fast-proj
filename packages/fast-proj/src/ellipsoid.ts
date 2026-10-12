export interface Ellipsoid {
  /** Semi-major axis in metres. */
  readonly a: number;
  /** Flattening, `0 <= f < 0.01`. */
  readonly f: number;
}

export const WGS84: Ellipsoid = Object.freeze({ a: 6378137, f: 1 / 298.257223563 });
export const GRS80: Ellipsoid = Object.freeze({ a: 6378137, f: 1 / 298.257222101 });

/**
 * Largest supported flattening. The small-angle expansions in `utm.ts` are exact to double precision only for
 * terrestrial flattenings (Earth: 0.0034).
 */
export const MAX_FLATTENING = 0.01;

export function checkEllipsoid({ a, f }: Ellipsoid): void {
  if (!(a > 0 && a < Infinity)) throw new RangeError(`ellipsoid.a must be a positive finite number, got ${a}`);
  if (!(f >= 0 && f < MAX_FLATTENING)) {
    throw new RangeError(`ellipsoid.f must satisfy 0 <= f < ${MAX_FLATTENING}, got ${f}`);
  }
}

export type Series6 = readonly [number, number, number, number, number, number];

export interface TmSeries {
  /** Rectifying radius, Karney (2011) Eq. (29). */
  A: number;
  /** Conformal sphere -> projected, Karney (2011) Eq. (35). */
  alpha: Series6;
  /** Projected -> conformal sphere, Karney (2011) Eq. (36). */
  beta: Series6;
  /** Geodetic -> conformal latitude, chi = phi + sum c_k sin(2k phi). */
  toConformal: Series6;
  /** Conformal -> geodetic latitude, phi = chi + sum d_k sin(2k chi). */
  fromConformal: Series6;
}

/**
 * Series coefficients for the transverse Mercator projection, 6th order in the third flattening n.
 *
 * - C. F. F. Karney, Transverse Mercator with an accuracy of a few nanometers, J. Geodesy 85 (2011) 475-485,
 *   https://doi.org/10.1007/s00190-011-0445-3 (A, alpha, beta).
 * - C. F. F. Karney, On auxiliary latitudes, Survey Review 56 (2024) 165-180,
 *   https://doi.org/10.1080/00396265.2023.2217604 (conformal latitude series).
 */
export function tmSeries({ a, f }: Ellipsoid): TmSeries {
  const n = f / (2 - f);
  const n2 = n * n,
    n3 = n2 * n,
    n4 = n3 * n,
    n5 = n4 * n,
    n6 = n5 * n;
  return {
    A: (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256),
    alpha: [
      n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
      (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
      (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
      (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
      (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
      (212378941 * n6) / 319334400,
    ],
    beta: [
      n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
      n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
      (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
      (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
      (4583 * n5) / 161280 - (108847 * n6) / 3991680,
      (20648693 * n6) / 638668800,
    ],
    toConformal: [
      -2 * n + (2 * n2) / 3 + (4 * n3) / 3 - (82 * n4) / 45 + (32 * n5) / 45 + (4642 * n6) / 4725,
      (5 * n2) / 3 - (16 * n3) / 15 - (13 * n4) / 9 + (904 * n5) / 315 - (1522 * n6) / 945,
      (-26 * n3) / 15 + (34 * n4) / 21 + (8 * n5) / 5 - (12686 * n6) / 2835,
      (1237 * n4) / 630 - (12 * n5) / 5 - (24832 * n6) / 14175,
      (-734 * n5) / 315 + (109598 * n6) / 31185,
      (444337 * n6) / 155925,
    ],
    fromConformal: [
      2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45 + (26 * n5) / 45 - (2854 * n6) / 675,
      (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45 + (2704 * n5) / 315 + (2323 * n6) / 945,
      (56 * n3) / 15 - (136 * n4) / 35 - (1262 * n5) / 105 + (73814 * n6) / 2835,
      (4279 * n4) / 630 - (332 * n5) / 35 - (399572 * n6) / 14175,
      (4174 * n5) / 315 - (144838 * n6) / 6237,
      (601676 * n6) / 22275,
    ],
  };
}
