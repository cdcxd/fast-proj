import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { utm, zoneFor } from '../src/index.js';

function grid(lon0: number, latMin: number, latMax: number, halfWidth: number, steps = 60) {
  const lon: number[] = [];
  const lat: number[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      lon.push(lon0 - halfWidth + (2 * halfWidth * i) / steps);
      lat.push(latMin + ((latMax - latMin) * j) / steps);
    }
  }
  return { lon, lat };
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe.each([
  { zone: 33, south: false, latMin: 0, latMax: 84 },
  { zone: 33, south: true, latMin: -80, latMax: 0 },
  { zone: 1, south: false, latMin: 0, latMax: 84 },
  { zone: 60, south: true, latMin: -80, latMax: 0 },
])('zone $zone south=$south', ({ zone, south, latMin, latMax }) => {
  const def = `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
  const ref = proj4('WGS84', def);
  const conv = utm({ zone, south });
  const { lon, lat } = grid(zone * 6 - 183, latMin, latMax, 4);

  it('matches proj4 forward', () => {
    const { x, y } = conv.fromLonLat(lon, lat);
    const rx = lon.map((l, i) => ref.forward([l, lat[i]!])[0]!);
    const ry = lon.map((l, i) => ref.forward([l, lat[i]!])[1]!);
    expect(maxDiff(x, rx)).toBeLessThan(1e-8);
    expect(maxDiff(y, ry)).toBeLessThan(1e-8);
  });

  it('matches proj4 inverse', () => {
    const pts = lon.map((l, i) => ref.forward([l, lat[i]!]));
    const res = conv.toLonLat(
      pts.map((p) => p[0]!),
      pts.map((p) => p[1]!),
    );
    const ref2 = pts.map((p) => ref.inverse(p));
    expect(
      maxDiff(
        res.lon,
        ref2.map((p) => p[0]!),
      ),
    ).toBeLessThan(1e-12);
    expect(
      maxDiff(
        res.lat,
        ref2.map((p) => p[1]!),
      ),
    ).toBeLessThan(1e-12);
  });

  it('round-trips', () => {
    const { x, y } = conv.fromLonLat(lon, lat);
    const back = conv.toLonLat(x, y);
    const wrapped = Array.from(back.lon, (l, i) => l + 360 * Math.round((lon[i]! - l) / 360));
    expect(maxDiff(wrapped, lon)).toBeLessThan(1e-12);
    expect(maxDiff(back.lat, lat)).toBeLessThan(1e-12);
  });
});

describe('API', () => {
  const conv = utm({ zone: 33 });

  it('interleaved and point forms agree with the array form', () => {
    const { x, y } = conv.fromLonLat([15, 16.5], [52, -1]);
    expect(Array.from(conv.fromLonLatInterleaved([15, 52, 16.5, -1]))).toEqual([x[0]!, y[0]!, x[1]!, y[1]!]);
    expect(conv.fromLonLatPoint(16.5, -1)).toEqual([x[1]!, y[1]!]);
    const xy = Float64Array.of(x[0]!, y[0]!);
    expect(conv.toLonLatInterleaved(xy, xy)).toBe(xy);
    expect(conv.toLonLatPoint(x[0]!, y[0]!)).toEqual([xy[0]!, xy[1]!]);
  });

  it('central meridian maps to the false easting', () => {
    const [x, y] = conv.fromLonLatPoint(15, 0);
    expect(x).toBeCloseTo(500000, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  it('rejects invalid zones and mismatched lengths', () => {
    expect(() => utm({ zone: 0 })).toThrow(RangeError);
    expect(() => utm({ zone: 61 })).toThrow(RangeError);
    expect(() => utm({ zone: 1.5 })).toThrow(RangeError);
    expect(() => conv.toLonLat([1, 2], [1])).toThrow(RangeError);
  });
});

describe('zoneFor', () => {
  it.each([
    [-180, 0, 1],
    [-177, 0, 1],
    [0, 0, 31],
    [15, 52, 33],
    [179.9, 0, 60],
    [180, 0, 60],
    [5, 60, 32],
    [2.9, 60, 31],
    [8, 78, 31],
    [10, 78, 33],
    [25, 78, 35],
    [40, 78, 37],
  ])('lon %d lat %d -> %d', (lon, lat, zone) => {
    expect(zoneFor(lon, lat)).toBe(zone);
  });
});
