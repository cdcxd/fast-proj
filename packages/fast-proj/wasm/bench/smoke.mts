// Smoke benchmark: wasm scalar/simd vector math vs JS Math.*, call overhead,
// zero-copy buffers. Run: node bench/smoke.mts [--json]   /   bun bench/smoke.mts
import { readFileSync } from 'node:fs';

const json = process.argv.includes('--json');
const here = new URL('.', import.meta.url);

async function load(name) {
  const bytes = readFileSync(new URL(`../build/${name}.wasm`, here));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

function bench(fn, warmup, samples) {
  for (let i = 0; i < warmup; i++) fn();
  const ts = [];
  for (let i = 0; i < samples; i++) {
    const t = process.hrtime.bigint();
    fn();
    ts.push(Number(process.hrtime.bigint() - t));
  }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(ts.length / 2)];
}

const buf64 = new DataView(new ArrayBuffer(8));
function ulpDiff(a, b) {
  if (a === b) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  // distance in representation space (integer gap between adjacent doubles)
  buf64.setFloat64(0, a);
  const ia = BigInt(buf64.getBigUint64(0)) & 0x7fffffffffffffffn;
  buf64.setFloat64(0, b);
  const ib = BigInt(buf64.getBigUint64(0)) & 0x7fffffffffffffffn;
  const d = ia > ib ? ia - ib : ib - ia;
  return Number(d);
}

const scalar = await load('scalar');
const simd = await load('simd');

// ---- accuracy sweep --------------------------------------------------------
const N = 20000;
const rng = mulberry32(12345);
const mk = (lo, hi) => Float64Array.from({ length: N }, () => lo + (hi - lo) * rng());

