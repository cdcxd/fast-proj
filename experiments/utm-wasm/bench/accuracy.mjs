// 3-way accuracy gate: wasm simd kernel vs TypeScript kernel vs proj4
// (independent reference). If our implementation is wrong on either side and
// proj4 is right, the per-side proj4 deltas expose it — a pure wasm-vs-TS
// comparison would cancel shared errors.
// Run: node bench/accuracy.mjs   (also works under bun)
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { utm as tsUtm } from '../../../packages/utm/dist/utm.js';

const here = new URL('.', import.meta.url);
const wasmBytes = readFileSync(new URL('../build/simd.wasm', here));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const e = instance.exports;

const A = 6378137;
const ELLIPSOIDS = [
  ['sphere', 0],
  ['WGS84', 1 / 298.257223563],
  ['GRS80', 1 / 298.257222101],
  ['f=0.005', 0.005],
  ['f=0.0099999', 0.0099999],
];
const LATITUDES = [
  ...Array.from({ length: 181 }, (_, i) => i - 90),
  -89.99999999999999,
  -89.999999999,
  -89.99999,
  -0,
  89.99999,
  89.999999999,
  89.99999999999999,
];
const DLONS_30 = Array.from({ length: 25 }, (_, i) => -30 + i * 2.5);
const DLONS_45 = Array.from({ length: 31 }, (_, i) => -45 + i * 3);

// wasm scratch (allocate once)
const CAP = 1 << 16;
const bLon = e.alloc(CAP),
  bLat = e.alloc(CAP),
  bX = e.alloc(CAP),
  bY = e.alloc(CAP);
const view = (p, n) => new Float64Array(e.memory.buffer, p, n);

function wasmForwardBatch(lon, lat, zone, south, a, f) {
  const n = lon.length;
  const wLon = view(bLon, n),
    wLat = view(bLat, n);
  wLon.set(lon.subarray ? lon.subarray(0, n) : lon);
  wLat.set(lat);
  e.forward_batch(bLon, bLat, bX, bY, n, zone, south ? 1 : 0, a, f);
  return { x: Array.from(view(bX, n)), y: Array.from(view(bY, n)) };
}

function wasmInverseBatch(x, y, zone, south, a, f) {
  const n = x.length;
  const wX = view(bX, n),
    wY = view(bY, n);
  wX.set(x);
  wY.set(y);
  e.inverse_batch(bX, bY, bLon, bLat, n, zone, south ? 1 : 0, a, f);
  return { lon: Array.from(view(bLon, n)), lat: Array.from(view(bLat, n)) };
}

const classify = (n) =>
  Number.isFinite(n) ? 'finite' : Number.isNaN(n) ? 'NaN' : n > 0 ? '+Inf' : n < 0 ? '-Inf' : 'non-number';

function wrapDelta(a, b) {
  let d = a - b;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return Math.abs(d);
}

let failures = 0;
function gate(name, ok, detail) {
  if (!ok) {
    failures++;
    console.error(`XX ${name}: ${detail}`);
  }
}

