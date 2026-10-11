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
  const { utm } = await import('../dist/index.js');
  const { lineString } = await import('../dist/geojson.js');
  const runtime = typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`;
  return { runtime, rows: (await import('./cases.mjs')).runCases(proj4, utm, lineString, { n, runs }) };
}

async function inBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage();
  const files = {
    '/': ['text/html', '<!doctype html><title>bench</title>'],
    '/proj4.js': ['text/javascript', join(root, '../../node_modules/proj4/dist/proj4.js')],
    '/cases.mjs': ['text/javascript', join(root, 'bench/cases.mjs')],
  };
  await page.route('http://bench.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/dist/')) {
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(root, path)) });
    }
    const f = files[path];
    if (!f) return route.fulfill({ status: 404 });
    const body = path === '/' ? f[1] : await readFile(f[1]);
    return route.fulfill({ contentType: f[0], body });
  });
  await page.goto('http://bench.local/');
  await page.addScriptTag({ url: '/proj4.js' });
  const rows = await page.evaluate(
    async (opts) => {
      const { utm } = await import('/dist/index.js');
      const { lineString } = await import('/dist/geojson.js');
      const { runCases } = await import('/cases.mjs');
      return runCases(window.proj4, utm, lineString, opts);
    },
    { n, runs },
  );
  const runtime = `Chromium ${browser.version()}`;
  await browser.close();
  return { runtime, rows };
}

const { runtime, rows } = args.includes('--browser') ? await inBrowser() : await inProcess();
console.log(`${n} points, median of ${runs} (5 calls each) (${runtime})\n`);
console.log('| direction | method | ms | vs proj4 |\n|---|---|---:|---:|');
let base = 0;
for (const r of rows) {
  if (r.method.startsWith('proj4')) base = r.ms;
  console.log(`| ${r.direction} | ${r.method} | ${r.ms.toFixed(2)} | ${(base / r.ms).toFixed(1)}× |`);
}
