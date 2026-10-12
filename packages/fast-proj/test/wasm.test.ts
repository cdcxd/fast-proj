import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { utm } from '../src/index.js';
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
      expect(ctx.backend).toBe('wasm-simd');
      const got = ctx.utm({ zone: 33 }).fromLonLat([15, 16], [52, -1]);
      expect(Math.abs(got.x[1]! - expected.x[1]!)).toBeLessThan(5e-9);
      ctx.dispose();
    }
  });

  it('reports the scalar build', async () => {
    const ctx = await loadWasm({ source: new URL('../dist/fast-proj-scalar.wasm', import.meta.url) });
    expect(ctx.backend).toBe('wasm');
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
    expect((await loadWasm({ source: url })).backend).toBe('wasm-simd');
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
});

describe('dispose', () => {
  it('converter dispose is idempotent and only affects that converter', async () => {
    const ctx = await loadWasm({ source: url });
    const a = ctx.utm({ zone: 33 });
    const b = ctx.tmerc({ lon0: 117 });
    const out = a.toLonLat([500000], [0]);
    a.dispose();
    a[Symbol.dispose]();
    expect(() => a.toLonLat([500000], [0])).toThrow(/dispose/);
    expect(() => a.fromLonLatInterleaved([15, 0])).toThrow(/dispose/);
    expect(() => a.toLonLatPoint(500000, 0)).toThrow(/dispose/);
    expect(out.lon[0]).toBeCloseTo(15, 12);
    expect(b.fromLonLatPoint(117, 0)[0]).toBeCloseTo(0, 9);
  });

  it('context dispose invalidates its converters and factories', async () => {
    const ctx = await loadWasm({ source: url });
    const a = ctx.utm({ zone: 33 });
    ctx[Symbol.dispose]();
    ctx.dispose();
    expect(() => a.fromLonLatPoint(15, 0)).toThrow(/dispose/);
    expect(() => ctx.utm({ zone: 33 })).toThrow(/dispose/);
    expect(() => ctx.tmerc({ lon0: 0 })).toThrow(/dispose/);
  });

  it('JavaScript fallback follows the same disposal rules', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const ctx = await loadWasm().finally(() => vi.unstubAllGlobals());
    expect(ctx.backend).toBe('js');
    const a = ctx.utm({ zone: 33 });
    expect(a.toLonLatPoint(500000, 0)[0]).toBeCloseTo(15, 12);
    ctx.dispose();
    expect(() => a.toLonLatPoint(500000, 0)).toThrow(/dispose/);
    expect(() => ctx.utm({ zone: 33 })).toThrow(/dispose/);
    expect(() => ctx.tmerc({ lon0: 0 })).toThrow(/dispose/);
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
    expect(() => ctx.tmerc({ lon0: 0, k0: 0 })).toThrow(RangeError);
    const conv = ctx.utm({ zone: 33 });
    expect(() => conv.toLonLatInterleaved([1, 2, 3])).toThrow(RangeError);
    expect(() => conv.toLonLat([1, 2], [1, 2], new Float64Array(1))).toThrow(RangeError);
  });
});
