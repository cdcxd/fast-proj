// Wasm-artifact checks that cannot run as host cargo tests: simd seams,
// tails, NaN/Inf/±0 propagation, allocator contract, and kernel-level
// parity with the TypeScript kernel (guards, signed zeros).
// Run: node bench/checks.mts   /   bun bench/checks.mts
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const wasmBytes = readFileSync(new URL('../build/simd.wasm', here));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const e = instance.exports;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) {
    failures++;
    console.error(`XX ${name}${detail ? ': ' + detail : ''}`);
  }
}

const F64 = (ptr, n) => new Float64Array(e.memory.buffer, ptr, n);
function alloc(n) {
  return e.alloc(n);
}

// --- sincos quadrants (all 4, both signs) ----------------------------------
{
  const xs = [0, -0];
  for (const q of [
    0.1,
    Math.PI / 2 + 0.1,
    Math.PI + 0.1,
    (3 * Math.PI) / 2 + 0.1,
    -0.1,
    -Math.PI / 2 - 0.1,
    -Math.PI - 0.1,
    (-3 * Math.PI) / 2 - 0.1,
    6.5,
    -6.5,
  ])
    xs.push(q);
  const n = xs.length;
  const inp = alloc(n),
    so = alloc(n),
    co = alloc(n);
  F64(inp, n).set(xs);
  e.sincos_batch(inp, so, co, n);
  const sv = F64(so, n),
    cv = F64(co, n);
  for (let i = 0; i < n; i++) {
    check(`sincos ${xs[i]}`, Math.abs(sv[i] - Math.sin(xs[i])) <= 2e-16, `sin ${sv[i]} vs ${Math.sin(xs[i])}`);
    check(`sincos ${xs[i]} cos`, Math.abs(cv[i] - Math.cos(xs[i])) <= 2e-16, `cos ${cv[i]}`);
  }
  // sin(±0) = ±0: the tolerance above cannot see a lost sign
  check('sincos(+0) sin is +0', Object.is(sv[0], 0), `sin ${sv[0]}`);
  check('sincos(-0) sin is -0', Object.is(sv[1], -0), `sin ${sv[1]}`);
}

// --- atan seams --------------------------------------------------------------
{
  const TP8 = Math.tan(Math.PI / 8);
  const xs = [
    0,
    -0,
    1e-300,
    -1e-300,
    1,
    -1,
    1 + 1e-12,
    1 - 1e-12,
    TP8,
    -TP8,
    TP8 + 1e-12,
    TP8 - 1e-12,
    1e12,
    -1e12,
    Infinity,
    -Infinity,
    NaN,
  ];
  const n = xs.length;
  const inp = alloc(n),
    out = alloc(n);
  F64(inp, n).set(xs);
  e.atan_batch(inp, out, n);
  const got = F64(out, n);
  for (let i = 0; i < n; i++) {
    const want = Math.atan(xs[i]);
    const ok = Number.isNaN(want)
      ? Number.isNaN(got[i])
      : got[i] === want || Math.abs(got[i] - want) <= 2e-16 * Math.max(1, Math.abs(want));
    check(`atan(${xs[i]})`, ok, `got ${got[i]} want ${want}`);
  }
  check('atan(-0) is -0', Object.is(got[1], -0), String(got[1]));
}

// --- atan2 seams: full IEEE quadrant table incl. ±0 and NaN -------------------
{
  const pairs = [];
  for (const y of [0, -0, 1, -1, 1e-300, Infinity, -Infinity, NaN]) {
    for (const x of [0, -0, 1, -1, 1e-300, -1e-300, Infinity, -Infinity, NaN]) {
      pairs.push([y, x]);
    }
  }
  const n = pairs.length;
  const yp = alloc(n),
    xp = alloc(n),
    out = alloc(n);
  const yv = F64(yp, n),
    xv = F64(xp, n);
  for (let i = 0; i < n; i++) {
    yv[i] = pairs[i][0];
    xv[i] = pairs[i][1];
  }
  e.atan2_batch(yp, xp, out, n);
  const got = F64(out, n);
  for (let i = 0; i < n; i++) {
    const [y, x] = pairs[i];
    const want = Math.atan2(y, x);
    const ok = Number.isNaN(want)
      ? Number.isNaN(got[i])
      : // zero results must match in sign too (+0 vs -0)
        want === 0
        ? Object.is(got[i], want)
        : Object.is(got[i], want) || Math.abs(got[i] - want) <= 2e-16 * Math.PI;
    check(`atan2(${y}, ${x})`, ok, `got ${got[i]} want ${want}`);
  }
}

