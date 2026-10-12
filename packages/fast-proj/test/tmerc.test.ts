import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { GRS80, WGS84 } from '../src/index.js';
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

  it('validates options', () => {
    for (const lon0 of [NaN, Infinity]) expect(() => tmerc({ lon0 })).toThrow(RangeError);
    expect(() => tmerc({ lon0: '15' as unknown as number })).toThrow(TypeError);
    expect(() => tmerc({} as unknown as { lon0: number })).toThrow(TypeError);
    for (const k0 of [0, -1, NaN]) expect(() => tmerc({ lon0: 0, k0 })).toThrow(RangeError);
    expect(() => tmerc({ lon0: 0, falseEasting: Infinity })).toThrow(RangeError);
    expect(() => tmerc({ lon0: 0, falseNorthing: null as unknown as number })).toThrow(TypeError);
    expect(() => tmerc({ lon0: 0, ellipsoid: { a: 6378137, f: 0.02 } })).toThrow(RangeError);
  });
});
