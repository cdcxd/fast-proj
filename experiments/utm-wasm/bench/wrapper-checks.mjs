// Wrapper-level gate for wasm-utm.mjs: exercises the shipping API surface —
// chunk boundaries around CAP, plain-Array sources (element-loop path), out-param
// validation, interleaved/point forms — against the TypeScript kernel.
// Run: node bench/wrapper-checks.mjs  /  bun bench/wrapper-checks.mjs
import { utm as tsUtm } from "../../../packages/utm/dist/utm.js";
import { utmWasm } from "../wasm-utm.mjs";

let failures = 0;
function gate(name, ok, detail = "") {
  if (!ok) {
    failures++;
    console.error(`XX ${name}: ${detail}`);
  }
}

const CAP = 1 << 16;
const zone = 33;
const ts = tsUtm({ zone });
const w = await utmWasm({ zone });
gate("wasm path taken", w.kernel === "wasm-simd", `kernel=${w.kernel} (TS fallback active — simd probe broken?)`);

function makeData(n, seed = 1) {
  const lon = new Float64Array(n), lat = new Float64Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
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
  const dx = maxAbs(r.x, t.x), dy = maxAbs(r.y, t.y);
  gate(`fwd n=${n}`, dx <= 5e-9 && dy <= 5e-9, `dx ${dx.toExponential(2)} dy ${dy.toExponential(2)}`);

  const ti = ts.toLonLat(t.x, t.y);
  const ri = w.toLonLat(t.x, t.y);
  const dlon = maxAbs(ri.lon, ti.lon), dlat = maxAbs(ri.lat, ti.lat);
  gate(`inv n=${n}`, dlon <= 1e-13 && dlat <= 1e-13, `dlon ${dlon.toExponential(2)} dlat ${dlat.toExponential(2)}`);

  // out-param form: caller-supplied typed arrays get filled, return aliases them
  const ox = new Float64Array(n), oy = new Float64Array(n);
  const ret = w.fromLonLat(lon, lat, ox, oy);
  gate(`fwd out n=${n}`, ret.x === ox && ret.y === oy && maxAbs(ox, t.x) <= 5e-9);
}

// plain Array sources take the element-loop copy path
{
  const { lon, lat } = makeData(33, 7);
  const t = ts.fromLonLat(lon, lat);
  const r = w.fromLonLat(Array.from(lon), Array.from(lat));
  gate("plain array src", maxAbs(r.x, t.x) <= 5e-9 && maxAbs(r.y, t.y) <= 5e-9);
}

// length-mismatch and short out params throw RangeError
{
  let threw = false;
  try { w.fromLonLat(new Float64Array(4), new Float64Array(3)); } catch (e) { threw = e instanceof RangeError; }
  gate("mismatch throws", threw);
  threw = false;
  try { w.fromLonLat(new Float64Array(4), new Float64Array(4), new Float64Array(2), new Float64Array(4)); } catch (e) { threw = e instanceof RangeError; }
  gate("short out throws", threw);
  threw = false;
  try { w.toLonLatInterleaved(new Float64Array(3)); } catch (e) { threw = e instanceof RangeError; }
  gate("odd interleaved throws", threw);
}

// interleaved + point forms agree with the batch form
{
  const { lon, lat } = makeData(257, 11);
  const t = ts.fromLonLat(lon, lat);
  const xy = new Float64Array(2 * lon.length);
  for (let i = 0; i < lon.length; i++) { xy[2 * i] = t.x[i]; xy[2 * i + 1] = t.y[i]; }
  const ri = w.toLonLatInterleaved(xy);
  const ti = ts.toLonLat(t.x, t.y);
  gate("inv interleaved", maxAbs(ri, (() => { const o = new Float64Array(xy.length); for (let i = 0; i < lon.length; i++) { o[2 * i] = ti.lon[i]; o[2 * i + 1] = ti.lat[i]; } return o; })()) <= 2e-13);

  const p = w.fromLonLatPoint(lon[0], lat[0]);
  gate("point fwd", Math.abs(p[0] - t.x[0]) <= 5e-9 && Math.abs(p[1] - t.y[0]) <= 5e-9);
  const q = w.toLonLatPoint(t.x[0], t.y[0]);
  gate("point inv", Math.abs(q[0] - ti.lon[0]) <= 1e-13 && Math.abs(q[1] - ti.lat[0]) <= 1e-13);
}

// south hemisphere + non-default ellipsoid go through the same paths
{
  const ws = await utmWasm({ zone: 31, south: true, ellipsoid: { a: 6378137, f: 1 / 298.257222101 } });
  const tss = tsUtm({ zone: 31, south: true, ellipsoid: { a: 6378137, f: 1 / 298.257222101 } });
  const { lon, lat } = makeData(100, 13);
  const t = tss.fromLonLat(lon, lat);
  const r = ws.fromLonLat(lon, lat);
  gate("south GRS80", maxAbs(r.x, t.x) <= 5e-9 && maxAbs(r.y, t.y) <= 5e-9);
}

if (failures === 0) console.log("WRAPPER_CHECKS_PASS");
else {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