// --- log seams at powers of two ----------------------------------------------
{
  const xs = [1, 2, 4, 0.5, 0.25, 1024, 2 ** -20, 2 ** 20, 1 + 1e-18, 1 - 1e-18, Infinity, NaN, 0];
  const n = xs.length;
  const inp = alloc(n),
    out = alloc(n);
  F64(inp, n).set(xs);
  e.log_batch(inp, out, n);
  const got = F64(out, n);
  for (let i = 0; i < n; i++) {
    const want = Math.log(xs[i]);
    const ok = Number.isNaN(want)
      ? Number.isNaN(got[i])
      : got[i] === want || Math.abs(got[i] - want) <= 2e-16 * Math.max(1, Math.abs(want));
    check(`log(${xs[i]})`, ok, `got ${got[i]} want ${want}`);
  }
  check('log(1) is +0', Object.is(got[0], 0));
}

// --- log1p pair guards: both paths, mixed lanes, seams and odd tails --------
{
  const values = [
    0,
    -0,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    2 ** -53,
    -(2 ** -53),
    2 ** -53 + 2 ** -105,
    -0.25,
    -0.25 - Number.EPSILON / 4,
    -0.25 + Number.EPSILON / 8,
    0.25,
    0.25 - Number.EPSILON / 8,
    0.25 + Number.EPSILON / 4,
    -0.75,
    -1,
    -1.5,
    0.5,
    1,
    2048,
    Infinity,
    -Infinity,
    NaN,
  ];
  // Every ordered pair exercises same-path and mixed-path SIMD masks,
  // including NaN in either lane. The last -0 is an odd tail.
  const xs = values.flatMap((a) => values.flatMap((b) => [a, b]));
  xs.push(-0);
  const n = xs.length;
  const inp = alloc(n),
    out = alloc(n + 1);
  F64(inp, n).set(xs);
  F64(out, n + 1).fill(123);
  e.log1p_batch(inp, out, n);
  const got = F64(out, n + 1);
  for (let i = 0; i < n; i++) {
    const want = Math.log1p(xs[i]);
    const ok = Number.isNaN(want)
      ? Number.isNaN(got[i])
      : want === 0 || !Number.isFinite(want)
        ? Object.is(got[i], want)
        : Number.isFinite(got[i]) && Math.abs(got[i] - want) <= 4 * Number.EPSILON * Math.abs(want);
    check(`log1p pair lane ${i}`, ok, `input ${xs[i]} got ${got[i]} want ${want}`);
  }
  check('log1p odd tail leaves next output untouched', got[n] === 123);
  e.log1p_batch(inp, out, 0);
  check('log1p empty batch leaves output untouched', Object.is(got[n - 1], -0));
}

// --- exp: negative k and clamp scope (|x| <= 693 exact vs Math.exp) ----------
{
  const xs = [-1, -20, -200, -0.5, 0.5, 1, 20, 200, 693, -693];
  const n = xs.length;
  const inp = alloc(n),
    out = alloc(n);
  F64(inp, n).set(xs);
  e.exp_batch(inp, out, n);
  const got = F64(out, n);
  for (let i = 0; i < n; i++) {
    const rel = Math.abs((got[i] - Math.exp(xs[i])) / Math.exp(xs[i]));
    check(`exp(${xs[i]})`, rel < 1e-14, `rel ${rel.toExponential(2)}`);
  }
}

// --- odd-n tails do not write past n -----------------------------------------
{
  for (const n of [1, 3, 7, 101]) {
    const guard = 0xfeedface;
    const inp = alloc(n),
      out = alloc(n + 1);
    F64(inp, n).fill(0.5);
    F64(out, n + 1).fill(0, 0);
    new Float64Array(e.memory.buffer, out, n + 1)[n] = guard;
    e.atan_batch(inp, out, n);
    check(`tail n=${n} guard intact`, new Float64Array(e.memory.buffer, out, n + 1)[n] === guard);
  }
}

