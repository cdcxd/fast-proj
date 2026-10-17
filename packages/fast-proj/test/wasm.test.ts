import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { fusers } from '../src/geographic.js';
import { GCJ02, gcj02, utm } from '../src/index.js';
import { loadWasm } from '../src/wasm.js';

const url = new URL('../dist/fast-proj.wasm', import.meta.url);

describe('loadWasm', () => {
  it('accepts a URL, bytes or a compiled module', async () => {
    const bytes = readFileSync(url);
    const module = await WebAssembly.compile(bytes);
    const sources = [
      url,
      url.href,
      bytes,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      module,
    ];
    const contexts = await Promise.all(sources.map((source) => loadWasm({ source })));
    const expected = utm({ zone: 33 }).fromLonLat([15, 16], [52, -1]);
    for (const ctx of contexts) {
      expect(ctx.backend).toBe('wasm');
      const got = ctx.utm({ zone: 33 }).fromLonLat([15, 16], [52, -1]);
      expect(Math.abs(got.x[1]! - expected.x[1]!)).toBeLessThan(5e-9);
      ctx.dispose();
    }
  });

  it('falls back to the JavaScript backend without wasm SIMD', async () => {
    const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const ctx = await loadWasm().finally(() => validate.mockRestore());
    expect(ctx.backend).toBe('js');
    expect(ctx.utm({ zone: 33 }).toLonLat([500000], [0]).lon[0]).toBeCloseTo(15, 12);
  });

  it('without SIMD, still loads a given source, and falls back if it does not compile', async () => {
    const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    try {
      expect((await loadWasm({ source: url })).backend).toBe('wasm');
      const bad = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 9]);
      expect((await loadWasm({ source: bad })).backend).toBe('js');
    } finally {
      validate.mockRestore();
    }
  });

  it('gives each context its own instance', async () => {
    const a = await loadWasm({ source: url });
    const b = await loadWasm({ source: url });
    const ua = a.utm({ zone: 33 });
    const ub = b.utm({ zone: 33 });
    a.dispose();
    expect(() => ua.toLonLatPoint(500000, 0)).toThrow(/dispose/);
    expect(ub.toLonLatPoint(500000, 0)[0]).toBeCloseTo(15, 12);
  });

  it('rejects a corrupt module and can retry', async () => {
    await expect(loadWasm({ source: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 9]) })).rejects.toBeInstanceOf(
      WebAssembly.CompileError,
    );
    await expect(loadWasm({ source: new URL('./missing.wasm', url) })).rejects.toThrow(/ENOENT/);
    expect((await loadWasm({ source: url })).backend).toBe('wasm');
  });

  it('evicts a module that fails initialization, so a fixed file can be retried', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fast-proj-')), 'm.wasm');
    writeFileSync(file, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const source = pathToFileURL(file);
    await expect(loadWasm({ source })).rejects.toThrow(/not a fast-proj wasm module/);
    copyFileSync(url, file);
    expect((await loadWasm({ source })).backend).toBe('wasm');
  });

  it('accepts a module compiled in another realm', async () => {
    const module = vm.runInNewContext('new WebAssembly.Module(bytes)', {
      bytes: readFileSync(url),
    }) as WebAssembly.Module;
    expect(module instanceof WebAssembly.Module).toBe(false);
    expect((await loadWasm({ source: module })).backend).toBe('wasm');
  });

  it('handles inputs larger than the 64 Ki-point workspace', async () => {
    const ctx = await loadWasm({ source: url });
    const n = 150001;
    const lon = Float64Array.from({ length: n }, (_, i) => 12 + (6 * i) / n);
    const lat = Float64Array.from({ length: n }, (_, i) => -80 + (164 * i) / n);
    const js = utm({ zone: 33 }).fromLonLat(lon, lat);
    const w = ctx.utm({ zone: 33 });
    const res = w.fromLonLat(lon, lat);
    const ll = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      ll[2 * i] = lon[i]!;
      ll[2 * i + 1] = lat[i]!;
    }
    const inter = w.fromLonLatInterleaved(ll, ll);
    let max = 0;
    for (let i = 0; i < n; i++) {
      max = Math.max(max, Math.abs(res.x[i]! - js.x[i]!), Math.abs(res.y[i]! - js.y[i]!));
      max = Math.max(max, Math.abs(inter[2 * i]! - js.x[i]!), Math.abs(inter[2 * i + 1]! - js.y[i]!));
    }
    expect(max).toBeLessThan(5e-9);
  });

  it('ships the wasm gcj02 kernel', async () => {
    const names = WebAssembly.Module.exports(await WebAssembly.compile(readFileSync(url))).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['gcj_forward_batch', 'gcj_inverse_batch']));
    expect(names).not.toContain('forward_batch');
    expect(names).not.toContain('inverse_batch');
  });

  it('falls back to the JavaScript backend for a non-SIMD module', async () => {
    const module = await WebAssembly.compile(readFileSync(url));
    const instantiate = WebAssembly.instantiate;
    const spy = vi.spyOn(WebAssembly, 'instantiate').mockImplementation((async (m: WebAssembly.Module) => {
      const { exports } = await instantiate(m, {});
      return { exports: { ...exports, simd_enabled: () => 0 } };
    }) as unknown as typeof WebAssembly.instantiate);
    const ctx = await loadWasm({ source: module }).finally(() => spy.mockRestore());
    expect(ctx.backend).toBe('js');
    expect(ctx.utm({ zone: 33 }).fromLonLatPoint(15, 0)[0]).toBeCloseTo(500000, 6);
    // Its gcj02() fuses with JavaScript projections like the root one.
    const x = [440000, 449000.5, 600000];
    const y = [4420000, 4430000, 3500000];
    const fused = utm({ zone: 50, geographic: GCJ02 }).toLonLat(x, y);
    const own = ctx.utm({ zone: 50, geographic: ctx.gcj02() });
    const root = utm({ zone: 50, geographic: ctx.gcj02() });
    expect(fusers.has(root.geographic!)).toBe(true);
    expect(own.toLonLat(x, y)).toEqual(fused);
    expect(root.toLonLat(x, y)).toEqual(fused);
    expect(root.toLonLatPoint(x[0]!, y[0]!)).toEqual([fused.lon[0], fused.lat[0]]);
    ctx.dispose();
    expect(() => ctx.utm({ zone: 33 })).toThrow(/dispose/);
    expect(() => root.toLonLat(x, y)).toThrow(/disposed/);
    expect(() => root.toLonLatInterleaved([x[0]!, y[0]!])).toThrow(/disposed/);
    expect(() => root.toLonLatPoint(x[0]!, y[0]!)).toThrow(/disposed/);
  });

  it('a root projection with a wasm geographic throws once disposed, outputs untouched', async () => {
    const ctx = await loadWasm({ source: url });
    const root = utm({ zone: 50, geographic: ctx.gcj02({ outsideChina: 'transform' }) });
    // 'transform' runs the guarded JavaScript kernel, which fuses; the wasm kernel never does.
    expect(fusers.has(root.geographic!)).toBe(true);
    expect(fusers.has(ctx.gcj02())).toBe(false);
    expect(root.toLonLatPoint(440000, 4420000)).toEqual(
      utm({ zone: 50, geographic: gcj02({ outsideChina: 'transform' }) }).toLonLatPoint(440000, 4420000),
    );
    ctx.dispose();
    const lon = new Float64Array(1);
    const lat = new Float64Array(1);
    expect(() => root.toLonLat([440000], [4420000], lon, lat)).toThrow(/disposed/);
    expect([lon[0], lat[0]]).toEqual([0, 0]);
  });

  it('runs the JavaScript gcj02 kernel for modules without the wasm one', async () => {
    const module = await WebAssembly.compile(readFileSync(url));
    const instantiate = WebAssembly.instantiate;
    const spy = vi.spyOn(WebAssembly, 'instantiate').mockImplementation((async (m: WebAssembly.Module) => {
      const { gcj_forward_batch: _f, gcj_inverse_batch: _i, ...exports } = (await instantiate(m, {})).exports;
      return { exports };
    }) as typeof WebAssembly.instantiate);
    const ctx = await loadWasm({ source: module }).finally(() => spy.mockRestore());
    expect(ctx.backend).toBe('wasm');
    const lon = [116.391, 105.004];
    const lat = [39.907, 30];
    expect(ctx.gcj02().toWgs84(lon, lat)).toEqual(gcj02().toWgs84(lon, lat));
  });

  it('handles gcj02 inputs larger than the 64 Ki-point workspace', async () => {
    const ctx = await loadWasm({ source: url });
    const n = 150001;
    const ll = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      ll[2 * i] = 70 + ((i * 7919) % n) * (70 / n);
      ll[2 * i + 1] = ((i * 104729) % n) * (58 / n);
    }
    const js = gcj02().toWgs84Interleaved(ll);
    const res = ctx.gcj02().toWgs84Interleaved(ll, ll);
    let max = 0;
    for (let i = 0; i < 2 * n; i++) max = Math.max(max, Math.abs(res[i]! - js[i]!));
    expect(max).toBeLessThan(6e-14);
  });
});

