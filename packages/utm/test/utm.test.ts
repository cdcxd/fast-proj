import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { GRS80, WGS84, utm } from '../src/index.js';
import reference from './fixtures/reference.json';

const D2R = Math.PI / 180;
const wrap = (d: number) => Math.abs(((d + 540) % 360) - 180);

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

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>, f: (d: number) => number = Math.abs) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, f(a[i]! - b[i]!));
  return m;
}

describe('independent high-precision reference (WGS84, zone 31)', () => {
  const conv = utm({ zone: 31 });
  const points = reference.points.map((p) => ({ dlon: p.dlon, lat: p.lat, x: Number(p.x), y: Number(p.y) }));

  it('forward within 5e-9 m', () => {
    for (const p of points) {
      const [x, y] = conv.fromLonLatPoint(3 + p.dlon, p.lat);
      expect(Math.abs(x - p.x)).toBeLessThan(5e-9);
      expect(Math.abs(y - p.y)).toBeLessThan(5e-9);
    }
  });

  it('inverse within 1e-13 deg (longitude scaled by cos lat)', () => {
    for (const p of points) {
      const [lon, lat] = conv.toLonLatPoint(p.x, p.y);
      expect(Math.abs(lat - p.lat)).toBeLessThan(1e-13);
      expect(wrap(lon - 3 - p.dlon) * Math.cos(p.lat * D2R)).toBeLessThan(1e-13);
    }
  });
});

describe.each([
  { zone: 33, south: false, latMin: 0, latMax: 84 },
  { zone: 33, south: true, latMin: -80, latMax: 0 },
  { zone: 1, south: false, latMin: 0, latMax: 84 },
  { zone: 60, south: true, latMin: -80, latMax: 0 },
])('zone $zone south=$south, ±30° from the central meridian', ({ zone, south, latMin, latMax }) => {
  const ref = proj4('WGS84', `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`);
  const conv = utm({ zone, south });
  const { lon, lat } = grid(zone * 6 - 183, latMin, latMax, 30);
  const refXY = lon.map((l, i) => ref.forward([l, lat[i]!]));

  it('matches proj4 forward within 1e-8 m', () => {
    const { x, y } = conv.fromLonLat(lon, lat);
    expect(
      maxDiff(
        x,
        refXY.map((p) => p[0]!),
      ),
    ).toBeLessThan(1e-8);
    expect(
      maxDiff(
        y,
        refXY.map((p) => p[1]!),
      ),
    ).toBeLessThan(1e-8);
  });

  it('matches proj4 inverse within 2e-13 deg', () => {
    const res = conv.toLonLat(
      refXY.map((p) => p[0]!),
      refXY.map((p) => p[1]!),
    );
    const refLL = refXY.map((p) => ref.inverse(p));
    expect(
      maxDiff(
        res.lon,
        refLL.map((p) => p[0]!),
        wrap,
      ),
    ).toBeLessThan(2e-13);
    expect(
      maxDiff(
        res.lat,
        refLL.map((p) => p[1]!),
      ),
    ).toBeLessThan(2e-13);
  });

  it('round-trips within 2e-13 deg', () => {
    const { x, y } = conv.fromLonLat(lon, lat);
    const back = conv.toLonLat(x, y);
    expect(maxDiff(back.lon, lon, wrap)).toBeLessThan(2e-13);
    expect(maxDiff(back.lat, lat)).toBeLessThan(1e-13);
  });
});