// --- allocator contract ------------------------------------------------------
{
  const used0 = e.heap_used();
  e.alloc(10);
  check('alloc advances', e.heap_used() === used0 + 80);
  e.heap_reset();
  check('heap_reset', e.heap_used() === 0);
  const r1 = e.alloc(1);
  e.heap_reset();
  const r2 = e.alloc(1);
  check('alloc after reset', r1 === r2);
  e.heap_reset();
  // exhaustion must trap (catchable RuntimeError) in BOTH variants — the
  // scalar build's panic handler used to spin forever instead
  const variants = [['simd', e]];
  try {
    const scalar = await WebAssembly.instantiate(readFileSync(new URL('../build/scalar.wasm', here)), {});
    variants.push(['scalar', scalar.instance.exports]);
  } catch (err) {
    check('scalar.wasm instantiable', false, String(err));
  }
  for (const [name, exp] of variants) {
    let trapped = false;
    try {
      exp.alloc(33_554_433); // 268,435,464 B > the 256 MiB arena
    } catch {
      trapped = true;
    }
    check(`alloc exhaustion traps (${name})`, trapped);
  }
}

// --- kernel parity with the TypeScript kernel --------------------------------
const { utm: tsUtm } = await import('../../dist/utm.js');
const A = 6378137,
  F = 1 / 298.257223563;

function wasmForward(pts, zone, south, a = A, f = F) {
  const n = pts.length;
  const lp = alloc(n),
    tp = alloc(n),
    xp = alloc(n),
    yp = alloc(n);
  const lon = F64(lp, n),
    lat = F64(tp, n);
  for (let i = 0; i < n; i++) {
    lon[i] = pts[i][0];
    lat[i] = pts[i][1];
  }
  e.tm_forward_batch(lp, tp, xp, yp, n, zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0, a, f);
  return { x: Array.from(F64(xp, n)), y: Array.from(F64(yp, n)) };
}

function wasmInverse(pts, zone, south, a = A, f = F) {
  const n = pts.length;
  const xp = alloc(n),
    yp = alloc(n),
    lp = alloc(n),
    tp = alloc(n);
  const x = F64(xp, n),
    y = F64(yp, n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0];
    y[i] = pts[i][1];
  }
  e.tm_inverse_batch(xp, yp, lp, tp, n, zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0, a, f);
  return { lon: Array.from(F64(lp, n)), lat: Array.from(F64(tp, n)) };
}

// equator signed zeros (north and south, east and west of the meridian)
{
  const cases = [
    {
      zone: 31,
      south: false,
      pts: [
        [500000, 0],
        [499999.999, 0],
        [500000.001, 0],
        [166000, 0],
        [834000, 0],
      ],
    },
    {
      zone: 31,
      south: true,
      pts: [
        [500000, 10000000],
        [499999.999, 10000000],
        [500000.001, 10000000],
      ],
    },
  ];
  for (const { zone, south, pts } of cases) {
    const c = tsUtm({ zone, south });
    const got = wasmInverse(pts, zone, south);
    for (let i = 0; i < pts.length; i++) {
      const [tl, tt] = c.toLonLatPoint(pts[i][0], pts[i][1]);
      check(`equator lon sign ${pts[i][0]} south=${south}`, Object.is(got.lon[i], tl), `${got.lon[i]} vs ${tl}`);
      check(`equator lat value ${pts[i][0]} south=${south}`, got.lat[i] === tt, `${got.lat[i]} vs ${tt}`);
    }
  }
}

// forward equator signed-zero latitude input
{
  const c = tsUtm({ zone: 31 });
  const pts = [
    [3, 0],
    [3, -0],
    [2.999999999, 0],
    [3.000000001, -0],
  ];
  const got = wasmForward(pts, 31, false);
  for (let i = 0; i < pts.length; i++) {
    const [tx, ty] = c.fromLonLatPoint(pts[i][0], pts[i][1]);
    check(`fwd equator ${pts[i]}`, got.x[i] === tx && got.y[i] === ty, `${got.x[i]},${got.y[i]} vs ${tx},${ty}`);
  }
}

