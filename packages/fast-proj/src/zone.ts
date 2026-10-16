/**
 * UTM zone (1-60) for a WGS84 position, including the Norway and Svalbard exceptions.
 * Longitude is wrapped into [-180, 180). Throws a TypeError for non-number input and a RangeError for non-finite input
 * or latitudes outside [-80, 84], which UTM does not cover (UPS).
 */
export function utmZoneFor(lon: number, lat: number): number {
  if (typeof lon !== 'number' || typeof lat !== 'number') {
    throw new TypeError(`fast-proj: lon and lat must be numbers, got ${typeof lon}, ${typeof lat}`);
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new RangeError(`fast-proj: lon and lat must be finite, got ${lon}, ${lat}`);
  }
  if (lat < -80 || lat > 84) throw new RangeError(`fast-proj: UTM covers latitudes -80 to 84, got ${lat}`);
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

/** UTM zone and hemisphere for a WGS84 position; see {@link utmZoneFor}. */
export function utmFor(lon: number, lat: number): { zone: number; south: boolean } {
  return { zone: utmZoneFor(lon, lat), south: lat < 0 };
}

export function checkZone(zone: unknown): asserts zone is number {
  if (typeof zone !== 'number') throw new TypeError(`fast-proj: UTM zone must be a number, got ${typeof zone}`);
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new RangeError(`fast-proj: UTM zone must be an integer in 1-60, got ${zone}`);
  }
}
