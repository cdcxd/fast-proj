// Preliminary perf probe (single process, not the PR protocol): wasm kernel
// vs TypeScript kernel through the actual wrapper (chunked) and raw batch
// calls. Full alternating fresh-process protocol happens post-handoff.
// Run: node bench/perf-quick.mjs   /   bun bench/perf-quick.mjs
import { readFileSync } from 'node:fs';
import { utm as tsUtm } from '../../../packages/utm/dist/utm.js';

const here = new URL('.', import.meta.url);
const wasmBytes = readFileSync(new URL('../build/simd.wasm', here));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const e = instance.exports;

const A = 6378137,
  F = 1 / 298.257223563,
  ZONE = 33;
const ts = tsUtm({ zone: ZONE });

function median(arr) {
  arr.sort((a, b) => a - b);
  return arr[arr.length >> 1];
}

function bench(fn, warmup, samples) {
  for (let i = 0; i < warmup; i++) fn();
  const t = [];
  for (let i = 0; i < samples; i++) {
    const s = process.hrtime.bigint();
    fn();
    t.push(Number(process.hrtime.bigint() - s));
  }
  return median(t);
}

const rt = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`preliminary perf (${rt}), ms per batch, median:`);
console.log(
  `${'n'.padStart(8)} ${'dir'.padEnd(4)} ${'TS'.padStart(9)} ${'wasm-wrap'.padStart(9)} ${'wasm-raw'.padStart(9)}   wrap/TS  raw/TS`,
);

for (const n of [1e4, 1e6]) {
  const warmup = n === 1e4 ? 200 : 20;
  const samples = n === 1e4 ? 100 : 30;
  // data in wasm memory (shared by raw + wrapped-ish) and JS arrays for TS
  const lon = new Float64Array(n),
    lat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = 12 + (6 * ((i * 2654435761) % 1000)) / 1000;
    lat[i] = 45 + (18 * ((i * 40503) % 1000)) / 1000;
  }
  const x = new Float64Array(n),
    y = new Float64Array(n);
  ts.fromLonLat(lon, lat, x, y);

  // wasm scratch, inputs pre-staged (steady-state batch loop cost)
  const wLon = e.alloc(n),
    wLat = e.alloc(n),
    wX = e.alloc(n),
    wY = e.alloc(n);
  new Float64Array(e.memory.buffer, wLon, n).set(lon);
  new Float64Array(e.memory.buffer, wLat, n).set(lat);
  new Float64Array(e.memory.buffer, wX, n).set(x);
  new Float64Array(e.memory.buffer, wY, n).set(y);
  const lonOut = e.alloc(n),
    latOut = e.alloc(n);

  const tTsF = bench(() => ts.fromLonLat(lon, lat), warmup, samples);
  const tTsI = bench(() => ts.toLonLat(x, y), warmup, samples);
  const tWF = bench(() => e.forward_batch(wLon, wLat, wX, wY, n, ZONE, 0, A, F), warmup, samples);
  const tWI = bench(() => e.inverse_batch(wX, wY, lonOut, latOut, n, ZONE, 0, A, F), warmup, samples);

  // through the module wrapper (chunked copies, the realistic API shape)
  const { utmWasm } = await import('../wasm-utm.mjs');
  const w = await utmWasm({ zone: ZONE });
  const tWrapF = bench(() => w.fromLonLat(lon, lat), warmup, samples);
  const tWrapI = bench(() => w.toLonLat(x, y), warmup, samples);

  const ms = (ns) => (ns / 1e6).toFixed(3);
  console.log(
    `${String(n).padStart(8)} fwd  ${ms(tTsF).padStart(9)} ${ms(tWrapF).padStart(9)} ${ms(tWF).padStart(9)}   ${(tTsF / tWrapF).toFixed(2)}x    ${(tTsF / tWF).toFixed(2)}x`,
  );
  console.log(
    `${String(n).padStart(8)} inv  ${ms(tTsI).padStart(9)} ${ms(tWrapI).padStart(9)} ${ms(tWI).padStart(9)}   ${(tTsI / tWrapI).toFixed(2)}x    ${(tTsI / tWI).toFixed(2)}x`,
  );
}
