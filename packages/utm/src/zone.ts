/**
 * UTM zone (1-60) for a WGS84 position, including the Norway and Svalbard exceptions.
 * Longitude is wrapped into [-180, 180). Throws a RangeError for non-finite input or latitudes outside [-80, 84],
 * which UTM does not cover (UPS).
 */
export function zoneFor(lon: number, lat: number): number {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new RangeError(`lon and lat must be finite numbers, got ${lon}, ${lat}`);
  }
  if (lat < -80 || lat > 84) throw new RangeError(`UTM covers latitudes -80 to 84, got ${lat}`);
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (lat >= 56 && lat < 64 && l >= 3 && l < 12) return 32;
  if (lat >= 72 && l >= 0 && l < 42) {
    if (l < 9) return 31;
    if (l < 21) return 33;
    if (l < 33) return 35;
    return 37;
  }
  return Math.min(Math.floor((l + 180) / 6) + 1, 60);
}

/** UTM zone and hemisphere for a WGS84 position; see {@link zoneFor}. */
export function utmFor(lon: number, lat: number): { zone: number; south: boolean } {
  return { zone: zoneFor(lon, lat), south: lat < 0 };
}

/** Central meridian of a UTM zone in degrees. */
export function centralMeridian(zone: number): number {
  checkZone(zone);
  return zone * 6 - 183;
}

export function checkZone(zone: number): void {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new RangeError(`UTM zone must be an integer in 1-60, got ${zone}`);
  }
}
