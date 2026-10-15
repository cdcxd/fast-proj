import coordtransform from 'coordtransform';
import gcoord from 'gcoord';
import { describe, expect, it } from 'vitest';
import { gcj02 } from '../src/index.js';
import fixture from './fixtures/gcj02.json';

const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180);

function maxError(rows: (string | number)[][], f: (lon: number, lat: number) => [number, number]) {
  let max = 0;
  for (const [lon, lat, rlon, rlat] of rows as [number, number, string, string][]) {
    const [l, p] = f(lon, lat);
    max = Math.max(max, Math.abs(l - Number(rlon)) * cosd(lat), Math.abs(p - Number(rlat)));
  }
  return max;
}

describe('gcj02', () => {
  const g = gcj02();

  it('matches the 40-digit reference', () => {
    // Against the references rounded to doubles: fromWgs84 is correctly rounded at all but one coordinate.
    expect(maxError(fixture.fromWgs84, g.fromWgs84Point)).toBeLessThan(3e-16);
    expect(maxError(fixture.toWgs84, g.toWgs84Point)).toBeLessThan(2e-11);
  });

  it('matches gcoord and coordtransform forward', () => {
    let a = 0;
    let b = 0;
    for (let lon = 74; lon <= 135; lon += 0.37) {
      for (let lat = 4; lat <= 53; lat += 0.41) {
        const [l, p] = g.fromWgs84Point(lon, lat);
        const r = gcoord.transform([lon, lat], gcoord.WGS84, gcoord.GCJ02);
        const c = coordtransform.wgs84togcj02(lon, lat);
        a = Math.max(a, Math.abs(l - r[0]!), Math.abs(p - r[1]!));
        b = Math.max(b, Math.abs(l - c[0]!), Math.abs(p - c[1]!));
      }
    }
    expect(a).toBeLessThan(1e-13);
    expect(b).toBeLessThan(1e-13);
  });

  it('round-trips', () => {
    let max = 0;
    for (let lon = 72.1; lon <= 137.8; lon += 0.29) {
      for (let lat = 0.9; lat <= 55.8; lat += 0.31) {
        const [gl, gp] = g.fromWgs84Point(lon, lat);
        const [l, p] = g.toWgs84Point(gl, gp);
        max = Math.max(max, Math.abs(l - lon) * cosd(lat), Math.abs(p - lat));
      }
    }
    expect(max).toBeLessThan(2e-11);
  });

  it('batch and interleaved forms agree with the point form', () => {
    const lon = [116.391, 121.4737, 72.01, 10, 105];
    const lat = [39.907, 31.2304, 0.83, 50, 35];
    const ll = new Float64Array(lon.flatMap((v, i) => [v, lat[i]!]));
    for (const [batch, inter, point] of [
      [g.fromWgs84, g.fromWgs84Interleaved, g.fromWgs84Point],
      [g.toWgs84, g.toWgs84Interleaved, g.toWgs84Point],
    ] as const) {
      const r = batch(lon, lat);
      const i = inter(ll);
      lon.forEach((v, k) => {
        const p = point(v, lat[k]!);
        expect([r.lon[k], r.lat[k], i[2 * k], i[2 * k + 1]]).toEqual([p[0], p[1], p[0], p[1]]);
      });
    }
  });

  it('converts in place', () => {
    const ll = new Float64Array([116.391, 39.907, 121.4737, 31.2304]);
    const expected = g.fromWgs84Interleaved(ll);
    expect(g.fromWgs84Interleaved(ll, ll)).toBe(ll);
    expect(Array.from(ll)).toEqual(Array.from(expected));
    const lon = new Float64Array([116.391]);
    const lat = new Float64Array([39.907]);
    const r = g.toWgs84(lon, lat, lon, lat);
    expect(r.lon).toBe(lon);
    expect(r.lat).toBe(lat);
  });

  it('passes points outside China through by default', () => {
    expect(g.fromWgs84Point(13.4, 52.5)).toEqual([13.4, 52.5]);
    expect(g.toWgs84Point(-74, 40.7)).toEqual([-74, 40.7]);
    expect(g.fromWgs84Point(72.003, 30)).toEqual([72.003, 30]);
    expect(g.fromWgs84Point(72.004, 30)).not.toEqual([72.004, 30]);
  });

  it("transforms everywhere with outsideChina: 'transform'", () => {
    const t = gcj02({ outsideChina: 'transform' });
    const [l, p] = t.fromWgs84Point(13.4, 52.5);
    expect(l).not.toBe(13.4);
    expect(p).not.toBe(52.5);
    const [l2, p2] = t.toWgs84Point(l, p);
    expect(Math.abs(l2 - 13.4)).toBeLessThan(1e-10);
    expect(Math.abs(p2 - 52.5)).toBeLessThan(1e-10);
    expect(t.fromWgs84Point(116, 39.9)).toEqual(g.fromWgs84Point(116, 39.9));
    expect(t.fromWgs84Point(0, 90)).toEqual([NaN, NaN]);
    expect(t.toWgs84Point(0, -90)).toEqual([NaN, NaN]);
  });

  it("round-trips across the antimeridian with outsideChina: 'transform'", () => {
    const t = gcj02({ outsideChina: 'transform' });
    expect(t.fromWgs84Point(-180, 30)).toEqual(t.fromWgs84Point(180, 30));
    for (const lat of [-75, -30, 0, 30, 60, 88]) {
      for (const lon of [180, 179.9999, -179.9999, 179.5, -179.5, 180 - 2 ** -45, -180 + 2 ** -45, -180 + 2 ** -44]) {
        const [gl, gp] = t.fromWgs84Point(lon, lat);
        const [l, p] = t.toWgs84Point(gl, gp);
        expect(Math.abs(l - lon) * cosd(lat)).toBeLessThan(1e-11);
        expect(Math.abs(p - lat)).toBeLessThan(1e-11);
      }
    }
  });

  it("round-trips within 1e-11 degrees up to latitude 89 with outsideChina: 'transform'", () => {
    const t = gcj02({ outsideChina: 'transform' });
    let max = 0;
    for (let lat = -89; lat <= 89; lat += 0.73) {
      for (let lon = -180; lon <= 180; lon += 3.7) {
        const [gl, gp] = t.fromWgs84Point(lon, lat);
        const [l, p] = t.toWgs84Point(gl, gp);
        const d = Math.abs(l - lon) % 360;
        max = Math.max(max, Math.min(d, 360 - d) * cosd(lat), Math.abs(p - lat));
      }
    }
    expect(max).toBeLessThan(1e-11);
  });

  it("gives valid coordinates or NaN near the poles with outsideChina: 'transform'", () => {
    const t = gcj02({ outsideChina: 'transform' });
    for (const lat of [89.9, 89.99, 89.999, -89.999]) {
      for (let lon = -180; lon <= 180; lon += 7.5) {
        for (const [l, p] of [t.fromWgs84Point(lon, lat), t.toWgs84Point(lon, lat)]) {
          const valid = Math.abs(l) <= 180 && Math.abs(p) <= 90;
          const nan = Number.isNaN(l) && Number.isNaN(p);
          expect(valid || nan).toBe(true);
        }
      }
    }
    expect(t.fromWgs84Point(105, 89.999)).toEqual([NaN, NaN]);
  });

  it('reduces input longitudes and keeps output in [-180, 180]', () => {
    expect(g.fromWgs84Point(116.375 + 360, 39.875)).toEqual(g.fromWgs84Point(116.375, 39.875));
    expect(g.toWgs84Point(116.375 - 720, 39.875)).toEqual(g.toWgs84Point(116.375, 39.875));
    const t = gcj02({ outsideChina: 'transform' });
    const [l] = t.fromWgs84Point(180, 10);
    expect(l).toBeGreaterThanOrEqual(-180);
    expect(l).toBeLessThanOrEqual(180);
  });

  it('propagates NaN', () => {
    expect(g.fromWgs84Point(NaN, 30)).toEqual([NaN, 30]);
    expect(g.toWgs84Point(116, NaN)).toEqual([116, NaN]);
    const t = gcj02({ outsideChina: 'transform' });
    expect(t.fromWgs84Point(NaN, 30)).toEqual([NaN, NaN]);
    expect(t.toWgs84Point(116, NaN)).toEqual([NaN, NaN]);
  });

  it('validates arguments', () => {
    // @ts-expect-error invalid option
    expect(() => gcj02({ outsideChina: 'clip' })).toThrow(RangeError);
    expect(() => g.fromWgs84([1, 2], [1])).toThrow(RangeError);
    expect(() => g.toWgs84Interleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => g.fromWgs84Interleaved([1, 2], new Float64Array(1))).toThrow(RangeError);
    expect(() => g.toWgs84([1], [2], new Float64Array(0))).toThrow(RangeError);
  });
});
