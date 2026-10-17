/** GCJ-02 constants shared by the converters and the fused x/y -> GCJ-02 kernel. */
const A = 6378245;
export const EE = 0.006693421622965943;
export const KX = Math.PI / 60;
export const KY = Math.PI / 180;
export const S35 = Math.sin(35 * KY);
export const C35 = Math.cos(35 * KY);
export const KLAT = 180 / (A * (1 - EE) * Math.PI);
export const KLON = 180 / (A * Math.PI);
// The China bounding box of 'passthrough' mode.
export const LON_MIN = 72.004;
export const LON_MAX = 137.8347;
export const LAT_MIN = 0.8293;
export const LAT_MAX = 55.8271;

export function reduce(lon: number): number {
  lon %= 360;
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}
