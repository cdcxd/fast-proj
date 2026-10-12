/**
 * Opt-in WebAssembly backend: one combined Rust module (f64x2 SIMD where supported) behind the same converter
 * interfaces as the JavaScript build. Batch results match the JavaScript backend within 4e-9 m and 6e-14 degrees
 * (longitude differences scaled by cos(latitude), so raw longitudes near the poles differ more); single-point methods
 * run the JavaScript kernel.
 */
/// <reference lib="esnext.disposable" preserve="true" />
import { checkEven, checkOut } from './checks.js';
import { type TransverseMercatorOptions, tmerc as jsTmerc } from './tmerc.js';
import type { TransverseMercator, Utm } from './types.js';
import { type UtmOptions, utm as jsUtm } from './utm.js';

type Loadable = URL | string | ArrayBuffer | ArrayBufferView;

/** A URL (or URL string), the module bytes, or an already compiled module. */
export type WasmSource = Loadable | WebAssembly.Module;

export interface LoadWasmOptions {
  /**
   * Where to load the module from. Default: `fast-proj.wasm` next to this file (`fast-proj-scalar.wasm` without
   * SIMD support), resolved with `new URL(..., import.meta.url)`. Pass bytes or a URL when a bundler doesn't copy the
   * asset.
   */
  source?: WasmSource;
}

export type WasmBackend = 'wasm-simd' | 'wasm' | 'js';

export interface WasmDisposable extends Disposable {
  /** Idempotent. Later calls on the disposed object throw. Output arrays already returned stay valid. */
  dispose(): void;
}

export interface WasmContext extends WasmDisposable {
  /** `js` when WebAssembly is unavailable; converters then run the JavaScript backend. */
  readonly backend: WasmBackend;
  tmerc(options: TransverseMercatorOptions): TransverseMercator & WasmDisposable;
  utm(options: UtmOptions): Utm & WasmDisposable;
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  simd_enabled(): number;
  tm_forward_batch(...args: number[]): void;
  tm_inverse_batch(...args: number[]): void;
}

const CAP = 1 << 16;
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);

// (module (func (result f64) f64x2.extract_lane 0 (v128.const i64x2 0 0)))
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 124, 3, 2, 1, 0, 10, 25, 1, 23, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 253, 33, 0, 11,
]);

// Bundlers rewrite `new URL(variable, import.meta.url)` into an asset context; resolve caller URLs against this instead.
const base = import.meta.url;
const byUrl = new Map<string, Promise<WebAssembly.Module>>();
// Weak, so the cache doesn't keep the caller's bytes (and their whole backing buffer) alive.
const byBytes = new WeakMap<object, Promise<WebAssembly.Module>>();

const REQUIRED = ['alloc', 'simd_enabled', 'tm_forward_batch', 'tm_inverse_batch'] as const;

async function readFileUrl(url: URL): Promise<Uint8Array> {
  const fs = 'node:fs/promises';
  const { readFile } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ fs)) as {
    readFile(u: URL): Promise<Uint8Array>;
  };
  return readFile(url);
}

async function compile(source: Loadable): Promise<WebAssembly.Module> {
  if (typeof source !== 'string' && !(source instanceof URL)) {
    const bytes = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source);
    return WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>);
  }
  const url = new URL(source, base);
  if (url.protocol === 'file:') return WebAssembly.compile((await readFileUrl(url)) as Uint8Array<ArrayBuffer>);
  const response = fetch(url);
  if (typeof WebAssembly.compileStreaming === 'function') {
    try {
      return await WebAssembly.compileStreaming(response);
    } catch (err) {
      // Servers without the application/wasm MIME type: fall back to compiling the bytes.
      if (!(err instanceof TypeError)) throw err;
    }
  }
  const res = await response;
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return WebAssembly.compile(await res.arrayBuffer());
}

/** Returns the cached compile promise and a function evicting it, for compile or initialization failures. */
function getModule(source: Loadable): [Promise<WebAssembly.Module>, () => void] {
  const cache: Map<unknown, Promise<WebAssembly.Module>> | WeakMap<object, Promise<WebAssembly.Module>> =
    typeof source === 'string' || source instanceof URL ? byUrl : byBytes;
  const key = cache === byUrl ? new URL(source as string | URL, base).href : (source as object);
  let promise = cache.get(key as object);
  if (!promise) {
    promise = compile(source);
    cache.set(key as object, promise);
  }
  const evict = () => {
    if (cache.get(key as object) === promise) cache.delete(key as object);
  };
  return [promise, evict];
}

