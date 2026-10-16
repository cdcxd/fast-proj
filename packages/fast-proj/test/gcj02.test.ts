import coordtransform from 'coordtransform';
import gcoord from 'gcoord';
import { describe, expect, it } from 'vitest';
import { gcj02 } from '../src/index.js';
import { backends } from './backends.js';
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
    expect(maxError(fixture.toWgs84, g.toWgs84Point)).toBeLessThan(3e-12);
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
    expect(max).toBeLessThan(1e-12);
  });

  it('round-trips near the cusp at longitude 105', () => {
    // WGS84 longitudes 1e-12 to 1e-1 degrees either side of 105, and GCJ-02 inputs that close to 105, whose solutions
    // lie across it.
    let wgs = 0;
    let gcj = 0;
    for (let e = -12; e <= -1; e += 0.25) {
      for (const side of [-1, 1]) {
        for (let lat = 1; lat <= 55.8; lat += 2.7) {
          const lon = 105 + side * 10 ** e;
          const [l, p] = g.toWgs84Point(...g.fromWgs84Point(lon, lat));
          wgs = Math.max(wgs, Math.abs(l - lon) * cosd(lat), Math.abs(p - lat));
          const [fl, fp] = g.fromWgs84Point(...g.toWgs84Point(lon, lat));
          gcj = Math.max(gcj, Math.abs(fl - lon) * cosd(lat), Math.abs(fp - lat));
        }
      }
    }
    expect(wgs).toBeLessThan(2e-12);
    expect(gcj).toBeLessThan(1e-13);
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

  it('validates options', () => {
    // @ts-expect-error invalid option
    expect(() => gcj02({ outsideChina: 'clip' })).toThrow(RangeError);
  });
});

// Batch methods, so the wasm kernel is covered (point methods run JS). Against the JavaScript point form: 6e-14 degrees
// in the China box, exact for passed-through points (and NaN where it gives NaN).
describe.each(backends)('$name backend gcj02 batch', ({ gcj02: make }) => {
  const g = make();
  const ref = gcj02();

  it('validates arguments', () => {
    expect(() => g.fromWgs84([1, 2], [1])).toThrow(RangeError);
    expect(() => g.toWgs84Interleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => g.fromWgs84Interleaved([1, 2], new Float64Array(1))).toThrow(RangeError);
    expect(() => g.toWgs84([1], [2], new Float64Array(0))).toThrow(RangeError);
  });

  function batchError(lon: number[], lat: number[]) {
    const ll = new Float64Array(lon.flatMap((v, i) => [v, lat[i]!]));
    let max = 0;
    for (const [batch, inter, point] of [
      [g.fromWgs84, g.fromWgs84Interleaved, ref.fromWgs84Point],
      [g.toWgs84, g.toWgs84Interleaved, ref.toWgs84Point],
    ] as const) {
      const r = batch(lon, lat);
      const i = inter(ll);
      lon.forEach((v, k) => {
        const [pl, pp] = point(v, lat[k]!);
        const got: [number, number][] = [
          [r.lon[k]!, r.lat[k]!],
          [i[2 * k]!, i[2 * k + 1]!],
        ];
        for (const [l, p] of got) {
          if (Object.is(l, pl) && Object.is(p, pp)) continue;
          // Passed-through points must match exactly.
          expect(pl === v || pp === lat[k]).toBe(false);
          max = Math.max(max, Math.abs(l - pl) * cosd(pp), Math.abs(p - pp));
        }
      });
    }
    return max;
  }

  it('matches the point form on the fixture and a grid around the box', () => {
    const rows = [...fixture.fromWgs84, ...fixture.toWgs84] as [number, number][];
    expect(
      batchError(
        rows.map((r) => r[0]),
        rows.map((r) => r[1]),
      ),
    ).toBeLessThan(6e-14);
    const lon: number[] = [];
    const lat: number[] = [];
    for (let l = 71.3; l <= 138.5; l += 0.53) {
      for (let p = 0.1; p <= 56.5; p += 0.47) {
        lon.push(l);
        lat.push(p);
      }
    }
    expect(batchError(lon, lat)).toBeLessThan(6e-14);
  });

  it('takes the extra inverse steps near longitude 105 per point', () => {
    // Cusp points next to far ones, at even and odd indices, with an odd length.
    const lon: number[] = [];
    const lat: number[] = [];
    for (let k = 0; k < 41; k++) {
      lon.push(105.002 + k * 0.0000875, 116.391 - k * 0.3);
      lat.push(20 + k * 0.5, 39.907 - k * 0.2);
    }
    lon.push(105.0035);
    lat.push(30);
    expect(batchError(lon, lat)).toBeLessThan(6e-14);
    expect(batchError(lon.slice(1), lat.slice(1))).toBeLessThan(6e-14);
  });

  it('decides the extra inverse steps like the point form at the edge of the 105 band', () => {
    // GCJ-02 longitudes whose third iterate lands about 1e-4 from 105, finely spaced across that edge.
    const lon: number[] = [];
    const lat: number[] = [];
    for (const p of [5, 25, 45]) {
      for (const side of [-1e-4, 1e-4]) {
        const c = ref.fromWgs84Point(105 + side, p)[0];
        for (let k = -200; k <= 200; k++) {
          lon.push(c + k * 2e-13);
          lat.push(p);
        }
      }
    }
    expect(batchError(lon, lat)).toBeLessThan(6e-14);
  });

  it('passes through, reduces and propagates like the point form', () => {
    expect(
      batchError(
        [NaN, 116, Infinity, -Infinity, 116.375 + 360, 116.375 - 720, 72.004, 72.003, 137.8347, -0, 105, 13.4, 116.391],
        [30, NaN, 30, 30, 39.875, 39.875, 30, 30, 55.8271, 0, 35, 52.5, 39.907],
      ),
    ).toBeLessThan(6e-14);
  });

  it('converts in place', () => {
    const ll = new Float64Array([116.391, 39.907, 121.4737, 31.2304, 13.4, 52.5]);
    const expected = g.fromWgs84Interleaved(ll);
    expect(g.fromWgs84Interleaved(ll, ll)).toBe(ll);
    expect(Array.from(ll)).toEqual(Array.from(expected));
    const lon = new Float64Array([116.391, 13.4]);
    const lat = new Float64Array([39.907, 52.5]);
    const r = g.toWgs84(lon, lat, lon, lat);
    expect(r.lon).toBe(lon);
    expect(r.lat).toBe(lat);
    expect(Array.from(lon)).toEqual(Array.from(g.toWgs84([116.391, 13.4], [39.907, 52.5]).lon));
  });
});
