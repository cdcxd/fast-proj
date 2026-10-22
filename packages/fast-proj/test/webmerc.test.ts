import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { GCJ02, webMercator as jsWebMercator } from '../src/index.js';
import { backends } from './backends.js';

// [lon, lat, x, y] and [x, y, lon, lat], from gen_webmerc.py (40 digits, rounded to doubles).
const ref = JSON.parse(readFileSync(new URL('fixtures/webmerc.json', import.meta.url), 'utf8')) as {
  forward: [number, number, number, number][];
  inverse: [number, number, number, number][];
};

const E = 20037508.342789244; // pi R
const ulp = (v: number) => 2 ** (Math.floor(Math.log2(Math.abs(v))) - 52);
// y is computed as y / R, then scaled: a few ulps of y. The backends agree within 7.5e-9 m below 2^25 m, two ulps above.
const backendTol = (v: number) => (Math.abs(v) < 2 ** 25 ? 7.5e-9 : 2 * ulp(v));
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => expect(Array.from(a)).toEqual(Array.from(b));

describe.each(backends)('$name backend webMercator', ({ webMercator }) => {
  const w = webMercator();

  it('matches a 40-digit reference within 5 ulps (x within 4e-9 m), and 3e-14 degrees', () => {
    const [lon, lat, x, y] = [0, 1, 2, 3].map((k) => ref.forward.map((r) => r[k]!));
    const got = w.fromLonLat(lon!, lat!);
    for (let i = 0; i < lon!.length; i++) {
      expect(Math.abs(got.x[i]! - x![i]!)).toBeLessThanOrEqual(Math.max(4e-9, ulp(x![i]!)));
      expect(Math.abs(got.y[i]! - y![i]!), `lat ${lat![i]}`).toBeLessThanOrEqual(5 * ulp(y![i]!));
    }
    const [xs, ys, lons, lats] = [0, 1, 2, 3].map((k) => ref.inverse.map((r) => r[k]!));
    const back = w.toLonLat(xs!, ys!);
    for (let i = 0; i < xs!.length; i++) {
      expect(Math.abs(back.lon[i]! - lons![i]!)).toBeLessThan(3e-14);
      expect(Math.abs(back.lat[i]! - lats![i]!)).toBeLessThan(3e-14);
    }
  });

  it('matches proj4 EPSG:3857', () => {
    const p = proj4('EPSG:4326', 'EPSG:3857');
    let fwd = 0,
      inv = 0;
    for (let lat = -85; lat <= 85; lat += 2.5) {
      for (let lon = -180; lon <= 180; lon += 7.5) {
        const r = p.forward([lon, lat]);
        const [x, y] = w.fromLonLatPoint(lon, lat);
        const b = w.fromLonLat([lon], [lat]);
        fwd = Math.max(
          fwd,
          Math.abs(x - r[0]!),
          Math.abs(y - r[1]!),
          Math.abs(b.x[0]! - r[0]!),
          Math.abs(b.y[0]! - r[1]!),
        );
        const [l2, p2] = w.toLonLatPoint(r[0]!, r[1]!);
        inv = Math.max(inv, Math.abs(l2 - lon), Math.abs(p2 - lat));
      }
    }
    expect(fwd).toBeLessThan(1e-8);
    expect(inv).toBeLessThan(1e-13);
  });

  it('maps ±180 to ±pi R and back exactly, and wraps longitudes and x', () => {
    same(w.fromLonLat([180, -180, 540, -540, 0], [0, 0, 0, 0, 0]).x, [E, -E, E, -E, 0]);
    same(w.toLonLat([E, -E, 3 * E, -3 * E, 4 * E], [0, 0, 0, 0, 0]).lon, [180, -180, 180, -180, 0]);
    expect(w.toLonLatPoint(E, 0)[0]).toBe(180);
    expect(w.toLonLatPoint(-E, 0)[0]).toBe(-180);
    expect(w.fromLonLatPoint(180, 0)[0]).toBe(E);
  });

  it('keeps signed zeros', () => {
    const inter = w.fromLonLatInterleaved([-0, -0, 0, 0, -0, -0]);
    const pairs = { x: [inter[0], inter[2]], y: [inter[1], inter[3]] };
    for (const r of [w.fromLonLat([-0, 0], [-0, 0]), w.fromLonLat([-0, 0, -0], [-0, 0, -0]), pairs]) {
      expect(Object.is(r.x[0], -0) && Object.is(r.y[0], -0)).toBe(true);
      expect(Object.is(r.x[1], 0) && Object.is(r.y[1], 0)).toBe(true);
    }
    const r = w.toLonLat([-0, 0], [-0, 0]);
    expect(Object.is(r.lon[0], -0) && Object.is(r.lat[0], -0)).toBe(true);
    expect(Object.is(r.lon[1], 0) && Object.is(r.lat[1], 0)).toBe(true);
    expect(Object.is(w.fromLonLatPoint(-0, -0)[1], -0)).toBe(true);
    expect(Object.is(w.toLonLatPoint(-0, -0)[1], -0)).toBe(true);
  });

  it('does not clamp: latitudes up to the pole round-trip; the poles and beyond give NaN', () => {
    const below = 90 - 2 ** -46; // the last double below 90
    const lat = [85.0511287798066, 89, 89.999999, below, -below];
    const { x, y } = w.fromLonLat(
      lat.map(() => 10),
      lat,
    );
    expect(y[0]).toBeCloseTo(E, 6);
    expect(y[3]).toBeGreaterThan(2e8);
    expect(y[4]).toBe(-y[3]!);
    const back = w.toLonLat(x, y);
    for (let i = 0; i < lat.length; i++) expect(Math.abs(back.lat[i]! - lat[i]!)).toBeLessThan(3e-14);
    const bad = w.fromLonLat([0, 0, 0, 0, 0, Infinity, -Infinity, NaN], [90, -90, 90.5, NaN, Infinity, 0, 0, 0]);
    expect([...bad.x, ...bad.y].every(Number.isNaN)).toBe(true);
  });

  it('saturates the inverse at ±90 for large finite y; non-finite input gives NaN', () => {
    same(w.toLonLat([0, 0, 0, 0], [1e9, -1e9, 1e300, -Number.MAX_VALUE]).lat, [90, -90, 90, -90]);
    const bad = w.toLonLat([Infinity, -Infinity, NaN, 0, 0, 0], [0, 0, 0, Infinity, -Infinity, NaN]);
    expect([...bad.lon, ...bad.lat].every(Number.isNaN)).toBe(true);
    expect(w.toLonLatPoint(0, Infinity).every(Number.isNaN)).toBe(true);
    expect(w.fromLonLatPoint(0, 90).every(Number.isNaN)).toBe(true);
  });

  it('agrees with the JavaScript backend across batch, interleaved and point forms', () => {
    const js = jsWebMercator();
    const n = 1001; // odd: the wasm tail
    const lon = Float64Array.from({ length: n }, (_, i) => -200 + ((i * 7919) % n) * (400 / n));
    const lat = Float64Array.from({ length: n }, (_, i) => -89.9 + ((i * 104729) % n) * (179.8 / n));
    const a = w.fromLonLat(lon, lat);
    const b = js.fromLonLat(lon, lat);
    const inter = w.fromLonLatInterleaved(Float64Array.from({ length: 2 * n }, (_, k) => (k & 1 ? lat : lon)[k >> 1]!));
    for (let i = 0; i < n; i++) {
      expect(a.x[i]).toBe(b.x[i]);
      expect(inter[2 * i]).toBe(b.x[i]);
      for (const [p, q] of <[number, number][]>[
        [a.y[i]!, b.y[i]!],
        [inter[2 * i + 1]!, b.y[i]!],
      ]) {
        expect(Math.abs(p - q)).toBeLessThanOrEqual(backendTol(q));
      }
      const [px, py] = w.fromLonLatPoint(lon[i]!, lat[i]!);
      expect([px, py]).toEqual([b.x[i], b.y[i]]);
    }
    const c = w.toLonLat(b.x, b.y);
    const d = js.toLonLat(b.x, b.y);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(c.lon[i]! - d.lon[i]!)).toBeLessThan(6e-14);
      expect(Math.abs(c.lat[i]! - d.lat[i]!)).toBeLessThan(6e-14);
    }
    // In place.
    const xy = Float64Array.from([1e6, 2e6, -3e6, 4e6]);
    const exp = w.toLonLatInterleaved(xy);
    expect(w.toLonLatInterleaved(xy, xy)).toBe(xy);
    same(xy, exp);
  });

  it('composes with a geographic system as x/y <-> WGS84 <-> it', () => {
    const p = webMercator({ geographic: GCJ02 });
    expect(p.geographic).toBe(GCJ02);
    const x = [12958000, 13530000];
    const y = [4852000, 3640000];
    const wgs = w.toLonLat(x, y);
    const exp = GCJ02.fromWgs84(wgs.lon, wgs.lat);
    const got = p.toLonLat(x, y);
    same(got.lon, exp.lon);
    same(got.lat, exp.lat);
    const fwd = p.fromLonLat(got.lon, got.lat);
    const wgs2 = GCJ02.toWgs84(got.lon, got.lat);
    const exp2 = w.fromLonLat(wgs2.lon, wgs2.lat);
    same(fwd.x, exp2.x);
    same(fwd.y, exp2.y);
  });

  it('validates options and freezes the converter', () => {
    expect(Object.isFrozen(w)).toBe(true);
    expect(webMercator({}).geographic).toBeUndefined();
    expect(() => webMercator({ radius: 1 } as never)).toThrow(/unknown webMercator\(\) option/);
    expect(() => webMercator({ geographic: {} as never })).toThrow(TypeError);
    expect(() => webMercator(null as never)).toThrow(TypeError);
  });
});