// guard classification parity: |dlon| >= 90 NaN, near-boundary finite
{
  const c = tsUtm({ zone: 31 });
  const pts = [
    [-87.000001, 0],
    [93.000001, 45],
    [3 - 90, 10],
    [3 + 90, 10],
    [3 - 89.99999999, 10],
    [3 + 89.99999999, 10],
  ];
  const got = wasmForward(pts, 31, false);
  for (let i = 0; i < pts.length; i++) {
    const [tx] = c.fromLonLatPoint(pts[i][0], pts[i][1]);
    const clsOk = (Number.isNaN(tx) && Number.isNaN(got.x[i])) || tx === got.x[i];
    check(`fwd guard cls ${pts[i]}`, clsOk, `got ${got.x[i]} vs ${tx}`);
  }
}
// out-of-domain diagnostics parity (the PR suite): sphere and f=0.0099999
{
  const cases = [
    {
      f: F,
      label: 'WGS84',
      pts: [
        [100000000, 0],
        [100000000, 1000000],
        [1200000000, 0],
        [-1200000000, 0],
      ],
    },
    {
      f: 0.0099999,
      label: 'f=0.0099999',
      pts: [
        [100000000, 0],
        [100000000, 1000000],
      ],
    },
    {
      f: 0,
      label: 'sphere',
      pts: [
        [1200000000, 0],
        [-1200000000, 0],
      ],
    },
  ];
  for (const { f: ff, label, pts } of cases) {
    const c = tsUtm({ zone: 33, ellipsoid: { a: A, f: ff } });
    const got = wasmInverse(pts, 33, false, A, ff);
    for (let i = 0; i < pts.length; i++) {
      const [tl, tt] = c.toLonLatPoint(pts[i][0], pts[i][1]);
      const lc = Number.isNaN(tl) ? Number.isNaN(got.lon[i]) : tl === got.lon[i] || Math.abs(tl - got.lon[i]) < 1e-9;
      const tc = Number.isNaN(tt) ? Number.isNaN(got.lat[i]) : tt === got.lat[i] || Math.abs(tt - got.lat[i]) < 1e-9;
      check(`diag ${label} ${pts[i]}`, lc && tc, `lon ${got.lon[i]} vs ${tl}; lat ${got.lat[i]} vs ${tt}`);
    }
  }
}

// grid sweep: simd kernel vs TS kernel on the PR ±30° WGS84 grid
{
  const zone = 33,
    c = tsUtm({ zone });
  const pts = [];
  for (let lat = -80; lat <= 84; lat++) for (const dl of [-30, -15, 0, 15, 29.9]) pts.push([15 + dl, lat]);
  const gf = wasmForward(pts, zone, false);
  let maxdx = 0,
    maxdy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [tx, ty] = c.fromLonLatPoint(pts[i][0], pts[i][1]);
    maxdx = Math.max(maxdx, Math.abs(gf.x[i] - tx));
    maxdy = Math.max(maxdy, Math.abs(gf.y[i] - ty));
  }
  check('grid fwd max dx < 5e-9', maxdx < 5e-9, String(maxdx.toExponential(3)));
  check('grid fwd max dy < 5e-9', maxdy < 5e-9, String(maxdy.toExponential(3)));

  const xs = pts.map((p) => c.fromLonLatPoint(p[0], p[1]));
  const invPts = xs.map(([x, y]) => [x, y]);
  const gi = wasmInverse(invPts, zone, false);
  let maxdl = 0,
    maxdt = 0;
  for (let i = 0; i < pts.length; i++) {
    const [tl, tt] = c.toLonLatPoint(invPts[i][0], invPts[i][1]);
    maxdl = Math.max(maxdl, Math.abs(gi.lon[i] - tl) * Math.cos((pts[i][1] * Math.PI) / 180));
    maxdt = Math.max(maxdt, Math.abs(gi.lat[i] - tt));
  }
  check('grid inv max dlon*cos < 1e-13', maxdl < 1e-13, String(maxdl.toExponential(3)));
  check('grid inv max dlat < 1e-13', maxdt < 1e-13, String(maxdt.toExponential(3)));
}

console.log(failures === 0 ? 'ALL_CHECKS_PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
