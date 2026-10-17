/**
 * Opt-in WebAssembly backend: one combined Rust module (f64x2 SIMD where supported) behind the same converter
 * interfaces as the JavaScript build. Batch results match the JavaScript backend within 4e-9 m and 6e-14 degrees
 * (longitude differences scaled by cos(latitude), so raw longitudes near the poles differ more), or one ulp of
 * outputs above 2^25 m; single-point methods run the JavaScript kernel. Composed with GCJ-02, results near
 * longitude 105 (the formula's cusp), the China box edge, and the poles in 'transform' mode can differ more; see
 * docs/api.md.
 */
/// <reference lib="esnext.disposable" preserve="true" />
import { checkEven, checkOptions, checkOut, checkSame } from './checks.js';
import { type Gcj02Options, buildGcj02, gcj02Mode } from './gcj02.js';
import { fusers, withGeographic } from './geographic.js';
import { type TransverseMercatorOptions, parseTmerc, tmerc as jsTmerc } from './tmerc.js';
import type { Geographic, TransverseMercator, Utm } from './types.js';
import { type UtmOptions, parseUtm, utm as jsUtm } from './utm.js';

type Loadable = URL | string | ArrayBuffer | ArrayBufferView;

/** A URL (or URL string), the module bytes, or an already compiled module. */
export type WasmSource = Loadable | WebAssembly.Module;

export interface LoadWasmOptions {
  /**
   * Where to load the module from. Default: `fast-proj.wasm` next to this file, resolved with
   * `new URL('./fast-proj.wasm', import.meta.url)`. Pass bytes or a URL when a bundler doesn't copy the
   * asset. Relative URL strings resolve against the page URL in browsers.
   */
  source?: WasmSource;
}

export type WasmBackend = 'wasm' | 'js';

/**
 * Same factories as the root entry. Converters hold no resources of their own: they stay valid until the context is
 * disposed, and throw after that.
 */
export interface WasmContext extends Disposable {
  /**
   * `js` when WebAssembly or wasm SIMD is unavailable (a `source` that doesn't compile without SIMD, or a custom
   * non-SIMD build, also falls back); converters then run the JavaScript backend.
   */
  readonly backend: WasmBackend;
  tmerc(options: TransverseMercatorOptions): TransverseMercator;
  utm(options: UtmOptions): Utm;
  /**
   * Batch methods run the wasm kernel in `'passthrough'` mode; `'transform'` mode, single points, and the `js`
   * backend run the JavaScript kernel.
   */
  gcj02(options?: Gcj02Options): Geographic;
  /** Idempotent. Output arrays already returned stay valid. */
  dispose(): void;
}

// centralMeridian, scaleFactor, falseEasting, falseNorthing, a, f
type TmParams = [number, number, number, number, number, number];

interface Exports {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  simd_enabled(): number;
  tm_forward_batch(lon: number, lat: number, x: number, y: number, n: number, ...params: TmParams): void;
  tm_inverse_batch(x: number, y: number, lon: number, lat: number, n: number, ...params: TmParams): void;
  // Absent from builds without simd128 and from modules older than 0.2.1.
  gcj_forward_batch?(lon: number, lat: number, outLon: number, outLat: number, n: number): void;
  gcj_inverse_batch?(lon: number, lat: number, outLon: number, outLat: number, n: number): void;
}

const CAP = 1 << 16;
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);

// (module (func (result f64) f64x2.extract_lane 0 (v128.const i64x2 0 0)))
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 124, 3, 2, 1, 0, 10, 25, 1, 23, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 253, 33, 0, 11,
]);

const moduleUrl = import.meta.url;
const runtime = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };

// Caller URLs resolve like fetch: against the page (or worker) URL in browsers, else against this module. Not
// `new URL(variable, import.meta.url)`: bundlers rewrite that into an asset context, and may replace import.meta.url
// with a build-time file: URL.
function base(): string {
  return runtime.document?.baseURI ?? runtime.location?.href ?? moduleUrl;
}
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

// Tags rather than instanceof, so values from another realm (iframe, Node vm) are recognized.
function isUrl(source: unknown): source is string | URL {
  return typeof source === 'string' || Object.prototype.toString.call(source) === '[object URL]';
}

function isArrayBuffer(source: unknown): source is ArrayBuffer {
  return Object.prototype.toString.call(source) === '[object ArrayBuffer]';
}

function isModule(source: unknown): source is WebAssembly.Module {
  return Object.prototype.toString.call(source) === '[object WebAssembly.Module]';
}

