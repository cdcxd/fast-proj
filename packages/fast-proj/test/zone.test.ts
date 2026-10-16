import { describe, expect, it } from 'vitest';
import { utmFor, utmZoneFor } from '../src/index.js';

describe('utmZoneFor', () => {
  it.each([
    [-180, 0, 1],
    [-177, 0, 1],
    [0, 0, 31],
    [15, 52, 33],
    [179.9, 0, 60],
    [180, 0, 1],
    [190, 0, 2],
    [-190, 0, 59],
    [375, 0, 33],
    [555, 0, 3],
    [5, 60, 32],
    [3, 56, 32],
    [3, 64, 31],
    [2.9, 60, 31],
    [12, 60, 33],
    [8, 78, 31],
    [9, 72, 33],
    [10, 78, 33],
    [25, 78, 35],
    [40, 78, 37],
    [42, 72, 38],
    [20, 84, 33],
    [20, -80, 34],
  ])('lon %d lat %d -> %d', (lon, lat, zone) => {
    expect(utmZoneFor(lon, lat)).toBe(zone);
  });

  it('rejects non-finite input and latitudes outside UTM', () => {
    for (const [lon, lat] of [
      [NaN, 0],
      [0, NaN],
      [Infinity, 0],
      [10, 84.0001],
      [10, -80.0001],
      [10, 89],
    ]) {
      expect(() => utmZoneFor(lon!, lat!)).toThrow(RangeError);
    }
  });
});

describe('utmFor', () => {
  it('returns zone and hemisphere', () => {
    expect(utmFor(15, 52)).toEqual({ zone: 33, south: false });
    expect(utmFor(151.2, -33.9)).toEqual({ zone: 56, south: true });
    expect(utmFor(0, 0)).toEqual({ zone: 31, south: false });
  });
});