describe('edge cases', () => {
  it('poles', () => {
    const conv = utm({ zone: 33 });
    const [x, y] = conv.fromLonLatPoint(15, 90);
    expect(x).toBeCloseTo(500000, 6);
    expect(y).toBeCloseTo(9997964.943021, 5);
    expect(conv.toLonLatPoint(x, y)[1]).toBe(90);
    const s = utm({ zone: 33, south: true });
    const [xs, ys] = s.fromLonLatPoint(15, -90);
    expect(xs).toBeCloseTo(500000, 6);
    expect(ys).toBeCloseTo(10000000 - 9997964.943021, 5);
    expect(s.toLonLatPoint(xs, ys)[1]).toBe(-90);
  });

  it('retains signed zero for inverse equator coordinates', () => {
    const conv = utm({ zone: 33 });
    expect(conv.toLonLatPoint(166000, -0)[1]).toBe(-0);
    expect(conv.toLonLatPoint(834000, -0)[1]).toBe(0);
    expect(conv.toLonLatPoint(166000, 0)[1]).toBe(0);
  });

  it('wraps output longitude across ±180 in zones 1 and 60', () => {
    const z1 = utm({ zone: 1 });
    const [x1, y1] = z1.fromLonLatPoint(-180, 10);
    expect(z1.toLonLatPoint(x1, y1)[0]).toBeCloseTo(-180, 12);
    const [xw, yw] = z1.fromLonLatPoint(179, 10);
    expect(z1.toLonLatPoint(xw, yw)[0]).toBeCloseTo(179, 12);
    const z60 = utm({ zone: 60 });
    const [xe, ye] = z60.fromLonLatPoint(-179, 10);
    expect(z60.toLonLatPoint(xe, ye)[0]).toBeCloseTo(-179, 12);
    const [a, b] = z60.fromLonLatPoint(180, 10);
    const [c, d] = z60.fromLonLatPoint(-180, 10);
    expect(Math.abs(a - c) + Math.abs(b - d)).toBeLessThan(1e-8);
  });

  it('accepts longitudes outside [-180, 180]', () => {
    const conv = utm({ zone: 33 });
    const [a, b] = conv.fromLonLatPoint(15 + 360, 40);
    const [c, d] = conv.fromLonLatPoint(15, 40);
    expect(Math.abs(a - c) + Math.abs(b - d)).toBeLessThan(1e-8);
  });

  it('returns NaN 90° or more from the central meridian', () => {
    const conv = utm({ zone: 31 });
    expect(conv.fromLonLatPoint(93, 0).every(Number.isNaN)).toBe(true);
    expect(conv.fromLonLatPoint(-87, 0).every(Number.isNaN)).toBe(true);
    expect(conv.fromLonLatPoint(-100, 45).every(Number.isNaN)).toBe(true);
    expect(conv.fromLonLatPoint(92.9, 0).every(Number.isFinite)).toBe(true);
  });

  it('propagates NaN and Infinity as NaN', () => {
    const conv = utm({ zone: 33 });
    expect(conv.fromLonLatPoint(NaN, 10).every(Number.isNaN)).toBe(true);
    expect(conv.fromLonLatPoint(15, Infinity).every(Number.isNaN)).toBe(true);
    expect(conv.toLonLatPoint(NaN, 0).every(Number.isNaN)).toBe(true);
  });

  it('south: false gives negative northings south of the equator, south: true adds 10 000 km', () => {
    const [, yn] = utm({ zone: 33 }).fromLonLatPoint(15, -10);
    const [, ys] = utm({ zone: 33, south: true }).fromLonLatPoint(15, -10);
    expect(yn).toBeLessThan(0);
    expect(ys - yn).toBeCloseTo(10000000, 6);
  });

  it('GRS80 differs from WGS84 by well under a millimetre', () => {
    const [xw, yw] = utm({ zone: 33 }).fromLonLatPoint(18, 60);
    const [xg, yg] = utm({ zone: 33, ellipsoid: GRS80 }).fromLonLatPoint(18, 60);
    const ref = proj4('WGS84', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0 +units=m').forward([18, 60]);
    expect(Math.abs(xg - ref[0]!)).toBeLessThan(1e-8);
    expect(Math.abs(yg - ref[1]!)).toBeLessThan(1e-8);
    expect(Math.hypot(xw - xg, yw - yg)).toBeLessThan(1e-3);
    expect(Math.hypot(xw - xg, yw - yg)).toBeGreaterThan(0);
  });
});

describe('API', () => {
  const conv = utm({ zone: 33 });

  it('exposes zone and south', () => {
    expect(conv.zone).toBe(33);
    expect(conv.south).toBe(false);
    expect(utm({ zone: 7, south: true }).south).toBe(true);
  });

  it('interleaved and point forms agree with the array form', () => {
    const { x, y } = conv.fromLonLat([15, 16.5], [52, -1]);
    expect(Array.from(conv.fromLonLatInterleaved([15, 52, 16.5, -1]))).toEqual([x[0]!, y[0]!, x[1]!, y[1]!]);
    expect(conv.fromLonLatPoint(16.5, -1)).toEqual([x[1]!, y[1]!]);
    const ll = conv.toLonLat(x, y);
    expect(Array.from(conv.toLonLatInterleaved([x[0]!, y[0]!, x[1]!, y[1]!]))).toEqual([
      ll.lon[0]!,
      ll.lat[0]!,
      ll.lon[1]!,
      ll.lat[1]!,
    ]);
  });

  it('writes into output buffers and returns them', () => {
    const lon = new Float64Array(3);
    const lat = new Float64Array(3);
    const res = conv.toLonLat([500000, 500000], [0, 1000], lon, lat);
    expect(res.lon).toBe(lon);
    expect(res.lat).toBe(lat);
    expect(lon[2]).toBe(0);
    const out = new Float64Array(4);
    expect(conv.fromLonLatInterleaved([15, 0, 15, 1], out)).toBe(out);
  });

  it('supports full aliasing (in place)', () => {
    const { x, y } = conv.fromLonLat([15, 16.5], [52, -1]);
    const expected = conv.toLonLat(x, y);
    const xy = Float64Array.of(x[0]!, y[0]!, x[1]!, y[1]!);
    expect(conv.toLonLatInterleaved(xy, xy)).toBe(xy);
    expect(Array.from(xy)).toEqual([expected.lon[0], expected.lat[0], expected.lon[1], expected.lat[1]]);
    const xs = Float64Array.from(x);
    const ys = Float64Array.from(y);
    conv.toLonLat(xs, ys, xs, ys);
    expect(Array.from(xs)).toEqual(Array.from(expected.lon));
    expect(Array.from(ys)).toEqual(Array.from(expected.lat));
    const swapped = conv.toLonLat(Float64Array.from(x), Float64Array.from(y));
    const a = Float64Array.from(x);
    const b = Float64Array.from(y);
    conv.toLonLat(a, b, b, a);
    expect(Array.from(b)).toEqual(Array.from(swapped.lon));
    expect(Array.from(a)).toEqual(Array.from(swapped.lat));
  });

  it('rejects odd interleaved lengths', () => {
    expect(() => conv.toLonLatInterleaved([500000, 0, 600000])).toThrow(RangeError);
    expect(() => conv.fromLonLatInterleaved([15, 52, 16])).toThrow(RangeError);
  });

  it('rejects output buffers that are too short', () => {
    const one = new Float64Array(1);
    expect(() => conv.toLonLat([1, 2], [1, 2], one)).toThrow(RangeError);
    expect(() => conv.toLonLat([1, 2], [1, 2], undefined, one)).toThrow(RangeError);
    expect(() => conv.fromLonLat([1, 2], [1, 2], one)).toThrow(RangeError);
    expect(() => conv.fromLonLat([1, 2], [1, 2], undefined, one)).toThrow(RangeError);
    expect(() => conv.toLonLatInterleaved([1, 2, 3, 4], new Float64Array(2))).toThrow(RangeError);
    expect(() => conv.fromLonLatInterleaved([1, 2, 3, 4], new Float64Array(3))).toThrow(RangeError);
  });

  it('rejects mismatched input lengths', () => {
    expect(() => conv.toLonLat([1, 2], [1])).toThrow(RangeError);
    expect(() => conv.fromLonLat([1], [1, 2])).toThrow(RangeError);
  });

  it('central meridian maps to the false easting', () => {
    const [x, y] = conv.fromLonLatPoint(15, 0);
    expect(x).toBeCloseTo(500000, 9);
    expect(y).toBeCloseTo(0, 9);
  });
});

describe('options validation', () => {
  it('rejects invalid zones', () => {
    for (const zone of [0, 61, 1.5, NaN, -3]) expect(() => utm({ zone })).toThrow(RangeError);
  });

  it('rejects a non-boolean south', () => {
    expect(() => utm({ zone: 33, south: 'false' as unknown as boolean })).toThrow(TypeError);
    expect(() => utm({ zone: 33, south: 1 as unknown as boolean })).toThrow(TypeError);
  });

  it('rejects unsupported ellipsoids', () => {
    for (const ellipsoid of [
      { a: 0, f: WGS84.f },
      { a: -1, f: WGS84.f },
      { a: Infinity, f: WGS84.f },
      { a: NaN, f: WGS84.f },
      { a: 6378137, f: -0.001 },
      { a: 6378137, f: 0.01 },
      { a: 6378137, f: 2 },
      { a: 6378137, f: NaN },
    ]) {
      expect(() => utm({ zone: 33, ellipsoid })).toThrow(RangeError);
    }
    expect(() => utm({ zone: 33, ellipsoid: { a: 6371000, f: 0 } })).not.toThrow();
  });

  it('freezes the built-in ellipsoids', () => {
    expect(Object.isFrozen(WGS84)).toBe(true);
    expect(Object.isFrozen(GRS80)).toBe(true);
  });
});
