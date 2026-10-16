import { describe, expect, it } from 'vitest';
import { GCJ02, GRS80, WGS84, gcj02, utmFor, utmZoneFor } from '../src/index.js';
import { loadWasm } from '../src/wasm.js';
import { backends } from './backends.js';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(tol);
};

describe.each(backends)('$name backend geographic option', ({ utm, tmerc, gcj02: make }) => {
  const g = make();
  const x = [440000, 449000.5, 600000, 500000];
  const y = [4420000, 4430000, 3500000, 50000]; // the last is outside China
  const plain = utm({ zone: 50 });
  const p = utm({ zone: 50, geographic: g });

  it('composes x/y <-> WGS84 <-> geographic', () => {
    expect(p.geographic).toBe(g);
    expect(plain.geographic).toBeUndefined();
    const w = plain.toLonLat(x, y);
    const ref = g.fromWgs84(w.lon, w.lat);
    const r = p.toLonLat(x, y);
    close(r.lon, ref.lon, 1e-12);
    close(r.lat, ref.lat, 1e-12);
    const back = p.fromLonLat(r.lon, r.lat);
    const exp = plain.fromLonLat(...(Object.values(g.toWgs84(r.lon, r.lat)) as [Float64Array, Float64Array]));
    close(back.x, exp.x, 1e-6);
    close(back.y, exp.y, 1e-6);
  });

  it('agrees across batch, interleaved, point and in-place forms', () => {
    const xy = x.flatMap((v, i) => [v, y[i]!]);
    const r = p.toLonLat(x, y);
    const inter = p.toLonLatInterleaved(xy);
    for (let i = 0; i < x.length; i++) {
      const [lon, lat] = p.toLonLatPoint(x[i]!, y[i]!);
      expect(inter[2 * i]).toBeCloseTo(r.lon[i]!, 12);
      expect(inter[2 * i + 1]).toBeCloseTo(r.lat[i]!, 12);
      expect(lon).toBeCloseTo(r.lon[i]!, 12);
      expect(lat).toBeCloseTo(r.lat[i]!, 12);
      const [bx, by] = p.fromLonLatPoint(lon, lat);
      expect(bx).toBeCloseTo(x[i]!, 6);
      expect(by).toBeCloseTo(y[i]!, 6);
    }
    const buf = Float64Array.from(xy);
    expect(p.fromLonLatInterleaved(p.toLonLatInterleaved(buf, buf), buf)).toBe(buf);
    close(buf, xy, 1e-6);
    const lon = Float64Array.from(r.lon);
    const lat = Float64Array.from(r.lat);
    const out = p.fromLonLat(lon, lat, lon, lat);
    expect(out.x).toBe(lon);
    close(out.x, x, 1e-6);
    close(out.y, y, 1e-6);
  });

  it('checks buffers and the geographic value', () => {
    expect(() => p.fromLonLat([1, 2], [1])).toThrow(RangeError);
    expect(() => p.fromLonLat([1, 2], [1, 2], new Float64Array(1))).toThrow(RangeError);
    expect(() => p.toLonLatInterleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => tmerc({ centralMeridian: 117, geographic: {} as never })).toThrow(TypeError);
    expect(tmerc({ centralMeridian: 117, geographic: GCJ02 }).geographic).toBe(GCJ02);
  });
});

describe.each(backends)('$name backend option and error rules', ({ utm, tmerc, gcj02: make }) => {
  it('rejects unknown options and non-objects', () => {
    expect(() => utm({ zone: 33, sout: true } as never)).toThrow(/unknown utm\(\) option 'sout'/);
    expect(() => tmerc({ centralMeridian: 0, k0: 1 } as never)).toThrow(/k0 was renamed to scaleFactor/);
    expect(() => make({ outside: 'transform' } as never)).toThrow(/unknown gcj02\(\) option/);
    expect(() => utm(null as never)).toThrow(TypeError);
    expect(() => make(5 as never)).toThrow(TypeError);
  });

  it('throws TypeError for wrong types and RangeError for bad values, with the fast-proj prefix', () => {
    const cases: [() => unknown, typeof TypeError][] = [
      [() => utm({ zone: '50' as never }), TypeError],
      [() => utm({ zone: 61 }), RangeError],
      [() => utm({ zone: 33, ellipsoid: { a: '1', f: 0 } as never }), TypeError],
      [() => utm({ zone: 33, ellipsoid: null as never }), TypeError],
      [() => utm({ zone: 33, ellipsoid: { a: 1, f: 0.5 } }), RangeError],
      [() => make({ outsideChina: 1 as never }), TypeError],
      [() => make({ outsideChina: 'all' as never }), RangeError],
      [() => utm({ zone: 33 }).toLonLat([1], [1, 2]), RangeError],
    ];
    for (const [f, cls] of cases) {
      expect(f).toThrow(cls);
      expect(f).toThrow(/^fast-proj: /);
    }
  });

  it('freezes converters and keeps a frozen ellipsoid', () => {
    const e = { a: 6378137, f: 1 / 298.257223563 };
    const u = utm({ zone: 33, ellipsoid: e });
    expect(Object.isFrozen(u)).toBe(true);
    expect(Object.isFrozen(make())).toBe(true);
    expect(Object.isFrozen(u.ellipsoid)).toBe(true);
    e.f = 0.009;
    expect(u.ellipsoid.f).toBe(1 / 298.257223563);
    expect(utm({ zone: 33, ellipsoid: GRS80 }).ellipsoid).toBe(GRS80);
    expect(utm({ zone: 33 }).ellipsoid).toBe(WGS84);
    const { toLonLatPoint } = u;
    expect(toLonLatPoint(500000, 0)[0]).toBeCloseTo(15, 12);
  });
});

describe('root rules', () => {
  it('GCJ02 is gcj02() with the default options', () => {
    expect(gcj02()).toBe(GCJ02);
    expect(gcj02({ outsideChina: 'transform' })).toBe(gcj02({ outsideChina: 'transform' }));
    expect(GCJ02.fromWgs84Point(116.391, 39.907)).toEqual(gcj02().fromWgs84Point(116.391, 39.907));
    expect(GCJ02.fromWgs84Point(10, 50)).toEqual([10, 50]);
  });

  it('zone helpers separate type and range errors', () => {
    expect(() => utmZoneFor('1' as never, 0)).toThrow(TypeError);
    expect(() => utmFor(0, NaN)).toThrow(RangeError);
    expect(() => utmZoneFor(0, 85)).toThrow(/^fast-proj: /);
  });

  it('loadWasm rejects unknown options', async () => {
    await expect(loadWasm({ sorce: 'x' } as never)).rejects.toThrow(/unknown loadWasm\(\) option/);
  });
});
