// Extended accuracy sweeps over the kernel's actual argument ranges.
// Run: node bench/sweeps.mjs   /   bun bench/sweeps.mjs
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
async function load(name) {
  const bytes = readFileSync(new URL(`../build/${name}.wasm`, here));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
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

const buf = new DataView(new ArrayBuffer(8));
function ulpDist(a, b) {
  if (a === b) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  buf.setFloat64(0, a);
  const ia = BigInt(buf.getBigUint64(0)) & 0x7fffffffffffffffn;
  buf.setFloat64(0, b);
  const ib = BigInt(buf.getBigUint64(0)) & 0x7fffffffffffffffn;
  return Number(ia > ib ? ia - ib : ib - ia);
}

const N = 50000;
function run(mod, name, inputs, ref) {
  const inp = mod.alloc(N);
  const out = mod.alloc(N);
  const vi = new Float64Array(mod.memory.buffer, inp, N);
  const vo = new Float64Array(mod.memory.buffer, out, N);
  vi.set(inputs.subarray(0, N));
  mod[`${name}_batch`](inp, out, N);
  let max = 0,
    arg = 0;
  for (let i = 0; i < N; i++) {
    const d = ulpDist(vo[i], ref[i]);
    if (d > max) {
      max = d;
      arg = vi[i];
    }
  }
  return { max, arg };
}

const simd = await load('simd');
const scalar = await load('scalar');
const r = mulberry32(777);

// log: mantissa-dense across many binades [2^-20, 2^20]
const logInputs = new Float64Array(N);
const logRef = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const e = Math.floor(r() * 41) - 20; // -20..20
  const m = 0.5 + r();
  logInputs[i] = m * 2 ** e;
  logRef[i] = Math.log(logInputs[i]);
}

// exp: uniform-dense over [-200, 200] plus dense near 0
const expInputs = new Float64Array(N);
const expRef = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const v = i % 4 === 3 ? (r() * 2 - 1) * 1e-8 : (r() * 2 - 1) * 200;
  expInputs[i] = v;
  expRef[i] = Math.exp(v);
}

// atan: full range +-1e12, dense at the seams |x|=1 and tan(pi/8)
const TP8 = Math.tan(Math.PI / 8);
const atanInputs = new Float64Array(N);
const atanRef = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const mode = i % 5;
  let v;
  if (mode === 0) v = (r() * 2 - 1) * 1e12;
  else if (mode === 1) v = 1 + (r() * 2 - 1) * 1e-12; // |x|=1 seam
  else if (mode === 2) v = TP8 + (r() * 2 - 1) * 1e-12; // tan(pi/8) seam
  else if (mode === 3) v = (r() * 2 - 1) * 2;
  else v = (r() * 2 - 1) * 1e-300;
  atanInputs[i] = v;
  atanRef[i] = Math.atan(v);
}

// sincos: full kernel range +-pi/2 domain edges plus poles
const scInputs = new Float64Array(N);
const scSin = new Float64Array(N);
const scCos = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const v = ((r() * 2 - 1) * Math.PI) / 2;
  scInputs[i] = v;
  scSin[i] = Math.sin(v);
  scCos[i] = Math.cos(v);
}

const report = [];
for (const [mname, mod] of [
  ['scalar', scalar],
  ['simd', simd],
]) {
  const rl = run(mod, 'log', logInputs, logRef);
  const re = run(mod, 'exp', expInputs, expRef);
  const ra = run(mod, 'atan', atanInputs, atanRef);
  // sincos: write sin to out, cos to out+N
  const inp = mod.alloc(N),
    out = mod.alloc(N),
    out2 = mod.alloc(N);
  new Float64Array(mod.memory.buffer, inp, N).set(scInputs);
  mod.sincos_batch(inp, out, out2, N);
  const sv = new Float64Array(mod.memory.buffer, out, N);
  const cv = new Float64Array(mod.memory.buffer, out2, N);
  let ms = 0,
    mc = 0;
  for (let i = 0; i < N; i++) {
    ms = Math.max(ms, ulpDist(sv[i], scSin[i]));
    mc = Math.max(mc, ulpDist(cv[i], scCos[i]));
  }
  report.push({ build: mname, log: rl, exp: re, atan: ra, sincos: { sin: ms, cos: mc } });
}

console.log(
  JSON.stringify(report, (k, v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toPrecision(4)) : v), 1),
);