const rows = [];
for (const halfWidth of [30, 45]) {
  const dlons = halfWidth === 30 ? DLONS_30 : DLONS_45;
  for (const [name, f] of ELLIPSOIDS) {
    const rf = f > 0 ? String(1 / f) : null;
    for (const zone of [1, 31, 33, 60]) {
      for (const south of [false, true]) {
        const ts = tsUtm({ zone, south, ellipsoid: { a: A, f } });
        const lon0 = zone * 6 - 183;
        const lons = dlons.map((d) => lon0 + d);
        // forward over the full latitude grid, chunked through scratch
        const pts = [];
        for (const lat of LATITUDES) for (const lon of lons) pts.push([lon, lat]);
        const lonArr = new Float64Array(pts.length),
          latArr = new Float64Array(pts.length);
        for (let i = 0; i < pts.length; i++) {
          lonArr[i] = pts[i][0];
          latArr[i] = pts[i][1];
        }
        let wX = [],
          wY = [],
          tX = [],
          tY = [];
        const p4 = rf
          ? proj4(
              `+proj=longlat +a=${A} +rf=${rf} +no_defs`,
              `+proj=utm +zone=${zone}${south ? ' +south' : ''} +a=${A} +rf=${rf} +units=m +no_defs`,
            )
          : null;
        const CH = 4096;
        for (let i0 = 0; i0 < pts.length; i0 += CH) {
          const n = Math.min(CH, pts.length - i0);
          const g = wasmForwardBatch(lonArr.subarray(i0, i0 + n), latArr.subarray(i0, i0 + n), zone, south, A, f);
          wX.push(...g.x);
          wY.push(...g.y);
          const t = ts.fromLonLat(lonArr.subarray(i0, i0 + n), latArr.subarray(i0, i0 + n));
          tX.push(...t.x);
          tY.push(...t.y);
        }
        // metrics: wasm-vs-TS, wasm-vs-proj4, TS-vs-proj4
        const m = {
          pairs: pts.length,
          wvts: { x: 0, y: 0, cls: 0, sz: 0, ident: 0 },
          wvp4: { x: 0, y: 0, n: 0 },
          tvp4: { x: 0, y: 0, n: 0 },
        };
        for (let i = 0; i < pts.length; i++) {
          const [wx, ty2, tx] = [wX[i], wY[i], tX[i]];
          const wy = tY[i];
          if (classify(wx) !== classify(tx) || classify(ty2) !== classify(wy)) m.wvts.cls++;
          if (Object.is(wx, tx) && Object.is(ty2, wy)) m.wvts.ident++;
          else if (wx === 0 && tx === 0 && !Object.is(wx, tx)) m.wvts.sz++;
          if (Number.isFinite(wx) && Number.isFinite(tx)) m.wvts.x = Math.max(m.wvts.x, Math.abs(wx - tx));
          if (Number.isFinite(ty2) && Number.isFinite(wy)) m.wvts.y = Math.max(m.wvts.y, Math.abs(ty2 - wy));
          if (p4) {
            const [px, py] = p4.forward([pts[i][0], pts[i][1]]);
            if (Number.isFinite(px)) {
              m.wvp4.n++;
              if (Number.isFinite(wx)) m.wvp4.x = Math.max(m.wvp4.x, Math.abs(wx - px));
              if (Number.isFinite(tx)) m.tvp4.x = Math.max(m.tvp4.x, Math.abs(tx - px));
            }
            if (Number.isFinite(py)) {
              if (Number.isFinite(ty2)) m.wvp4.y = Math.max(m.wvp4.y, Math.abs(ty2 - py));
              if (Number.isFinite(wy)) m.tvp4.y = Math.max(m.tvp4.y, Math.abs(wy - py));
            }
          }
        }
        // inverse: reuse TS forward outputs as inputs
        let ivLon = 0,
          ivLat = 0,
          ivCls = 0,
          ivSz = 0;
        for (let i0 = 0; i0 < pts.length; i0 += CH) {
          const n = Math.min(CH, pts.length - i0);
          const xs = new Float64Array(n),
            ys = new Float64Array(n);
          for (let j = 0; j < n; j++) {
            xs[j] = tX[i0 + j];
            ys[j] = tY[i0 + j];
          }
          const gi = wasmInverseBatch(xs, ys, zone, south, A, f);
          const ti = ts.toLonLat(xs, ys);
          for (let j = 0; j < n; j++) {
            const wl = gi.lon[j],
              tl = ti.lon[j];
            if (classify(wl) !== classify(tl)) ivCls++;
            else if (wl === 0 && tl === 0 && !Object.is(wl, tl)) ivSz++;
            if (Number.isFinite(wl) && Number.isFinite(tl)) {
              ivLon = Math.max(
                ivLon,
                wrapDelta(wl, tl) * Math.abs(Math.cos((LATITUDES[Math.floor((i0 + j) / lons.length)] * Math.PI) / 180)),
              );
              ivLat = Math.max(ivLat, Math.abs(gi.lat[j] - ti.lat[j]));
            }
          }
        }
        m.iv = { lon: ivLon, lat: ivLat, cls: ivCls, sz: ivSz };
        rows.push({ halfWidth, name, zone, south, ...m });
      }
    }
  }
}

