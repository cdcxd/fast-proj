import { describe, expect, it } from 'vitest';
import { latLngs, lineString, positions, positionsFromArrays } from '../src/geojson.js';
import { utm } from '../src/index.js';

const lonlat = [15, 52, 16.5, 53, 14, 51.5];

describe('geojson', () => {
  it('positions from interleaved input', () => {
    expect(positions(lonlat)).toEqual([
      [15, 52],
      [16.5, 53],
      [14, 51.5],
    ]);
    expect(positions(Float64Array.from(lonlat))).toEqual(positions(lonlat));
  });

  it('positions from separate arrays', () => {
    expect(positionsFromArrays([15, 16.5, 14], [52, 53, 51.5])).toEqual(positions(lonlat));
    expect(() => positionsFromArrays([15, 16.5], [52])).toThrow(RangeError);
  });

  it('lineString', () => {
    expect(lineString(lonlat)).toEqual({ type: 'LineString', coordinates: positions(lonlat) });
  });

  it('latLngs swaps to [lat, lng]', () => {
    expect(latLngs(lonlat)).toEqual(positions(lonlat).map(([lon, lat]) => [lat, lon]));
  });

  it('rejects odd interleaved lengths', () => {
    expect(() => positions([1, 2, 3])).toThrow(RangeError);
    expect(() => latLngs([1, 2, 3])).toThrow(RangeError);
  });

  it('handles empty input', () => {
    expect(positions([])).toEqual([]);
    expect(lineString([]).coordinates).toEqual([]);
  });

  it('formats the output of a converter chain in place', () => {
    const conv = utm({ zone: 33 });
    const buf = conv.fromLonLatInterleaved(lonlat);
    conv.toLonLatInterleaved(buf, buf);
    const coords = lineString(buf).coordinates;
    for (let i = 0; i < 3; i++) {
      expect(coords[i]![0]).toBeCloseTo(lonlat[2 * i]!, 12);
      expect(coords[i]![1]).toBeCloseTo(lonlat[2 * i + 1]!, 12);
    }
  });
});