// Also accepts modules compiled in another realm (iframe, Node vm), which fail instanceof.
function isModule(source: WasmSource): source is WebAssembly.Module {
  return Object.prototype.toString.call(source) === '[object WebAssembly.Module]';
}

function jsContext(): WasmContext {
  let disposed = false;
  const live = <T extends object>(conv: T): T & WasmDisposable => {
    let closed = false;
    const guard = () => {
      if (closed || disposed) throw new Error('fast-proj: converter used after dispose()');
    };
    const out = {} as T & WasmDisposable;
    for (const [k, v] of Object.entries(conv)) {
      (out as Record<string, unknown>)[k] = typeof v === 'function' ? (...args: unknown[]) => (guard(), v(...args)) : v;
    }
    out.dispose = () => {
      closed = true;
    };
    out[DISPOSE] = out.dispose;
    return out;
  };
  const open = () => {
    if (disposed) throw new Error('fast-proj: context used after dispose()');
  };
  const ctx: WasmContext = {
    backend: 'js',
    tmerc: (o) => (open(), live(jsTmerc(o))),
    utm: (o) => (open(), live(jsUtm(o))),
    dispose() {
      disposed = true;
    },
    [DISPOSE]() {
      disposed = true;
    },
  };
  return ctx;
}

/**
 * Loads the WebAssembly backend and returns a context owning one instance and a fixed 64 Ki-point workspace (about
 * 2 MiB). The compiled module is cached per source; each call creates a new context. A failed load or
 * initialization can be retried.
 */
export async function loadWasm(options: LoadWasmOptions = {}): Promise<WasmContext> {
  if (typeof WebAssembly === 'undefined') return jsContext();
  const simd = WebAssembly.validate(SIMD_PROBE);
  // Two literal URL expressions, so bundlers such as Vite copy both assets.
  const source =
    options.source ??
    (simd ? new URL('./fast-proj.wasm', import.meta.url) : new URL('./fast-proj-scalar.wasm', import.meta.url));
  let module = source as WebAssembly.Module;
  let evict: (() => void) | undefined;
  if (!isModule(source)) {
    const [promise, ev] = getModule(source);
    evict = ev;
    module = await promise.catch((err: unknown) => {
      ev();
      throw err;
    });
  }
  try {
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports as unknown as Exports;
    if (!(exports.memory instanceof WebAssembly.Memory) || REQUIRED.some((k) => typeof exports[k] !== 'function')) {
      throw new TypeError('fast-proj: not a fast-proj wasm module');
    }
    return wasmContext(exports, exports.simd_enabled() ? 'wasm-simd' : 'wasm');
  } catch (err) {
    evict?.();
    throw err;
  }
}