function check(label, inputs, jsFn, wasm, outName) {
  const n = inputs.length;
  let maxUlp = 0;
  for (const mod of [scalar, simd]) {
    const inp = mod.alloc(n);
    const out = mod.alloc(n);
    const vi = new Float64Array(mod.memory.buffer, inp, n);
    const vo = new Float64Array(mod.memory.buffer, out, n);
    vi.set(inputs);
    if (label === 'sincos') {
      mod.sincos_batch(inp, out, out + n * 8, n);
      // check both sin (out) and cos (out+n)
      const out2 = out + n * 8;
      const vo2 = new Float64Array(mod.memory.buffer, out2, n);
      let mu1 = 0,
        mu2 = 0;
      for (let i = 0; i < n; i++) {
        mu1 = Math.max(mu1, ulpDiff(vo[i], Math.sin(inputs[i])));
        mu2 = Math.max(mu2, ulpDiff(vo2[i], Math.cos(inputs[i])));
      }
      maxUlp = Math.max(maxUlp, mu1, mu2);
    } else {
      mod[`${outName}_batch`](inp, out, n);
      for (let i = 0; i < n; i++) maxUlp = Math.max(maxUlp, ulpDiff(vo[i], jsFn(inputs[i])));
    }
  }
  return { label, maxUlp };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const checks = [
  check('sincos', mk(-Math.PI, Math.PI), null, null, null),
  check('atan', mk(-8, 8), Math.atan, null, 'atan'),
  check('exp', mk(-1.2, 1.2), Math.exp, null, 'exp'),
  check('log', mk(0.3, 2), Math.log, null, 'log'),
];

// ---- special values --------------------------------------------------------
const specials = [0, -0, 0.5, -0.5, 1, -1, Math.PI / 4, -Math.PI / 4, NaN, Infinity, -Infinity];
const sp = new Float64Array(specials);
function classify(mod) {
  const inp = mod.alloc(sp.length);
  const out = mod.alloc(sp.length);
  const vi = new Float64Array(mod.memory.buffer, inp, sp.length);
  vi.set(sp);
  const res = [];
  for (const [name, fn] of [
    ['atan', (i, o, n) => mod.atan_batch(i, o, n)],
    ['exp', (i, o, n) => mod.exp_batch(i, o, n)],
    ['log', (i, o, n) => mod.log_batch(i, o, n)],
  ]) {
    fn(inp, out, sp.length);
    const vo = new Float64Array(mod.memory.buffer, out, sp.length);
    for (let i = 0; i < sp.length; i++) res.push([name, specials[i], vo[i]]);
  }
  const si = mod.alloc(sp.length),
    so = mod.alloc(sp.length),
    co = mod.alloc(sp.length);
  new Float64Array(mod.memory.buffer, si, sp.length).set(sp);
  mod.sincos_batch(si, so, co, sp.length);
  const sv = new Float64Array(mod.memory.buffer, so, sp.length);
  const cv = new Float64Array(mod.memory.buffer, co, sp.length);
  for (let i = 0; i < sp.length; i++) {
    res.push(['sin', specials[i], sv[i]]);
    res.push(['cos', specials[i], cv[i]]);
  }
  return res;
}
const specialReport = { scalar: classify(scalar), simd: classify(simd) };

// ---- perf ------------------------------------------------------------------
const sizes = [1e4, 1e6];
const results = [];

for (const n of sizes) {
  const warmup = n === 1e4 ? 300 : 30;
  const samples = n === 1e4 ? 200 : 51;

  // noop call overhead
  results.push({
    n,
    op: 'noop',
    scalar: bench(() => scalar.noop(), warmup * 10, samples * 5),
    simd: bench(() => simd.noop(), warmup * 10, samples * 5),
  });

  // copy
  {
    const src = scalar.alloc(n);
    const dst = scalar.alloc(n);
    results.push({ n, op: 'copy', scalar: bench(() => scalar.copy_f64(dst, src, n), warmup, samples) });
  }

  const mkInputs = () => {
    const r = mulberry32(n);
    return Float64Array.from({ length: n }, () => r() * 2 - 1);
  };

  // sincos
  {
    const inputs = mkInputs();
    const scaled = inputs.map((v) => v * Math.PI);
    const jsS = new Float64Array(n),
      jsC = new Float64Array(n);
    const tjs = bench(
      () => {
        for (let i = 0; i < n; i++) {
          jsS[i] = Math.sin(scaled[i]);
          jsC[i] = Math.cos(scaled[i]);
        }
      },
      warmup,
      samples,
    );
    const row = { n, op: 'sincos', js: tjs };
    for (const [name, mod] of [
      ['scalar', scalar],
      ['simd', simd],
    ]) {
      const inp = mod.alloc(n);
      const so = mod.alloc(n);
      const co = mod.alloc(n);
      new Float64Array(mod.memory.buffer, inp, n).set(scaled);
      row[name] = bench(() => mod.sincos_batch(inp, so, co, n), warmup, samples);
    }
    results.push(row);
  }

  // atan / exp / log
  for (const [op, jsFn, scale] of [
    ['atan', Math.atan, 8],
    ['exp', Math.exp, 1.2],
    ['log', Math.log, 1.7],
  ]) {
    const inputs = mkInputs().map((v) => Math.abs(v * scale) + 0.05);
    const jsOut = new Float64Array(n);
    const tjs = bench(
      () => {
        for (let i = 0; i < n; i++) jsOut[i] = jsFn(inputs[i]);
      },
      warmup,
      samples,
    );
    const row = { n, op, js: tjs };
    for (const [name, mod] of [
      ['scalar', scalar],
      ['simd', simd],
    ]) {
      const inp = mod.alloc(n);
      const out = mod.alloc(n);
      new Float64Array(mod.memory.buffer, inp, n).set(inputs);
      row[name] = bench(() => mod[`${op}_batch`](inp, out, n), warmup, samples);
    }
    results.push(row);
  }
}

// ---- report ----------------------------------------------------------------
if (json) {
  console.log(
    JSON.stringify(
      {
        runtime: typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`,
        checks,
        results,
        specials: specialReport,
      },
      null,
      1,
    ),
  );
} else {
  const rt = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`== accuracy (max ulp vs Math.*) — scalar & simd ==`);
  for (const c of checks) console.log(`  ${c.label.padEnd(8)} ${c.maxUlp.toFixed(2)} ulp`);
  console.log(`\n== perf: ns/point (${rt}) ==`);
  console.log(
    `  ${'n'.padStart(7)} ${'op'.padEnd(7)} ${'js'.padStart(9)} ${'scalar'.padStart(9)} ${'simd'.padStart(9)}   simd/js`,
  );
  for (const r of results) {
    const f = (t) => ((t / r.n) * 1e6).toFixed(2);
    const ratio = r.js && r.simd ? (r.js / r.simd).toFixed(2) + 'x' : '';
    console.log(
      `  ${String(r.n).padStart(7)} ${r.op.padEnd(7)} ${(r.js ? f(r.js) : '').padStart(9)} ${f(r.scalar).padStart(9)} ${f(r.simd).padStart(9)}   ${ratio}`,
    );
  }
}
