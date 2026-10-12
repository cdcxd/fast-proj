// Wasm-backed Utm implementation: full packages/utm `Utm` API surface over
// the simd kernel, with allocate-once scratch buffers in wasm linear memory.
// Feature-detects simd128 and falls back to the TypeScript kernel.
import { utm as tsUtm } from '../../packages/utm/dist/utm.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 124, 3, 2, 1, 0, 10, 13, 1, 11, 0, 65, 0, 253, 12, 0, 0, 0, 0, 0, 0,
  0, 0, 65, 0, 11,
]);

let instancePromise = null;

async function loadInstance() {
  const root = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
  for (const candidate of [`${root}/../build/simd.wasm`, `${homedir()}/.cache/fast-proj/utm-simd.wasm`]) {
    try {
      const bytes = readFileSync(candidate);
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance;
    } catch {
      // try next location
    }
  }
  throw new Error('simd.wasm not found; build with scripts/build.sh');
}

export function simdSupported() {
  try {
    new WebAssembly.Module(SIMD_PROBE);
    return true;
  } catch {
    return false;
  }
}

export async function utmWasm({ zone, south = false, ellipsoid = { a: 6378137, f: 1 / 298.257223563 } }) {
  if (!simdSupported()) {
    return tsUtm({ zone, south, ellipsoid });
  }
  instancePromise ??= loadInstance();
  const { instance } = await instancePromise;
  const e = instance.exports;
  const { a, f } = ellipsoid;
  const southFlag = south ? 1 : 0;

  // allocate-once scratch: batch (4 buffers) + a persistent point pair
  const CAP = 1 << 14; // 16384 points; larger inputs chunk through it
  const bLon = e.alloc(CAP);
  const bLat = e.alloc(CAP);
  const bX = e.alloc(CAP);
  const bY = e.alloc(CAP);
  const pLon = e.alloc(1);
  const pLat = e.alloc(1);
  const pX = e.alloc(1);
  const pY = e.alloc(1);

  const view = (ptr, n) => new Float64Array(e.memory.buffer, ptr, n);

  function checkOut(out, n, name) {
    if (out.length < n) throw new RangeError(`${name} has length ${out.length}, needs at least ${n}`);
  }

  function forwardChunk(srcLon, srcLat, x, y, i0, n) {
    const wLon = view(bLon, n);
    const wLat = view(bLat, n);
    for (let j = 0; j < n; j++) {
      wLon[j] = srcLon[i0 + j];
      wLat[j] = srcLat[i0 + j];
    }
    e.forward_batch(bLon, bLat, bX, bY, n, zone, southFlag, a, f);
    const wX = view(bX, n);
    const wY = view(bY, n);
    for (let j = 0; j < n; j++) {
      x[i0 + j] = wX[j];
      y[i0 + j] = wY[j];
    }
  }

  function inverseChunk(srcX, srcY, lon, lat, i0, n) {
    const wX = view(bX, n);
    const wY = view(bY, n);
    for (let j = 0; j < n; j++) {
      wX[j] = srcX[i0 + j];
      wY[j] = srcY[i0 + j];
    }
    e.inverse_batch(bX, bY, bLon, bLat, n, zone, southFlag, a, f);
    const wLon = view(bLon, n);
    const wLat = view(bLat, n);
    for (let j = 0; j < n; j++) {
      lon[i0 + j] = wLon[j];
      lat[i0 + j] = wLat[j];
    }
  }

  function forwardAll(lonSrc, latSrc, x, y) {
    const n = lonSrc.length;
    for (let i0 = 0; i0 < n; i0 += CAP) {
      forwardChunk(lonSrc, latSrc, x, y, i0, Math.min(CAP, n - i0));
    }
  }

  function inverseAll(xSrc, ySrc, lon, lat) {
    const n = xSrc.length;
    for (let i0 = 0; i0 < n; i0 += CAP) {
      inverseChunk(xSrc, ySrc, lon, lat, i0, Math.min(CAP, n - i0));
    }
  }

  return {
    zone,
    south,
    toLonLat(x, y, lon, lat) {
      const n = x.length;
      if (y.length !== n) throw new RangeError('x and y must have the same length');
      if (lon) checkOut(lon, n, 'lon');
      else lon = new Float64Array(n);
      if (lat) checkOut(lat, n, 'lat');
      else lat = new Float64Array(n);
      inverseAll(x, y, lon, lat);
      return { lon, lat };
    },
    fromLonLat(lon, lat, x, y) {
      const n = lon.length;
      if (lat.length !== n) throw new RangeError('lon and lat must have the same length');
      if (x) checkOut(x, n, 'x');
      else x = new Float64Array(n);
      if (y) checkOut(y, n, 'y');
      else y = new Float64Array(n);
      forwardAll(lon, lat, x, y);
      return { x, y };
    },
    toLonLatInterleaved(xy, out) {
      const n = xy.length;
      if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      const half = n / 2;
      // route interleaved halves through the same scratch, then interleave
      const wX = view(bX, half);
      const wY = view(bY, half);
      for (let i = 0; i < half; i++) {
        wX[i] = xy[2 * i];
        wY[i] = xy[2 * i + 1];
      }
      e.inverse_batch(bX, bY, bLon, bLat, half, zone, southFlag, a, f);
      const wLon = view(bLon, half);
      const wLat = view(bLat, half);
      for (let i = 0; i < half; i++) {
        out[2 * i] = wLon[i];
        out[2 * i + 1] = wLat[i];
      }
      return out;
    },
    fromLonLatInterleaved(lonlat, out) {
      const n = lonlat.length;
      if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      const half = n / 2;
      const wLon = view(bLon, half);
      const wLat = view(bLat, half);
      for (let i = 0; i < half; i++) {
        wLon[i] = lonlat[2 * i];
        wLat[i] = lonlat[2 * i + 1];
      }
      e.forward_batch(bLon, bLat, bX, bY, half, zone, southFlag, a, f);
      const wX = view(bX, half);
      const wY = view(bY, half);
      for (let i = 0; i < half; i++) {
        out[2 * i] = wX[i];
        out[2 * i + 1] = wY[i];
      }
      return out;
    },
    toLonLatPoint(x, y) {
      view(pX, 1)[0] = x;
      view(pY, 1)[0] = y;
      e.inverse_batch(pX, pY, pLon, pLat, 1, zone, southFlag, a, f);
      return [view(pLon, 1)[0], view(pLat, 1)[0]];
    },
    fromLonLatPoint(lon, lat) {
      view(pLon, 1)[0] = lon;
      view(pLat, 1)[0] = lat;
      e.forward_batch(pLon, pLat, pX, pY, 1, zone, southFlag, a, f);
      return [view(pX, 1)[0], view(pY, 1)[0]];
    },
  };
}