// gates per the proposal acceptance
for (const r of rows) {
  const tag = `±${r.halfWidth} ${r.name} z${r.zone}${r.south ? 'S' : 'N'}`;
  gate(`${tag} fwd dx`, r.wvts.x < 5e-9, `${r.wvts.x.toExponential(3)}`);
  gate(`${tag} fwd dy`, r.wvts.y < 5e-9, `${r.wvts.y.toExponential(3)}`);
  gate(`${tag} inv dlon*cos`, r.iv.lon < 1e-13, `${r.iv.lon.toExponential(3)}`);
  gate(`${tag} inv dlat`, r.iv.lat < 1e-13, `${r.iv.lat.toExponential(3)}`);
  gate(`${tag} classification`, r.wvts.cls === 0 && r.iv.cls === 0, `fwd ${r.wvts.cls} inv ${r.iv.cls}`);
  gate(`${tag} signed zeros`, r.wvts.sz === 0 && r.iv.sz === 0, `fwd ${r.wvts.sz} inv ${r.iv.sz}`);
  if (r.wvp4.n > 0) {
    gate(`${tag} wasm-vs-proj4 dx`, r.wvp4.x < 1e-8, `${r.wvp4.x.toExponential(3)}`);
    gate(`${tag} wasm-vs-proj4 dy`, r.wvp4.y < 1e-8, `${r.wvp4.y.toExponential(3)}`);
    gate(`${tag} ts-vs-proj4 dx`, r.tvp4.x < 1e-8, `${r.tvp4.x.toExponential(3)}`);
    gate(`${tag} ts-vs-proj4 dy`, r.tvp4.y < 1e-8, `${r.tvp4.y.toExponential(3)}`);
  }
}

// worst-case summary
const worst = (key, dir) => rows.reduce((a, r) => (r[dir][key] > a.v ? { v: r[dir][key], r } : a), { v: 0, r: null });
console.log('== worst cases ==');
for (const [label, w] of [
  ['wasm-vs-TS fwd dx', worst('x', 'wvts')],
  ['wasm-vs-TS fwd dy', worst('y', 'wvts')],
  ['wasm-vs-TS inv dlon*cos', worst('lon', 'iv')],
  ['wasm-vs-TS inv dlat', worst('lat', 'iv')],
  ['wasm-vs-proj4 fwd dx', worst('x', 'wvp4')],
  ['wasm-vs-proj4 fwd dy', worst('y', 'wvp4')],
  ['TS-vs-proj4 fwd dx', worst('x', 'tvp4')],
  ['TS-vs-proj4 fwd dy', worst('y', 'tvp4')],
]) {
  const r = w.r;
  console.log(
    `${label.padEnd(26)} ${w.v.toExponential(3)}   (±${r?.halfWidth} ${r?.name} z${r?.zone}${r?.south ? 'S' : 'N'})`,
  );
}
const identTotal = rows.reduce((a, r) => a + r.wvts.ident, 0);
const pairsTotal = rows.reduce((a, r) => a + r.pairs, 0);
console.log(`forward identical pairs: ${identTotal}/${pairsTotal} (${((100 * identTotal) / pairsTotal).toFixed(2)}%)`);

// fixture: wasm + TS against the independent decimal-string reference
const reference = JSON.parse(readFileSync(new URL('../../../packages/utm/test/fixtures/reference.json', here), 'utf8'));
{
  const n = reference.points.length;
  const lon = new Float64Array(n),
    lat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = 3 + reference.points[i].dlon;
    lat[i] = reference.points[i].lat;
  }
  const g = wasmForwardBatch(lon, lat, 31, false, A, 1 / 298.257223563);
  let fdx = 0,
    fdy = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(g.x[i])) continue;
    fdx = Math.max(fdx, Math.abs(g.x[i] - parseFloat(reference.points[i].x)));
    fdy = Math.max(fdy, Math.abs(g.y[i] - parseFloat(reference.points[i].y)));
  }
  gate('fixture fwd dx < 5e-9', fdx < 5e-9, fdx.toExponential(3));
  gate('fixture fwd dy < 5e-9', fdy < 5e-9, fdy.toExponential(3));
  const xs = new Float64Array(n),
    ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = parseFloat(reference.points[i].x);
    ys[i] = parseFloat(reference.points[i].y);
  }
  const gi = wasmInverseBatch(xs, ys, 31, false, A, 1 / 298.257223563);
  let idl = 0,
    idt = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(gi.lon[i])) continue;
    idl = Math.max(
      idl,
      wrapDelta(gi.lon[i], 3 + reference.points[i].dlon) * Math.cos((reference.points[i].lat * Math.PI) / 180),
    );
    idt = Math.max(idt, Math.abs(gi.lat[i] - reference.points[i].lat));
  }
  gate('fixture inv dlon*cos < 1e-13', idl < 1e-13, idl.toExponential(3));
  gate('fixture inv dlat < 1e-13', idt < 1e-13, idt.toExponential(3));
  console.log(
    `fixture: dx ${fdx.toExponential(3)} dy ${fdy.toExponential(3)} dlon ${idl.toExponential(3)} dlat ${idt.toExponential(3)}`,
  );
}

console.log(failures === 0 ? 'ACCURACY_3WAY_PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
