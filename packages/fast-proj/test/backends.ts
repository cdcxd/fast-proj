import { gcj02, tmerc, utm } from '../src/index.js';
import { loadWasm } from '../src/wasm.js';

// Built by `bun run build` (wasm/build.sh); `bun run check` builds before testing.
const simd = await loadWasm({ source: new URL('../dist/fast-proj.wasm', import.meta.url) });

export const backends = [
  { name: 'js', utm, tmerc, gcj02 },
  { name: simd.backend, utm: simd.utm, tmerc: simd.tmerc, gcj02: simd.gcj02 },
];
