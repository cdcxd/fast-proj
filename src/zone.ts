/** UTM zone (1-60) for a WGS84 position in [-180, 180], including the Norway and Svalbard exceptions. */
export function zoneFor(lon: number, lat: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat <= 84 && lon >= 0 && lon < 42) {
    if (lon < 9) return 31;
    if (lon < 21) return 33;
    if (lon < 33) return 35;
    return 37;
  }
  const z = Math.floor((lon + 180) / 6) + 1;
  return z > 60 ? 60 : z < 1 ? 1 : z;
}

/** Central meridian of a UTM zone in degrees. */
export function centralMeridian(zone: number): number {
  return zone * 6 - 183;
}
