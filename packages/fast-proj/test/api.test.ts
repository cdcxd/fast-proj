import { describe, expect, it } from 'vitest';
import { GCJ02, GRS80, WGS84, gcj02, utm as jsUtm, utmFor, utmZoneFor } from '../src/index.js';
import type { Geographic, Projection } from '../src/index.js';
import { loadWasm } from '../src/wasm.js';
import { backends } from './backends.js';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(tol);
};

// Equal (NaN included) or within 3e-14 degrees, scaled to the latitude for a longitude.
const sameOrUlp = (a: ArrayLike<number>, ref: ArrayLike<number>, lat?: ArrayLike<number>) => {
  expect(a.length).toBe(ref.length);
  for (let i = 0; i < a.length; i++) {
    if (Object.is(a[i], ref[i])) continue;
    const scale = lat ? Math.cos((lat[i]! * Math.PI) / 180) : 1;
    expect(Math.abs(a[i]! - ref[i]!) * scale).toBeLessThan(3e-14);
  }
};

// v moved by k units in the last place.
const ulp = (v: number, k: number) => v + k * 2 ** (Math.floor(Math.log2(Math.abs(v))) - 52);

const overlaps = (a: unknown, b: unknown) =>
  a !== b && a instanceof Float64Array && b instanceof Float64Array && a.buffer === b.buffer;

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

  it('converts only the first n elements of longer output buffers', () => {
    const s = 1234.5;
    const fill = (n: number) => new Float64Array(n).fill(s);
    const r = p.toLonLat(x, y);
    const lon = fill(x.length + 1);
    const lat = fill(x.length + 2);
    p.toLonLat(x, y, lon, lat);
    expect(Array.from(lon.subarray(0, x.length))).toEqual(Array.from(r.lon));
    expect([lon[x.length], lat[x.length], lat[x.length + 1]]).toEqual([s, s, s]);
    const ox = fill(x.length + 1);
    const oy = fill(x.length + 1);
    p.fromLonLat(r.lon, r.lat, ox, oy);
    close(ox.subarray(0, x.length), x, 1e-6);
    expect([ox[x.length], oy[x.length]]).toEqual([s, s]);
    const xy = x.flatMap((v, i) => [v, y[i]!]);
    const out = fill(xy.length + 3);
    p.toLonLatInterleaved(xy, out);
    expect(out[xy.length]).toBe(s);
    const back = fill(xy.length + 3);
    p.fromLonLatInterleaved(out.subarray(0, xy.length), back);
    close(back.subarray(0, xy.length), xy, 1e-6);
    expect([back[xy.length], back[xy.length + 2]]).toEqual([s, s]);
  });

  it('passes a geographic system one array as input and output, never two overlapping views', () => {
    // Delegates to GCJ02 after checking the documented aliasing rule.
    const strict = Object.fromEntries(
      Object.entries(GCJ02).map(([k, f]: [string, (...a: unknown[]) => unknown]) => [
        k,
        (...a: unknown[]) => {
          const bad = k.endsWith('Interleaved') ? overlaps(a[0], a[1]) : overlaps(a[0], a[2]) || overlaps(a[1], a[3]);
          if (bad) throw new Error(`overlapping views passed to ${k}`);
          return f(...a);
        },
      ]),
    ) as unknown as Geographic;
    const s = utm({ zone: 50, geographic: strict });
    const xy = x.flatMap((v, i) => [v, y[i]!]);
    for (const extra of [0, 3]) {
      const r = s.toLonLat(x, y, new Float64Array(x.length + extra), new Float64Array(x.length + extra));
      close(r.lon.subarray(0, x.length), p.toLonLat(x, y).lon, 1e-12);
      const back = s.fromLonLat(r.lon.slice(0, x.length), r.lat.slice(0, x.length), r.lon, r.lat);
      close(back.x.subarray(0, x.length), x, 1e-6);
      const out = new Float64Array(xy.length + extra);
      expect(s.toLonLatInterleaved(xy, out)).toBe(out);
      const xyOut = new Float64Array(xy.length + extra);
      expect(s.fromLonLatInterleaved(out.subarray(0, xy.length), xyOut)).toBe(xyOut);
      close(xyOut.subarray(0, xy.length), xy, 1e-6);
    }
  });

  it('matches the explicit two steps for south, transform mode, other ellipsoids and NaN', () => {
    const t = make({ outsideChina: 'transform' });
    const cases: [Projection, Projection, Geographic][] = [
      [utm({ zone: 50, south: true }), utm({ zone: 50, south: true, geographic: g }), g],
      [utm({ zone: 31 }), utm({ zone: 31, geographic: t }), t],
      [
        tmerc({ centralMeridian: 117, falseEasting: 500000, ellipsoid: GRS80 }),
        tmerc({ centralMeridian: 117, falseEasting: 500000, ellipsoid: GRS80, geographic: g }),
        g,
      ],
    ];
    const xs = [400000, 500000, NaN, 600000];
    const ys = [6000000, 3000000, 3000000, NaN];
    for (const [base, composed, geo] of cases) {
      const w = base.toLonLat(xs, ys);
      const ref = geo.fromWgs84(w.lon, w.lat);
      const r = composed.toLonLat(xs, ys);
      // The JavaScript GCJ-02 fuses x/y -> GCJ-02 into one pass, within an ulp of the two.
      sameOrUlp(r.lon, ref.lon, ref.lat);
      sameOrUlp(r.lat, ref.lat);
      const wb = geo.toWgs84(r.lon, r.lat);
      const fwd = base.fromLonLat(wb.lon, wb.lat);
      const back = composed.fromLonLat(r.lon, r.lat);
      expect(Array.from(back.x)).toEqual(Array.from(fwd.x));
      expect(Array.from(back.y)).toEqual(Array.from(fwd.y));
      expect(Number.isNaN(back.x[2]) && Number.isNaN(back.y[3])).toBe(true);
    }
  });

  it('x/y -> GCJ-02 matches the two steps in every form, zone and mode', () => {
    for (const geo of [g, make({ outsideChina: 'transform' })]) {
      for (let zone = 1; zone <= 60; zone += 1) {
        for (const south of [false, true]) {
          const base = utm({ zone, south });
          const composed = utm({ zone, south, geographic: geo });
          const xy: number[] = [NaN, 3000000, 500000, Infinity, 500000, south ? 10000000 : 0];
          for (let i = 0; i < 60; i++) {
            xy.push(
              150000 + ((i * 0.618034) % 1) * 700000,
              (south ? 10000000 : 0) + ((i * 0.754878) % 1) * 9e6 * (south ? -1 : 1),
            );
          }
          const ref = geo.fromWgs84Interleaved(base.toLonLatInterleaved(xy));
          const n = xy.length / 2;
          const r = composed.toLonLatInterleaved(xy);
          expect(r.length).toBe(xy.length);
          const sep = composed.toLonLat(
            xy.filter((_, i) => i % 2 === 0),
            xy.filter((_, i) => i % 2 === 1),
          );
          const pts = Array.from({ length: n }, (_, i) => composed.toLonLatPoint(xy[2 * i]!, xy[2 * i + 1]!));
          for (const [lon, lat] of [
            [r.filter((_, i) => i % 2 === 0), r.filter((_, i) => i % 2 === 1)],
            [sep.lon, sep.lat],
            [pts.map((q) => q[0]), pts.map((q) => q[1])],
          ] as const) {
            const refLon = ref.filter((_, i) => i % 2 === 0);
            const refLat = ref.filter((_, i) => i % 2 === 1);
            sameOrUlp(lon, refLon, refLat);
            sameOrUlp(lat, refLat);
          }
        }
      }
    }
  });

  it('checks buffers and the geographic value', () => {
    expect(() => p.fromLonLat([1, 2], [1])).toThrow(RangeError);
    expect(() => p.fromLonLat([1, 2], [1, 2], new Float64Array(1))).toThrow(RangeError);
    expect(() => p.toLonLatInterleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => tmerc({ centralMeridian: 117, geographic: {} as never })).toThrow(TypeError);
    expect(() => utm({ zone: 50, geographic: 42 as never })).toThrow(/geographic must be an object, got number/);
    const { toWgs84Point: _, ...five } = GCJ02;
    expect(() => utm({ zone: 50, geographic: five as never })).toThrow(/missing the methods toWgs84Point$/);
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
    expect(() => utm({ zone: 33, sout: undefined } as never)).toThrow(/unknown utm\(\) option 'sout'/);
    expect(utm(utmFor(15, -33)).toLonLatPoint(500000, 10000000)[0]).toBeCloseTo(15, 12);
  });

  it('accepts only a zero latitudeOfOrigin', () => {
    expect(tmerc({ centralMeridian: 3, latitudeOfOrigin: 0 }).latitudeOfOrigin).toBe(0);
    expect(utm({ zone: 33 }).latitudeOfOrigin).toBe(0);
    expect(() => tmerc({ centralMeridian: 3, latitudeOfOrigin: 49 })).toThrow(RangeError);
    expect(() => tmerc({ centralMeridian: 3, latitudeOfOrigin: '0' as never })).toThrow(TypeError);
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
    const u = jsUtm({ zone: 33, ellipsoid: e });
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

  it('a disposed wasm context throws before a JavaScript geographic step writes', async () => {
    const ctx = await loadWasm({ source: new URL('../dist/fast-proj.wasm', import.meta.url) });
    const u = ctx.utm({ zone: 50, geographic: GCJ02 });
    ctx.dispose();
    const lon = Float64Array.of(116.391);
    const lat = Float64Array.of(39.907);
    expect(() => u.fromLonLat(lon, lat, lon, lat)).toThrow(/dispose/);
    expect([lon[0], lat[0]]).toEqual([116.391, 39.907]);
  });

  it('copies a frozen ellipsoid with accessors', () => {
    let reads = 0;
    const e = Object.freeze({
      get a() {
        return ++reads === 1 ? 6378137 : 1;
      },
      f: 0,
    });
    const u = jsUtm({ zone: 33, ellipsoid: e });
    expect(u.ellipsoid).not.toBe(e);
    expect(u.ellipsoid.a).toBe(6378137);
  });

  it('composed GCJ-02 results agree across backends within 1e-12 degrees at the 105 degree cusp', () => {
    const [js, w] = backends;
    // One ulp of WGS84 longitude at 105 moves GCJ-02 latitude by about 2e-13 degrees.
    const x = [2192544.951861106];
    const y = [5871177.155890386];
    const a = js!.utm({ zone: 44, geographic: GCJ02 }).toLonLat(x, y);
    const b = w!.utm({ zone: 44, geographic: w!.gcj02() }).toLonLat(x, y);
    expect(Math.abs(a.lat[0]! - b.lat[0]!)).toBeLessThan(1e-12);
    // Away from the cusp the standalone 6e-14 degree bound holds.
    const plain = js!.utm({ zone: 48 });
    const lon = [],
      lat = [];
    for (let i = 0; i < 200; i++) {
      const [px, py] = plain.fromLonLatPoint(105 + (i % 2 ? 1 : -1) * 1e-11 * (1 + (i % 7)), 5 + i / 4);
      lon.push(px);
      lat.push(py);
    }
    const c = js!.utm({ zone: 48, geographic: GCJ02 }).toLonLat(lon, lat);
    const d = w!.utm({ zone: 48, geographic: w!.gcj02() }).toLonLat(lon, lat);
    close(c.lat, d.lat, 6e-14);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(c.lon[i]! - d.lon[i]!) * Math.cos((c.lat[i]! * Math.PI) / 180)).toBeLessThan(6e-14);
    }
  });

  it('standalone GCJ-02 agrees across backends at the four China box edges', () => {
    const [js, w] = backends;
    const lon: number[] = [],
      lat: number[] = [];
    for (const k of [-2, -1, 0, 1, 2]) {
      lon.push(ulp(72.004, k), ulp(137.8347, k), 110, 110);
      lat.push(30, 30, ulp(0.8293, k), ulp(55.8271, k));
    }
    for (const dir of ['fromWgs84', 'toWgs84'] as const) {
      const a = js!.gcj02()[dir](lon, lat);
      const b = w!.gcj02()[dir](lon, lat);
      for (let i = 0; i < lon.length; i++) {
        // Same side of the edge: either both passed through or both within the kernel bound.
        expect(Math.abs(a.lon[i]! - b.lon[i]!)).toBeLessThan(1e-13);
        expect(Math.abs(a.lat[i]! - b.lat[i]!)).toBeLessThan(1e-13);
      }
    }
  });

  it("composed GCJ-02 at a box edge matches each backend's own two steps", () => {
    // The projections' WGS84 latitudes straddle 55.8271 by one ulp, so only one backend applies the offset.
    const [js, w] = backends;
    const x = [2129071.436267239];
    const y = [6506264.087319659];
    for (const [b, g] of [
      [js!, GCJ02],
      [w!, w!.gcj02()],
    ] as const) {
      const wgs = b.utm({ zone: 48 }).toLonLat(x, y);
      const ref = g.fromWgs84(wgs.lon, wgs.lat);
      const r = b.utm({ zone: 48, geographic: g }).toLonLat(x, y);
      expect([r.lon[0], r.lat[0]]).toEqual([ref.lon[0], ref.lat[0]]);
    }
  });

  it("composed 'transform' GCJ-02 stays within 1e-12 degrees at the cusp below latitude 85", () => {
    const [js, w] = backends;
    const plain = js!.utm({ zone: 44 });
    const x = [],
      y = [];
    for (let i = 0; i < 170; i++) {
      const [px, py] = plain.fromLonLatPoint(105 + ((i % 9) - 4) * 2 ** -46, i / 2);
      x.push(px);
      y.push(py);
    }
    const a = js!.utm({ zone: 44, geographic: js!.gcj02({ outsideChina: 'transform' }) }).toLonLat(x, y);
    const b = w!.utm({ zone: 44, geographic: w!.gcj02({ outsideChina: 'transform' }) }).toLonLat(x, y);
    close(a.lat, b.lat, 1e-12);
    for (let i = 0; i < x.length; i++) {
      expect(Math.abs(a.lon[i]! - b.lon[i]!) * Math.cos((a.lat[i]! * Math.PI) / 180)).toBeLessThan(1e-12);
    }
  });

  it('wasm gcj02() returns one converter per mode per context', async () => {
    const a = await loadWasm({ source: new URL('../dist/fast-proj.wasm', import.meta.url) });
    const b = await loadWasm({ source: new URL('../dist/fast-proj.wasm', import.meta.url) });
    expect(a.gcj02()).toBe(a.gcj02({ outsideChina: 'passthrough' }));
    expect(a.gcj02({ outsideChina: 'transform' })).toBe(a.gcj02({ outsideChina: 'transform' }));
    expect(a.gcj02()).not.toBe(b.gcj02());
    const u = a.utm({ zone: 50, geographic: b.gcj02() });
    b.dispose();
    expect(() => u.toLonLat([440000], [4420000])).toThrow(/its wasm context was disposed/);
    a.dispose();
  });

  it('loadWasm rejects bad sources', async () => {
    await expect(loadWasm({ source: 123 as never })).rejects.toThrow(/^fast-proj: source must be/);
  });

  it('loadWasm rejects unknown options', async () => {
    await expect(loadWasm({ sorce: 'x' } as never)).rejects.toThrow(/unknown loadWasm\(\) option/);
  });
});
