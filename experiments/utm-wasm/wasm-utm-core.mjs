// Environment-agnostic core of the wasm-backed Utm wrapper: builds a full
// packages/utm `Utm` API surface over an instantiated simd kernel's exports.
// No node builtins and no imports outside this directory, so the same core
// serves the node wrapper (wasm-utm.mjs) and the self-contained bench/browser
// candidate (utm.js).

export function simdSupported() {
  // (module (func (result f64) f64x2.extract_lane 0 (v128.const i64x2 0 0)))
  // verified to compile+run on Node 24 / Bun 1.4 / Chromium 150
  const probe = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 124, 3, 2, 1, 0, 10, 25, 1, 23, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 253, 33, 0, 11,
  ]);
  return WebAssembly.validate(probe);
}

// memcpy-grade copies when both sides are typed arrays; element loops otherwise.
function copyIn(dst, src, i0, n) {
  if (src.subarray) dst.set(src.subarray(i0, i0 + n));
  else for (let j = 0; j < n; j++) dst[j] = src[i0 + j];
}
function copyOut(dst, src, i0, n) {
  if (dst.set && src.subarray) dst.set(src.subarray(0, n), i0);
  else for (let j = 0; j < n; j++) dst[i0 + j] = src[j];
}

function checkOut(out, n, name) {
  if (out.length < n) throw new RangeError(`${name} has length ${out.length}, needs at least ${n}`);
}

export function createConverter(e, { zone, south = false, ellipsoid = { a: 6378137, f: 1 / 298.257223563 } }) {
  // mirror the TypeScript API's option validation so the wasm path and the TS
  // fallback reject the same inputs (messages match packages/utm/src)
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new RangeError(`UTM zone must be an integer in 1-60, got ${zone}`);
  }
  if (typeof south !== 'boolean') throw new TypeError(`south must be a boolean, got ${typeof south}`);
  const { a, f } = ellipsoid;
  if (!(a > 0 && a < Infinity)) throw new RangeError(`ellipsoid.a must be a positive finite number, got ${a}`);
  if (!(f >= 0 && f < 0.01)) throw new RangeError(`ellipsoid.f must satisfy 0 <= f < 0.01, got ${f}`);
  const southFlag = south ? 1 : 0;

  // allocate-once scratch: batch (4 buffers) + a persistent point pair.
  // The wasm heap is a fixed 256 MiB arena that never grows, so views over it
  // stay valid for the instance lifetime and are cached here once.
  const CAP = 1 << 16; // 65536 points per kernel call (2 MiB scratch); larger inputs chunk
  const bLon = e.alloc(CAP);
  const bLat = e.alloc(CAP);
  const bX = e.alloc(CAP);
  const bY = e.alloc(CAP);
  const pLon = e.alloc(1);
  const pLat = e.alloc(1);
  const pX = e.alloc(1);
  const pY = e.alloc(1);

  const view = (ptr, n) => new Float64Array(e.memory.buffer, ptr, n);
  const wLon = view(bLon, CAP);
  const wLat = view(bLat, CAP);
  const wX = view(bX, CAP);
  const wY = view(bY, CAP);
  const pLonV = view(pLon, 1);
  const pLatV = view(pLat, 1);
  const pXV = view(pX, 1);
  const pYV = view(pY, 1);

  function forwardChunk(srcLon, srcLat, x, y, i0, n) {
    copyIn(wLon, srcLon, i0, n);
    copyIn(wLat, srcLat, i0, n);
    e.forward_batch(bLon, bLat, bX, bY, n, zone, southFlag, a, f);
    copyOut(x, wX, i0, n);
    copyOut(y, wY, i0, n);
  }

  function inverseChunk(srcX, srcY, lon, lat, i0, n) {
    copyIn(wX, srcX, i0, n);
    copyIn(wY, srcY, i0, n);
    e.inverse_batch(bX, bY, bLon, bLat, n, zone, southFlag, a, f);
    copyOut(lon, wLon, i0, n);
    copyOut(lat, wLat, i0, n);
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
    kernel: 'wasm-simd',
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
      // interleave/deinterleave through the same CAP-sized scratch as the
      // batch forms; the strided loops cannot use .set, so they run per chunk
      for (let i0 = 0; i0 < half; i0 += CAP) {
        const m = Math.min(CAP, half - i0);
        for (let j = 0; j < m; j++) {
          wX[j] = xy[2 * (i0 + j)];
          wY[j] = xy[2 * (i0 + j) + 1];
        }
        e.inverse_batch(bX, bY, bLon, bLat, m, zone, southFlag, a, f);
        for (let j = 0; j < m; j++) {
          out[2 * (i0 + j)] = wLon[j];
          out[2 * (i0 + j) + 1] = wLat[j];
        }
      }
      return out;
    },
    fromLonLatInterleaved(lonlat, out) {
      const n = lonlat.length;
      if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
      if (out) checkOut(out, n, 'out');
      else out = new Float64Array(n);
      const half = n / 2;
      for (let i0 = 0; i0 < half; i0 += CAP) {
        const m = Math.min(CAP, half - i0);
        for (let j = 0; j < m; j++) {
          wLon[j] = lonlat[2 * (i0 + j)];
          wLat[j] = lonlat[2 * (i0 + j) + 1];
        }
        e.forward_batch(bLon, bLat, bX, bY, m, zone, southFlag, a, f);
        for (let j = 0; j < m; j++) {
          out[2 * (i0 + j)] = wX[j];
          out[2 * (i0 + j) + 1] = wY[j];
        }
      }
      return out;
    },
    toLonLatPoint(x, y) {
      pXV[0] = x;
      pYV[0] = y;
      e.inverse_batch(pX, pY, pLon, pLat, 1, zone, southFlag, a, f);
      return [pLonV[0], pLatV[0]];
    },
    fromLonLatPoint(lon, lat) {
      pLonV[0] = lon;
      pLatV[0] = lat;
      e.forward_batch(pLon, pLat, pX, pY, 1, zone, southFlag, a, f);
      return [pXV[0], pYV[0]];
    },
  };
}