async function compile(source: Loadable): Promise<WebAssembly.Module> {
  if (!isUrl(source)) {
    const bytes = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source);
    return WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>);
  }
  const url = new URL(source, base());
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
  if (!res.ok) throw new Error(`fast-proj: failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return WebAssembly.compile(await res.arrayBuffer());
}

/** Returns the cached compile promise and a function evicting it, for compile or initialization failures. */
function getModule(source: Loadable): [Promise<WebAssembly.Module>, () => void] {
  const url = isUrl(source);
  const cache = (url ? byUrl : byBytes) as Map<unknown, Promise<WebAssembly.Module>>;
  const key = url ? new URL(source, base()).href : source;
  let promise = cache.get(key);
  if (!promise) {
    promise = compile(source);
    cache.set(key, promise);
  }
  const evict = () => {
    if (cache.get(key) === promise) cache.delete(key);
  };
  return [promise, evict];
}

// Wraps a JavaScript converter so it throws once its context is disposed. A wrapped geographic system keeps fusing
// with JavaScript projections, checking per call.
function guarded<T extends object>(conv: T, disposed: () => boolean): T {
  const guard = () => {
    if (disposed()) throw new Error('fast-proj: converter used after its wasm context was disposed');
  };
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(conv)) {
    out[k] = typeof v === 'function' ? (...args: unknown[]) => (guard(), v(...args)) : v;
  }
  Object.freeze(out);
  const fuse = fusers.get(conv as unknown as Geographic);
  if (fuse) {
    fusers.set(out as unknown as Geographic, (t) => {
      const f = fuse(t);
      return {
        batch: (a, b, outA, outB, o1, step, end) => (guard(), f.batch(a, b, outA, outB, o1, step, end)),
        point: (x, y) => (guard(), f.point(x, y)),
      };
    });
  }
  return out as T;
}

function jsContext(): WasmContext {
  let disposed = false;
  const live = <T extends object>(conv: T): T => guarded(conv, () => disposed);
  const open = () => {
    if (disposed) throw new Error('fast-proj: context used after dispose()');
  };
  // One converter per mode, as for the root gcj02().
  const gcj: Partial<Record<'passthrough' | 'transform', Geographic>> = {};
  const ctx: WasmContext = {
    backend: 'js',
    tmerc: (o) => (open(), live(jsTmerc(o))),
    utm: (o) => (open(), live(jsUtm(o))),
    gcj02: (o) => {
      open();
      const mode = gcj02Mode(o);
      return (gcj[mode] ??= live(buildGcj02(mode)));
    },
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
  checkOptions(options, 'loadWasm', ['source']);
  const { source: given } = options;
  if (given !== undefined && !isUrl(given) && !isModule(given) && !ArrayBuffer.isView(given) && !isArrayBuffer(given)) {
    throw new TypeError('fast-proj: source must be a URL, string, ArrayBuffer, ArrayBufferView or WebAssembly.Module');
  }
  if (typeof WebAssembly === 'undefined') return jsContext();
  // A scalar wasm build measured no faster than the JavaScript kernel, so engines without SIMD use that.
  const simd = WebAssembly.validate(SIMD_PROBE);
  if (given === undefined && !simd) return jsContext();
  // A literal URL expression, so bundlers such as Vite and webpack copy the asset.
  const source = given ?? new URL('./fast-proj.wasm', import.meta.url);
  let module = source as WebAssembly.Module;
  let evict: (() => void) | undefined;
  if (!isModule(source)) {
    const [promise, ev] = getModule(source);
    evict = ev;
    try {
      module = await promise;
    } catch (err) {
      ev();
      // A SIMD module given as `source` can't compile here either.
      if (!simd && err instanceof WebAssembly.CompileError) return jsContext();
      throw err;
    }
  }
  try {
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports as unknown as Exports;
    if (!(exports.memory instanceof WebAssembly.Memory) || REQUIRED.some((k) => typeof exports[k] !== 'function')) {
      throw new TypeError('fast-proj: not a fast-proj wasm module');
    }
    // A scalar build is no faster than the JavaScript kernel (see above).
    return exports.simd_enabled() ? wasmContext(exports) : jsContext();
  } catch (err) {
    evict?.();
    throw err;
  }
}

function wasmContext(exports: Exports): WasmContext {
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

  function enter(): Exports {
    if (!e) throw new Error('fast-proj: converter used after its wasm context was disposed');
    if (busy) throw new Error('fast-proj: re-entrant call into the wasm backend');
    busy = true;
    return e;
  }

  type Kernel = (ex: Exports, m: number) => void;

  function run(kernel: Kernel, sa: ArrayLike<number>, sb: ArrayLike<number>, oa: Float64Array, ob: Float64Array) {
    const ex = enter();
    try {
      const n = sa.length;
      for (let i0 = 0; i0 < n; i0 += CAP) {
        const m = Math.min(CAP, n - i0);
        copyIn(wa!, sa, i0, m);
        copyIn(wb!, sb, i0, m);
        kernel(ex, m);
        copyOut(oa, wc!, i0, m);
        copyOut(ob, wd!, i0, m);
      }
    } finally {
      busy = false;
    }
  }

  function runInterleaved(kernel: Kernel, src: ArrayLike<number>, out: Float64Array) {
    const ex = enter();
    try {
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
        kernel(ex, m);
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
    if (!e) throw new Error('fast-proj: converter used after its wasm context was disposed');
  }

  function buildTmerc<T extends TransverseMercator>(js: T): T {
    const { centralMeridian: lon0, scaleFactor: k0, falseEasting, falseNorthing } = js;
    const { a, f } = js.ellipsoid;
    const fwd: Kernel = (ex, m) => ex.tm_forward_batch(pa, pb, pc, pd, m, lon0, k0, falseEasting, falseNorthing, a, f);
    const inv: Kernel = (ex, m) => ex.tm_inverse_batch(pa, pb, pc, pd, m, lon0, k0, falseEasting, falseNorthing, a, f);
    return {
      ...js,
      toLonLat(x, y, lon, lat) {
        const n = x.length;
        checkSame(n, y.length, 'x and y');
        if (lon) checkOut(lon, n, 'lon');
        else lon = new Float64Array(n);
        if (lat) checkOut(lat, n, 'lat');
        else lat = new Float64Array(n);
        run(inv, x, y, lon, lat);
        return { lon, lat };
      },
      fromLonLat(lon, lat, x, y) {
        const n = lon.length;
        checkSame(n, lat.length, 'lon and lat');
        if (x) checkOut(x, n, 'x');
        else x = new Float64Array(n);
        if (y) checkOut(y, n, 'y');
        else y = new Float64Array(n);
        run(fwd, lon, lat, x, y);
        return { x, y };
      },
      toLonLatInterleaved(xy, out) {
        const n = xy.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(inv, xy, out);
        return out;
      },
      fromLonLatInterleaved(lonlat, out) {
        const n = lonlat.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(fwd, lonlat, out);
        return out;
      },
      // A single point costs more to pass into wasm than to compute; the JavaScript kernel handles it.
      toLonLatPoint: (x, y) => (live(), js.toLonLatPoint(x, y)),
      fromLonLatPoint: (lon, lat) => (live(), js.fromLonLatPoint(lon, lat)),
    };
  }

  const gcjFwd: Kernel = (ex, m) => ex.gcj_forward_batch!(pa, pb, pc, pd, m);
  const gcjInv: Kernel = (ex, m) => ex.gcj_inverse_batch!(pa, pb, pc, pd, m);

  function buildGcj(js: Geographic): Geographic {
    return Object.freeze({
      toWgs84(lon, lat, outLon, outLat) {
        const n = lon.length;
        checkSame(n, lat.length, 'lon and lat');
        if (outLon) checkOut(outLon, n, 'outLon');
        else outLon = new Float64Array(n);
        if (outLat) checkOut(outLat, n, 'outLat');
        else outLat = new Float64Array(n);
        run(gcjInv, lon, lat, outLon, outLat);
        return { lon: outLon, lat: outLat };
      },
      fromWgs84(lon, lat, outLon, outLat) {
        const n = lon.length;
        checkSame(n, lat.length, 'lon and lat');
        if (outLon) checkOut(outLon, n, 'outLon');
        else outLon = new Float64Array(n);
        if (outLat) checkOut(outLat, n, 'outLat');
        else outLat = new Float64Array(n);
        run(gcjFwd, lon, lat, outLon, outLat);
        return { lon: outLon, lat: outLat };
      },
      toWgs84Interleaved(lonlat, out) {
        const n = lonlat.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(gcjInv, lonlat, out);
        return out;
      },
      fromWgs84Interleaved(lonlat, out) {
        const n = lonlat.length;
        checkEven(n);
        if (out) checkOut(out, n, 'out');
        else out = new Float64Array(n);
        runInterleaved(gcjFwd, lonlat, out);
        return out;
      },
      toWgs84Point: (lon, lat) => (live(), js.toWgs84Point(lon, lat)),
      fromWgs84Point: (lon, lat) => (live(), js.fromWgs84Point(lon, lat)),
    } satisfies Geographic);
  }

  // One converter per mode, as for the root gcj02().
  const gcj: Partial<Record<'passthrough' | 'transform', Geographic>> = {};
  const dispose = () => {
    if (busy) throw new Error('fast-proj: dispose() during an active call');
    e = null;
    wa = wb = wc = wd = null;
  };
  const open = () => {
    if (!e) throw new Error('fast-proj: context used after dispose()');
    return e;
  };
  return {
    backend: 'wasm',
    tmerc: (o) => {
      open();
      const [p, g] = parseTmerc(o);
      return withGeographic(buildTmerc(p), g, live);
    },
    utm: (o) => {
      open();
      const [p, g] = parseUtm(o);
      return withGeographic(buildTmerc(p), g, live);
    },
    gcj02: (o) => {
      const ex = open();
      const mode = gcj02Mode(o);
      const js = buildGcj02(mode);
      // 'transform' mode iterates to a tolerance per point, which the fixed-step kernel doesn't do.
      return (gcj[mode] ??=
        mode === 'transform' || !ex.gcj_forward_batch || !ex.gcj_inverse_batch ? guarded(js, () => !e) : buildGcj(js));
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
