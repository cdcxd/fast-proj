// Fresh-process perf protocol at n=1e6, mirroring packages/utm/bench/
// compare-performance.mjs (which hardcodes n=10000): each revision runs in its
// own worker process, order alternates per round, medians over samples.
// Run: node bench/perf-1e6.mjs            (node workers)
//      node bench/perf-1e6.mjs --runtime=bun
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const here = new URL('.', import.meta.url).pathname;
const base = resolve(here, '../../../packages/utm/dist/utm.js');
const candidate = resolve(here, '../utm.js');
const n = 1e6;
const config = { n, runs: 15, warmups: 5 };

if (args.includes('--worker')) {
  const { utm } = await import(option('revision'));
  const converter = utm({ zone: 33 });
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const first = new Float64Array(n);
  const second = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = 12 + (6 * ((i * 7919) % n)) / n;
    lat[i] = 45 + (18 * ((i * 104729) % n)) / n;
  }
  converter.fromLonLat(lon, lat, x, y);
  const rows = {};
  for (const [direction, call] of [
    ['forward', () => converter.fromLonLat(lon, lat, first, second)],
    ['inverse', () => converter.toLonLat(x, y, first, second)],
  ]) {
    for (let i = 0; i < config.warmups; i++) call();
    const samples = [];
    for (let i = 0; i < config.runs; i++) {
      const start = performance.now();
      call();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    rows[direction] = { medianMs: samples[Math.floor(config.runs / 2)], checksum: first[20] + second[n - 1] };
  }
  console.log(JSON.stringify(rows));
} else {
  const runtime = option('runtime', 'node');
  const exe = runtime === 'bun' ? 'bun' : process.execPath;
  const rounds = Number(option('repeats', 3));
  const acc = { base: { forward: [], inverse: [] }, candidate: { forward: [], inverse: [] } };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? ['candidate', 'base'] : ['base', 'candidate'];
    for (const revision of order) {
      const path = revision === 'base' ? base : candidate;
      const rows = JSON.parse(
        execFileSync(exe, [import.meta.filename, '--worker', `--revision=${path}`], { encoding: 'utf8' }),
      );
      for (const dir of ['forward', 'inverse']) {
        acc[revision][dir].push(rows[dir].medianMs);
        const prev = acc[revision][dir].checksum ?? rows[dir].checksum;
        if (prev !== rows[dir].checksum) throw new Error(`checksum drift in ${revision} ${dir}`);
        acc[revision][dir].checksum = rows[dir].checksum;
      }
    }
  }
  // the two kernels agree to <= 3.7e-9 m, so checksums must be close but are
  // not bit-identical; fail only on gross divergence (NaN/garbage candidates)
  for (const dir of ['forward', 'inverse']) {
    const b = acc.base[dir].checksum;
    const c = acc.candidate[dir].checksum;
    if (!Number.isFinite(b) || !Number.isFinite(c) || Math.abs(b - c) > 1e-3 * Math.max(1, Math.abs(b))) {
      throw new Error(`checksum mismatch for ${dir}: base ${b} vs candidate ${c}`);
    }
  }
  const med = (v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const label = runtime === 'bun' ? 'Bun (worker)' : `Node ${process.version}`;
  console.log(`${label.trim()} n=1e6, fresh processes, ${rounds} alternating rounds:`);
  for (const dir of ['forward', 'inverse']) {
    const b = med(acc.base[dir]);
    const c = med(acc.candidate[dir]);
    console.log(`${dir.padEnd(7)} ${b.toFixed(2)} ms -> ${c.toFixed(2)} ms  ${(b / c).toFixed(3)}x`);
  }
}
