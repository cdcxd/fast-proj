// Usage: node bench/run.mjs [--browser] [--runs=N]   (bun bench/run.mjs for Bun)
// CHROME=/path/to/chrome overrides the Playwright Chromium.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith('--runs='))?.slice(7) ?? 31);
const n = 10000;

async function inProcess() {
  const { default: proj4 } = await import('proj4');
  const { default: gcoord } = await import('gcoord');
  const { gcj02, utm } = await import('../dist/index.js');
  const { lineString } = await import('../dist/geojson.js');
  const { loadWasm } = await import('../dist/wasm.js');
  const { runCases, runGcjCases } = await import('./cases.mjs');
  const ctx = await loadWasm();
  const runtime = typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`;
  const backends = { js: utm, [ctx.backend]: ctx.utm };
  return {
    runtime,
    rows: runCases(proj4, backends, lineString, { n, runs }),
    gcjRows: runGcjCases(gcoord, { js: gcj02, [ctx.backend]: ctx.gcj02 }, { n, runs }),
  };
}

async function inBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage();
  const files = {
    '/': ['text/html', '<!doctype html><title>bench</title>'],
    '/proj4.js': ['text/javascript', join(root, '../../node_modules/proj4/dist/proj4.js')],
    '/gcoord.js': ['text/javascript', join(root, '../../node_modules/gcoord/dist/gcoord.global.prod.js')],
    '/cases.mjs': ['text/javascript', join(root, 'bench/cases.mjs')],
  };
  await page.route('http://bench.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/dist/')) {
      const contentType = path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      return route.fulfill({ contentType, body: await readFile(join(root, path)) });
    }
    const f = files[path];
    if (!f) return route.fulfill({ status: 404 });
    const body = path === '/' ? f[1] : await readFile(f[1]);
    return route.fulfill({ contentType: f[0], body });
  });
  await page.goto('http://bench.local/');
  await page.addScriptTag({ url: '/proj4.js' });
  await page.addScriptTag({ url: '/gcoord.js' });
  const { rows, gcjRows } = await page.evaluate(
    async (opts) => {
      const { gcj02, utm } = await import('/dist/index.js');
      const { lineString } = await import('/dist/geojson.js');
      const { loadWasm } = await import('/dist/wasm.js');
      const { runCases, runGcjCases } = await import('/cases.mjs');
      const ctx = await loadWasm();
      return {
        rows: runCases(window.proj4, { js: utm, [ctx.backend]: ctx.utm }, lineString, opts),
        gcjRows: runGcjCases(window.gcoord, { js: gcj02, [ctx.backend]: ctx.gcj02 }, opts),
      };
    },
    { n, runs },
  );
  const runtime = `Chromium ${browser.version()}`;
  await browser.close();
  return { runtime, rows, gcjRows };
}

const { runtime, rows, gcjRows } = args.includes('--browser') ? await inBrowser() : await inProcess();
console.log(`${n} points, median of ${runs} (5 calls each) (${runtime})`);
for (const [baseline, table] of [
  ['proj4', rows],
  ['gcoord', gcjRows],
]) {
  const names = Object.keys(table[0].ms);
  console.log(`\n| direction | method | ${baseline} ms | ${names.map((k) => `${k} ms`).join(' | ')} |`);
  console.log(`|---|---|---:|${names.map(() => '---:').join('|')}|`);
  for (const r of table) {
    const cells = names.map((k) => `${r.ms[k].toFixed(2)} (${(r.base / r.ms[k]).toFixed(1)}×)`);
    console.log(`| ${r.direction} | ${r.method} | ${r.base.toFixed(2)} | ${cells.join(' | ')} |`);
  }
}