function wasmContext(exports: Exports, backend: WasmBackend): WasmContext {
  let e: Exports | null = exports;
  let busy = false;
  // The heap is a fixed static arena that never grows, so these views stay valid for the instance lifetime.
  // Reads `e`, not `exports`, so a disposed context doesn't retain the instance.
  const view = (n: number) => new Float64Array(e!.memory.buffer, e!.alloc(n), n);
  let wa: Float64Array | null = view(CAP);
  let wb: Float64Array | null = view(CAP);
  let wc: Float64Array | null = view(CAP);
  let wd: Float64Array | null = view(CAP);
  const pa = wa.byteOffset,
    pb = wb.byteOffset,
    pc = wc.byteOffset,
    pd = wd.byteOffset;

  function enter(closed: boolean): Exports {
    if (closed || !e) throw new Error('fast-proj: converter used after dispose()');
    if (busy) throw new Error('fast-proj: re-entrant call into the wasm backend');
    busy = true;
    return e;
  }

  function build<T extends TransverseMercator>(js: T): T & WasmDisposable {
    const { lon0, k0, falseEasting, falseNorthing } = js;
    const { a, f } = js.ellipsoid;
    let closed = false;

    function run(forward: boolean, sa: ArrayLike<number>, sb: ArrayLike<number>, oa: Float64Array, ob: Float64Array) {
      const ex = enter(closed);
      try {
        const kernel = forward ? ex.tm_forward_batch : ex.tm_inverse_batch;
        const n = sa.length;
        for (let i0 = 0; i0 < n; i0 += CAP) {
          const m = Math.min(CAP, n - i0);
          copyIn(wa!, sa, i0, m);
          copyIn(wb!, sb, i0, m);
          kernel(pa, pb, pc, pd, m, lon0, k0, falseEasting, falseNorthing, a, f);
          copyOut(oa, wc!, i0, m);
          copyOut(ob, wd!, i0, m);
        }
      } finally {
        busy = false;
      }
    }

    function runInterleaved(forward: boolean, src: ArrayLike<number>, out: Float64Array) {
      const ex = enter(closed);
      try {
        const kernel = forward ? ex.tm_forward_batch : ex.tm_inverse_batch;
        const half = src.length / 2;
        const A = wa!,
          B = wb!,
          C = wc!,
          D = wd!;
        for (let i0 = 0; i0 < half; i0 += CAP) {
          const m = Math.min(CAP, half - i0);
          for (let j = 0, k = 2 * i0; j < m; j++, k += 2) {
            A[j] = src[k]!;
            B[j] = src[k + 1]!;
          }
          kernel(pa, pb, pc, pd, m, lon0, k0, falseEasting, falseNorthing, a, f);
          for (let j = 0, k = 2 * i0; j < m; j++, k += 2) {
            out[k] = C[j]!;
            out[k + 1] = D[j]!;
          }
        }
      } finally {
        busy = false;
      }
    }

    function live(): void {
      if (closed || !e) throw new Error('fast-proj: converter used after dispose()');
    }

    const dispose = () => {
      closed = true;
    };
    return {
      ...js,
      toLonLat(x, y, lon, lat) {
        const n = x.length;
        if (y.length !== n) throw new RangeError('x and y must have the same length');
        if (lon) checkOut(lon, n, 'lon');
        else lon = new Float64Array(n);
        if (lat) checkOut(lat, n, 'lat');
        else lat = new Float64Array(n);
        run(false, x, y, lon, lat);
        return { lon, lat };
      },
      fromLonLat(lon, lat, x, y) {
        const n = lon.length;
        if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
        if (x) checkOut(x, n, 'x');
        else x = new Float64Array(n);
        if (y) checkOut(y, n, 'y');
        else y = new Float64Array(n);
        run(true, lon, lat, x, y);
        return { x, y };
      },
      toLonLatInterleaved(xy, out) {
        const n = xy.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(false, xy, out);
        return out;
      },
      fromLonLatInterleaved(lonlat, out) {
        const n = lonlat.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(true, lonlat, out);
        return out;
      },
      // A single point costs more to pass into wasm than to compute; the JavaScript kernel handles it.
      toLonLatPoint: (x, y) => (live(), js.toLonLatPoint(x, y)),
      fromLonLatPoint: (lon, lat) => (live(), js.fromLonLatPoint(lon, lat)),
      dispose,
      [DISPOSE]: dispose,
    };
  }

  const dispose = () => {
    if (busy) throw new Error('fast-proj: dispose() during an active call');
    e = null;
    wa = wb = wc = wd = null;
  };
  return {
    backend,
    tmerc: (o) => {
      if (!e) throw new Error('fast-proj: context used after dispose()');
      return build(jsTmerc(o));
    },
    utm: (o) => {
      if (!e) throw new Error('fast-proj: context used after dispose()');
      return build(jsUtm(o));
    },
    dispose,
    [DISPOSE]: dispose,
  };
}

function copyIn(dst: Float64Array, src: ArrayLike<number>, i0: number, n: number): void {
  if (src instanceof Float64Array) dst.set(src.subarray(i0, i0 + n));
  else for (let j = 0; j < n; j++) dst[j] = src[i0 + j]!;
}

function copyOut(dst: Float64Array, src: Float64Array, i0: number, n: number): void {
  dst.set(src.subarray(0, n), i0);
}