describe('dispose', () => {
  it('only the context is disposable', async () => {
    const ctx = await loadWasm({ source: url });
    for (const conv of [ctx.utm({ zone: 33 }), ctx.tmerc({ centralMeridian: 117 }), ctx.gcj02()]) {
      expect('dispose' in conv || Symbol.dispose in conv).toBe(false);
      expect(Object.isFrozen(conv)).toBe(true);
    }
  });

  it('context dispose invalidates its converters and factories', async () => {
    const ctx = await loadWasm({ source: url });
    const a = ctx.utm({ zone: 33 });
    const out = a.toLonLat([500000], [0]);
    ctx[Symbol.dispose]();
    expect(out.lon[0]).toBeCloseTo(15, 12);
    ctx.dispose();
    expect(() => a.fromLonLatPoint(15, 0)).toThrow(/dispose/);
    expect(() => ctx.utm({ zone: 33 })).toThrow(/dispose/);
    expect(() => ctx.tmerc({ centralMeridian: 0 })).toThrow(/dispose/);
  });

  it('gcj02 follows the disposal rules', async () => {
    const ctx = await loadWasm({ source: url });
    const g = ctx.gcj02();
    const h = ctx.gcj02({ outsideChina: 'transform' });
    const [l, p] = g.fromWgs84Interleaved([116.391, 39.907]);
    const [rl, rp] = gcj02().fromWgs84Interleaved([116.391, 39.907]);
    expect(Math.abs(l! - rl!) + Math.abs(p! - rp!)).toBeLessThan(6e-14);
    // 'transform' mode runs the JavaScript kernel.
    expect(h.fromWgs84([0, 116.391], [0, 39.907])).toEqual(
      gcj02({ outsideChina: 'transform' }).fromWgs84([0, 116.391], [0, 39.907]),
    );
    // The option is read once, so point and batch methods agree.
    let reads = 0;
    const m = ctx.gcj02({
      get outsideChina() {
        return ++reads === 1 ? 'transform' : 'passthrough';
      },
    });
    expect(m.fromWgs84([13.4], [52.5]).lon[0]).toBe(m.fromWgs84Point(13.4, 52.5)[0]);
    expect(reads).toBe(1);
    expect(h.toWgs84Point(116, 39)[0]).toBeCloseTo(116, 1);
    ctx.dispose();
    expect(() => g.toWgs84Point(116, 39)).toThrow(/dispose/);
    expect(() => g.fromWgs84Interleaved([116, 39])).toThrow(/dispose/);
    expect(() => h.toWgs84([116], [39])).toThrow(/dispose/);
    expect(() => ctx.gcj02()).toThrow(/dispose/);
  });

  it('JavaScript fallback follows the same disposal rules', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const ctx = await loadWasm().finally(() => vi.unstubAllGlobals());
    expect(ctx.backend).toBe('js');
    const a = ctx.utm({ zone: 33 });
    const g = ctx.gcj02();
    expect(a.toLonLatPoint(500000, 0)[0]).toBeCloseTo(15, 12);
    ctx.dispose();
    expect(() => a.toLonLatPoint(500000, 0)).toThrow(/dispose/);
    expect(() => g.fromWgs84Point(116, 39)).toThrow(/dispose/);
    expect(() => ctx.utm({ zone: 33 })).toThrow(/dispose/);
    expect(() => ctx.tmerc({ centralMeridian: 0 })).toThrow(/dispose/);
    expect(() => ctx.gcj02()).toThrow(/dispose/);
  });

  it('supports using', async () => {
    let conv;
    {
      using ctx = await loadWasm({ source: url });
      conv = ctx.utm({ zone: 33 });
      expect(conv.toLonLatPoint(500000, 0)[0]).toBeCloseTo(15, 12);
    }
    expect(() => conv.toLonLatPoint(500000, 0)).toThrow(/dispose/);
  });

  it('rejects re-entrant calls from array-like getters, then recovers', async () => {
    const ctx = await loadWasm({ source: url });
    const conv = ctx.utm({ zone: 33 });
    const evil = {
      length: 1,
      get 0() {
        return conv.toLonLat([500000], [0]).lon[0]!;
      },
    };
    expect(() => conv.fromLonLat(evil, [0])).toThrow(/re-entrant/);
    expect(conv.fromLonLat([15], [0]).x[0]).toBeCloseTo(500000, 6);
  });

  it('validates options like the JavaScript backend', async () => {
    const ctx = await loadWasm({ source: url });
    expect(() => ctx.utm({ zone: 61 })).toThrow(RangeError);
    expect(() => ctx.utm({ zone: 33, south: 'yes' as unknown as boolean })).toThrow(TypeError);
    expect(() => ctx.tmerc({ centralMeridian: 0, scaleFactor: 0 })).toThrow(RangeError);
    const conv = ctx.utm({ zone: 33 });
    expect(() => conv.toLonLatInterleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => conv.toLonLat([1, 2], [1, 2], new Float64Array(1))).toThrow(RangeError);
  });
});
