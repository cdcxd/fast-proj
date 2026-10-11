import { describe, expect, it } from 'vitest';
import { latLngs, lineString, positions, positionsFromArrays } from '../src/geojson.js';
import { utm } from '../src/index.js';

const conv = utm({ zone: 33 });
const lonlat = [15, 52, 16.5, 53, 14, 51.5];
const xy = conv.fromLonLatInterleaved(lonlat);
const expected = Array.from(conv.toLonLatInterleaved(xy));

describe('geojson', () => {
  it('positions from interleaved input', () => {
    expect(positions(conv, xy)).toEqual([
      [expected[0], expected[1]],
      [expected[2], expected[3]],
      [expected[4], expected[5]],
    ]);
  });

  it('positions from separate arrays', () => {
    const x = [xy[0]!, xy[2]!, xy[4]!];
    const y = [xy[1]!, xy[3]!, xy[5]!];
    expect(positionsFromArrays(conv, x, y)).toEqual(positions(conv, xy));
    expect(() => positionsFromArrays(conv, x, [1])).toThrow(RangeError);
  });

  it('lineString', () => {
    expect(lineString(conv, xy)).toEqual({ type: 'LineString', coordinates: positions(conv, xy) });
  });

  it('latLngs swaps to [lat, lng]', () => {
    expect(latLngs(conv, xy)).toEqual(positions(conv, xy).map(([lon, lat]) => [lat, lon]));
  });

  it('rejects odd interleaved lengths', () => {
    expect(() => positions(conv, [1, 2, 3])).toThrow(RangeError);
    expect(() => latLngs(conv, [1, 2, 3])).toThrow(RangeError);
  });

  it('handles empty input', () => {
    expect(positions(conv, [])).toEqual([]);
  });
});
