// Wrapper-level gate for wasm-utm.mjs: exercises the shipping API surface —
// chunk boundaries around CAP, plain-Array sources (element-loop path), out-param
// validation, interleaved/point forms — against the TypeScript kernel.
// Run: node bench/wrapper-checks.mjs  /  bun bench/wrapper-checks.mjs
import { utm as tsUtm } from '../../../packages/utm/dist/utm.js';
import { utmWasm } from '../wasm-utm.mjs';

let failures = 0;
function gate(name, ok, detail = '') {
  if (!ok) {
    failures++;
    console.error(`XX ${name}: ${detail}`);
  }
}

const CAP = 1 << 16;
const zone = 33;
const ts = tsUtm({ zone });
const w = await utmWasm({ zone });
gate('wasm path taken', w.kernel === 'wasm-simd', `kernel=${w.kernel} (TS fallback active — simd probe broken?)`);

function makeData(n, seed = 1) {
  const lon = new Float64Array(n),
    lat = new Float64Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    lon[i] = 12 + rnd() * 4;
    lat[i] = -40 + rnd() * 80;
  }
  return { lon, lat };
}

function maxAbs(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

// sizes crossing the CAP chunk boundary in every direction
for (const n of [1, 2, 7, 1000, CAP - 1, CAP, CAP + 1, CAP + 513, 2 * CAP + 7]) {
  const { lon, lat } = makeData(n, n);
  const t = ts.fromLonLat(lon, lat);
  const r = w.fromLonLat(lon, lat);
  const dx = maxAbs(r.x, t.x),
    dy = maxAbs(r.y, t.y);
  gate(`fwd n=${n}`, dx <= 5e-9 && dy <= 5e-9, `dx ${dx.toExponential(2)} dy ${dy.toExponential(2)}`);

  const ti = ts.toLonLat(t.x, t.y);
  const ri = w.toLonLat(t.x, t.y);
  const dlon = maxAbs(ri.lon, ti.lon),
    dlat = maxAbs(ri.lat, ti.lat);
  gate(`inv n=${n}`, dlon <= 1e-13 && dlat <= 1e-13, `dlon ${dlon.toExponential(2)} dlat ${dlat.toExponential(2)}`);

  // out-param form: caller-supplied typed arrays get filled, return aliases them
  const ox = new Float64Array(n),
    oy = new Float64Array(n);
  const ret = w.fromLonLat(lon, lat, ox, oy);
  gate(`fwd out n=${n}`, ret.x === ox && ret.y === oy && maxAbs(ox, t.x) <= 5e-9);
}

// plain Array sources take the element-loop copy path
{
  const { lon, lat } = makeData(33, 7);
  const t = ts.fromLonLat(lon, lat);
  const r = w.fromLonLat(Array.from(lon), Array.from(lat));
  gate('plain array src', maxAbs(r.x, t.x) <= 5e-9 && maxAbs(r.y, t.y) <= 5e-9);
}

// length-mismatch and short out params throw RangeError
{
  let threw = false;
  try {
    w.fromLonLat(new Float64Array(4), new Float64Array(3));
  } catch (e) {
    threw = e instanceof RangeError;
  }
  gate('mismatch throws', threw);
  threw = false;
  try {
    w.fromLonLat(new Float64Array(4), new Float64Array(4), new Float64Array(2), new Float64Array(4));
  } catch (e) {
    threw = e instanceof RangeError;
  }
  gate('short out throws', threw);
  threw = false;
  try {
    w.toLonLatInterleaved(new Float64Array(3));
  } catch (e) {
    threw = e instanceof RangeError;
  }
  gate('odd interleaved throws', threw);
}

// interleaved forms across the CAP chunk boundary (regression: they used to
// run a single unchunked kernel call and returned NaN past 65536 points)
{
  const half = CAP + 7;
  const { lon, lat } = makeData(half, 17);
  const t = ts.fromLonLat(lon, lat);
  const lonlat = new Float64Array(2 * half);
  for (let i = 0; i < half; i++) {
    lonlat[2 * i] = lon[i];
    lonlat[2 * i + 1] = lat[i];
  }
  const r = w.fromLonLatInterleaved(lonlat);
  const flat = new Float64Array(2 * half);
  for (let i = 0; i < half; i++) {
    flat[2 * i] = t.x[i];
    flat[2 * i + 1] = t.y[i];
  }
  let bad = 0;
  for (let i = 0; i < 2 * half; i++) if (!(Math.abs(r[i] - flat[i]) <= 5e-9)) bad++;
  gate('interleaved fwd > CAP', bad === 0, `${bad} mismatched outputs`);

  const xy = new Float64Array(2 * half);
  for (let i = 0; i < half; i++) {
    xy[2 * i] = t.x[i];
    xy[2 * i + 1] = t.y[i];
  }
  const ri = w.toLonLatInterleaved(xy);
  const ti = ts.toLonLat(t.x, t.y);
  bad = 0;
  for (let i = 0; i < half; i++) {
    if (!(Math.abs(ri[2 * i] - ti.lon[i]) <= 1e-13 && Math.abs(ri[2 * i + 1] - ti.lat[i]) <= 1e-13)) bad++;
  }
  gate('interleaved inv > CAP', bad === 0, `${bad} mismatched outputs`);
}

// option validation matches the TypeScript API on the wasm path
// (awaits are serial on purpose: each must throw before the next runs)
/* eslint-disable no-await-in-loop */
{
  for (const z of [0, 61, 33.5, NaN]) {
    let threw = false;
    try {
      await utmWasm({ zone: z });
    } catch (err) {
      threw = err instanceof RangeError && /1-60/.test(err.message);
    }
    gate(`zone ${z} throws`, threw);
  }
  let tthrew = false;
  try {
    await utmWasm({ zone: 33, south: 1 });
  } catch (err) {
    tthrew = err instanceof TypeError && /south must/.test(err.message);
  }
  gate('south type throws', tthrew);
  let threw = false;
  try {
    await utmWasm({ zone: 33, ellipsoid: { a: 6378137, f: 0.02 } });
  } catch (err) {
    threw = err instanceof RangeError && /f must/.test(err.message);
  }
  gate('flattening throws', threw);
  threw = false;
  try {
    await utmWasm({ zone: 33, ellipsoid: { a: -1, f: 0.1 } });
  } catch (err) {
    threw = err instanceof RangeError && /a must/.test(err.message);
  }
  gate('semi-axis throws', threw);
}
// interleaved + point forms agree with the batch form
{
  const { lon, lat } = makeData(257, 11);
  const t = ts.fromLonLat(lon, lat);
  const xy = new Float64Array(2 * lon.length);
  for (let i = 0; i < lon.length; i++) {
    xy[2 * i] = t.x[i];
    xy[2 * i + 1] = t.y[i];
  }
  const ri = w.toLonLatInterleaved(xy);
  const ti = ts.toLonLat(t.x, t.y);
  gate(
    'inv interleaved',
    maxAbs(
      ri,
      (() => {
        const o = new Float64Array(xy.length);
        for (let i = 0; i < lon.length; i++) {
          o[2 * i] = ti.lon[i];
          o[2 * i + 1] = ti.lat[i];
        }
        return o;
      })(),
    ) <= 2e-13,
  );

  const p = w.fromLonLatPoint(lon[0], lat[0]);
  gate('point fwd', Math.abs(p[0] - t.x[0]) <= 5e-9 && Math.abs(p[1] - t.y[0]) <= 5e-9);
  const q = w.toLonLatPoint(t.x[0], t.y[0]);
  gate('point inv', Math.abs(q[0] - ti.lon[0]) <= 1e-13 && Math.abs(q[1] - ti.lat[0]) <= 1e-13);
}

// south hemisphere + non-default ellipsoid go through the same paths
{
  const ws = await utmWasm({ zone: 31, south: true, ellipsoid: { a: 6378137, f: 1 / 298.257222101 } });
  const tss = tsUtm({ zone: 31, south: true, ellipsoid: { a: 6378137, f: 1 / 298.257222101 } });
  const { lon, lat } = makeData(100, 13);
  const t = tss.fromLonLat(lon, lat);
  const r = ws.fromLonLat(lon, lat);
  gate('south GRS80', maxAbs(r.x, t.x) <= 5e-9 && maxAbs(r.y, t.y) <= 5e-9);
}

// signed zero: an equator point with y = -0 must come back as latitude -0,
// exactly like the TypeScript kernel (sin(±0) sign in the wasm kernel)
{
  const [, tsLat] = ts.toLonLatPoint(166000, -0);
  const [, wLat] = w.toLonLatPoint(166000, -0);
  gate(
    'inv -0 northing keeps -0 (point)',
    Object.is(wLat, tsLat) && Object.is(wLat, -0),
    `wasm ${wLat} vs ts ${tsLat}`,
  );
  const wb = w.toLonLat([166000], [-0]);
  gate('inv -0 northing keeps -0 (batch)', Object.is(wb.lat[0], -0), String(wb.lat[0]));
}

// array-likes with a bogus `subarray` property take the element loops
{
  const x = { 0: 166000, 1: 166000, length: 2, subarray: 'metadata' };
  const y = { 0: 1e6, 1: 2e6, length: 2, set: 'nope' };
  const t = ts.toLonLat({ ...x }, { ...y });
  const r = w.toLonLat(x, y);
  gate(
    'array-like with bogus subarray/set',
    Math.abs(r.lon[0] - t.lon[0]) <= 1e-13 && Math.abs(r.lat[1] - t.lat[1]) <= 1e-13,
  );
}

// a host with no WebAssembly at all (node --jitless) must not throw from the
// feature probe; it reports unsupported so the TS fallback can take over
{
  const { simdSupported } = await import('../wasm-utm-core.mjs');
  const saved = globalThis.WebAssembly;
  globalThis.WebAssembly = undefined;
  try {
    gate('simdSupported() without WebAssembly', simdSupported() === false);
  } finally {
    globalThis.WebAssembly = saved;
  }
}

if (failures === 0) console.log('WRAPPER_CHECKS_PASS');
else {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
