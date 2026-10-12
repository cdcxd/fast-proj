// Node entry for the wasm-backed Utm wrapper: loads the simd kernel from disk
// (build artifact or user cache), feature-detects simd128, and falls back to
// the TypeScript kernel when unavailable. The API surface itself lives in
// wasm-utm-core.mjs, which has no node dependencies.
/* eslint-disable no-await-in-loop -- artifact locations are a serial fallback chain. */
import { utm as tsUtm } from '../../packages/utm/dist/utm.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createConverter, simdSupported } from './wasm-utm-core.mjs';

export { simdSupported };

let instancePromise = null;

async function loadInstance() {
  const root = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
  for (const candidate of [`${root}/build/simd.wasm`, `${homedir()}/.cache/fast-proj/utm-simd.wasm`]) {
    try {
      const bytes = readFileSync(candidate);
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance;
    } catch (err) {
      // only fall through on a missing file; a present-but-invalid artifact
      // must surface its real error instead of "not found"
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  throw new Error('simd.wasm not found; build with scripts/build.sh');
}

export async function utmWasm(options) {
  if (!simdSupported()) {
    const { zone, south, ellipsoid } = options ?? {};
    return tsUtm({ zone, south, ellipsoid });
  }
  instancePromise ??= loadInstance();
  const inst = await instancePromise;
  return createConverter(inst.exports, options ?? {});
}
