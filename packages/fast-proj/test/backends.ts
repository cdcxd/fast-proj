import { tmerc, utm } from '../src/index.js';
import { loadWasm } from '../src/wasm.js';

// Built by `bun run build` (wasm/build.sh); `bun run check` builds before testing.
const simd = await loadWasm({ source: new URL('../dist/fast-proj.wasm', import.meta.url) });
const scalar = await loadWasm({ source: new URL('../dist/fast-proj-scalar.wasm', import.meta.url) });

export const backends = [
  { name: 'js', utm, tmerc },
  { name: simd.backend, utm: simd.utm, tmerc: simd.tmerc },
  { name: scalar.backend, utm: scalar.utm, tmerc: scalar.tmerc },
];
