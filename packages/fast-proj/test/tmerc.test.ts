import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { GRS80, WGS84, tmerc as jsTmerc } from '../src/index.js';
import { backends } from './backends.js';

describe.each(backends)('$name backend', ({ tmerc, utm }) => {
  it('utm() is the tmerc() preset', () => {
    const u = utm({ zone: 33, south: true });
    const t = tmerc({ lon0: 15, k0: 0.9996, falseEasting: 500000, falseNorthing: 10000000 });
    expect([u.lon0, u.k0, u.falseEasting, u.falseNorthing, u.ellipsoid]).toEqual([15, 0.9996, 500000, 10000000, WGS84]);
    const lon = [12, 15, 17.5];
    const lat = [-60, -1, -33];
    const a = u.fromLonLat(lon, lat);
    const b = t.fromLonLat(lon, lat);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
    expect(Array.from(u.toLonLat(a.x, a.y).lat)).toEqual(Array.from(t.toLonLat(a.x, a.y).lat));
  });

  it('defaults to k0 = 1 and no false origin', () => {
    const t = tmerc({ lon0: 0 });
    expect([t.k0, t.falseEasting, t.falseNorthing, t.ellipsoid]).toEqual([1, 0, 0, WGS84]);
    const [x, y] = t.fromLonLatPoint(0, 0);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it.each([
    ['CGCS2000 3° Gauss-Krüger, lon0 117', { lon0: 117, k0: 1, falseEasting: 500000 }, '+lon_0=117 +k=1 +x_0=500000'],
    [
      'CGCS2000 6° zone 20 with zone prefix',
      { lon0: 117, k0: 1, falseEasting: 20500000 },
      '+lon_0=117 +k=1 +x_0=20500000',
    ],
    [
      'scaled, false northing',
      { lon0: -2, k0: 0.9996012717, falseEasting: 400000, falseNorthing: -100000 },
      '+lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000',
    ],
  ])('matches proj4: %s', (_, options, params) => {
    const ref = proj4('WGS84', `+proj=tmerc +lat_0=0 ${params} +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`);
    const t = tmerc({ ...options, ellipsoid: GRS80 });
    let fwd = 0;
    let inv = 0;
    for (let dlon = -6; dlon <= 6; dlon += 0.5) {
      for (let lat = -70; lat <= 70; lat += 5) {
        const lon = options.lon0 + dlon;
        const r = ref.forward([lon, lat]);
        const [x, y] = t.fromLonLatPoint(lon, lat);
        fwd = Math.max(fwd, Math.abs(x - r[0]!), Math.abs(y - r[1]!));
        const [l2, p2] = t.toLonLatPoint(r[0]!, r[1]!);
        inv = Math.max(inv, Math.abs(l2 - lon), Math.abs(p2 - lat));
      }
    }
    expect(fwd).toBeLessThan(1e-8);
    expect(inv).toBeLessThan(2e-13);
  });

  it('wraps output longitude for central meridians near ±180', () => {
    const t = tmerc({ lon0: 179 });
    const [x, y] = t.fromLonLatPoint(-179, 10);
    expect(t.toLonLatPoint(x, y)[0]).toBeCloseTo(-179, 12);
  });

  it('accepts input longitudes any number of turns away (batch methods)', () => {
    const turns = [-3, -2, -1, 1, 2, 3];
    for (const lon0 of [0, 15, -177, 177, 180, -180]) {
      const t = tmerc({ lon0 });
      const edge = [90, -90].flatMap((d) => turns.map((k) => lon0 + d + 360 * k));
      const { x, y } = t.fromLonLat(edge, new Float64Array(edge.length));
      expect([...x, ...y].every(Number.isNaN), `lon0 ${lon0}: ${edge}`).toBe(true);
      const inside = turns.map((k) => lon0 + 30 + 360 * k);
      const lat = inside.map(() => 45);
      const got = t.fromLonLat(inside, lat);
      const [x0, y0] = t.fromLonLatPoint(lon0 + 30 > 180 ? lon0 - 330 : lon0 + 30, 45);
      for (let i = 0; i < inside.length; i++) {
        expect(Math.abs(got.x[i]! - x0)).toBeLessThan(1e-6);
        expect(Math.abs(got.y[i]! - y0)).toBeLessThan(1e-6);
      }
    }
  });

  it('reduces like the JavaScript backend, including ties at ±180 and huge longitudes', () => {
    expect(tmerc({ lon0: 90.00000000000006 }).fromLonLatPoint(-540, 0).every(Number.isNaN)).toBe(true);
    const cases: [number, number[]][] = [
      [90.00000000000006, [-540]],
      [154, [-540, 540, 900]],
      [-80, [1e18, -1e18, 1e300]],
    ];
    for (const [lon0, lon] of cases) {
      const lat = lon.map(() => 0);
      const got = tmerc({ lon0 }).fromLonLat(lon, lat);
      const ref = jsTmerc({ lon0 }).fromLonLat(lon, lat);
      // Same classification (both NaN or both finite) and within the contract.
      const diff = lon.map((_, i) =>
        Number.isNaN(ref.x[i]!) ? +!Number.isNaN(got.x[i]!) : Math.abs(got.x[i]! - ref.x[i]!),
      );
      expect(Math.max(...diff)).toBeLessThan(4e-9);
    }
    // 1e18 = 280 (mod 360), i.e. -80: on the central meridian.
    expect(Math.abs(tmerc({ lon0: -80 }).fromLonLat([1e18], [0]).x[0]!)).toBeLessThan(1e-9);
  });

  it('validates options', () => {
    for (const lon0 of [NaN, Infinity, 180.5, -181, 720]) expect(() => tmerc({ lon0 })).toThrow(RangeError);
    expect(() => tmerc({ lon0: '15' as unknown as number })).toThrow(TypeError);
    expect(() => tmerc({} as unknown as { lon0: number })).toThrow(TypeError);
    for (const k0 of [0, -1, NaN]) expect(() => tmerc({ lon0: 0, k0 })).toThrow(RangeError);
    expect(() => tmerc({ lon0: 0, falseEasting: Infinity })).toThrow(RangeError);
    expect(() => tmerc({ lon0: 0, falseNorthing: null as unknown as number })).toThrow(TypeError);
    expect(() => tmerc({ lon0: 0, ellipsoid: { a: 6378137, f: 0.02 } })).toThrow(RangeError);
  });
});
