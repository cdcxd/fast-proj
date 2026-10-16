/* eslint-disable no-await-in-loop -- Benchmark revisions must run serially to avoid CPU contention. */
// Compare built revisions without sharing JIT feedback between them.
// node bench/compare-performance.mts --base=/path/to/base/dist/utm.js [--browser]
// bun bench/compare-performance.mts --base=/path/to/base/dist/utm.js
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, arch, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Projection } from '../dist/index.js';

declare global {
  // `toSorted` is ES2023; the repo lib target is es2022, so the bench script declares the method itself.
  interface Array<T> {
    toSorted(compareFn?: (a: T, b: T) => number): T[];
  }
}

/** Sizes and repetitions used by {@link measure}; parsed from --runs/--repeats. */
type MeasureConfig = { n: number; runs: number; reps: number; warmups: number };
/** One measured direction of one dataset: medians plus a checksum of the output buffers. */
type MeasureRow = { dataset: string; direction: string; ms: number; p25: number; p75: number; checksum: number };
/** One full run of one revision inside one round. */
type RevisionRecord = { round: number; revision: string; rows: MeasureRow[] };

const args = process.argv.slice(2);
const option = (name: string, fallback?: string | number): string | number | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const here = dirname(fileURLToPath(import.meta.url));
const basePath = option('base');
if (!basePath) throw new Error('--base=/path/to/base/dist/utm.js is required');
const base = resolve(basePath as string);
const candidate = resolve(option('candidate', resolve(here, '../dist/utm.js')) as string);
const config: MeasureConfig = { n: 10000, runs: Number(option('runs', 51)), reps: 5, warmups: 150 };
const repeats = Number(option('repeats', 3));
if (!Number.isInteger(config.runs) || config.runs < 1 || !Number.isInteger(repeats) || repeats < 1) {
  throw new Error('--runs and --repeats must be positive integers');
}
const median = (values: number[]): number => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function measure(
  utm: (options: { zone: number }) => Projection,
  baseline: (options: { zone: number }) => Projection,
  { n, runs, reps, warmups }: MeasureConfig,
) {
  const converter = utm({ zone: 33 });
  const reference = baseline({ zone: 33 });
  const rows: MeasureRow[] = [];
  for (const [dataset, lonMin, lonWidth, latMin, latWidth] of [
    ['UTM', 12, 6, 45, 18],
    ['wide', -15, 60, -80, 164],
  ] as const) {
    const lon = new Float64Array(n);
    const lat = new Float64Array(n);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const first = new Float64Array(n);
    const second = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lon[i] = lonMin + (lonWidth * ((i * 7919) % n)) / n;
      lat[i] = latMin + (latWidth * ((i * 104729) % n)) / n;
    }
    reference.fromLonLat(lon, lat, x, y);
    for (const [direction, call] of [
      ['forward', () => converter.fromLonLat(lon, lat, first, second)],
      ['inverse', () => converter.toLonLat(x, y, first, second)],
    ] as const) {
      for (let i = 0; i < warmups; i++) call();
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const start = performance.now();
        for (let j = 0; j < reps; j++) call();
        samples.push((performance.now() - start) / reps);
      }
      const sorted = samples.toSorted((a, b) => a - b);
      rows.push({
        dataset,
        direction,
        ms: sorted[Math.floor(runs / 2)]!,
        p25: sorted[Math.floor(runs / 4)]!,
        p75: sorted[Math.floor((3 * runs) / 4)]!,
        checksum: first[20]! + second[n - 1]!,
      });
    }
  }
  return rows;
}

if (args.includes('--worker')) {
  const revision = option('revision') as string;
  const [{ utm }, { utm: baseline }] = await Promise.all([
    import(pathToFileURL(revision).href),
    import(pathToFileURL(base).href),
  ]);
  console.log(JSON.stringify(await measure(utm, baseline, config)));
} else {
  const records: RevisionRecord[] = [];
  let runtime = typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`;
  let browser;
  if (args.includes('--browser')) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    runtime = `Chromium ${browser.version()}`;
  }
  try {
    for (let round = 0; round < repeats; round++) {
      const revisions: [string, string][] =
        round % 2
          ? [
              ['candidate', candidate],
              ['base', base],
            ]
          : [
              ['base', base],
              ['candidate', candidate],
            ];
      for (const [revision, path] of revisions) {
        let rows;
        if (browser) {
          const page = await browser.newPage();
          await page.route('http://bench.local/**', async (route) => {
            const requested = new URL(route.request().url()).pathname;
            const body =
              requested === '/'
                ? '<!doctype html><title>Arithmetic comparison</title>'
                : requested === '/measure.js'
                  ? `export const measure = ${measure.toString()};`
                  : await readFile(
                      resolve(
                        requested.startsWith('/base/') ? dirname(base) : dirname(candidate),
                        requested.replace(/^\/(base|candidate)\//, ''),
                      ),
                    );
            await route.fulfill({
              contentType: requested === '/' ? 'text/html' : 'text/javascript',
              headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
              body,
            });
          });
          await page.goto('http://bench.local/');
          rows = await page.evaluate(
            async ({ revision: requestedRevision, config: settings }) => {
              const [{ measure: measureKernel }, { utm }, { utm: baseline }] = await Promise.all([
                import('/measure.js' as string),
                import(`/${requestedRevision}/utm.js`),
                import('/base/utm.js' as string),
              ]);
              return measureKernel(utm, baseline, settings);
            },
            { revision, config },
          );
          await page.close();
        } else {
          rows = JSON.parse(
            execFileSync(
              process.execPath,
              [
                fileURLToPath(import.meta.url),
                '--worker',
                `--base=${base}`,
                `--candidate=${candidate}`,
                `--revision=${path}`,
                `--runs=${config.runs}`,
              ],
              { encoding: 'utf8' },
            ),
          );
        }
        records.push({ round: round + 1, revision, rows });
      }
    }
  } finally {
    await browser?.close();
  }
  const comparison = records[0]!.rows.map(({ dataset, direction }) => {
    const times = (revision: string) =>
      records
        .filter((r) => r.revision === revision)
        .map((r) => r.rows.find((row) => row.dataset === dataset && row.direction === direction)!.ms);
    const baseline = median(times('base'));
    const optimized = median(times('candidate'));
    return {
      dataset,
      direction,
      baselineMs: baseline,
      candidateMs: optimized,
      timeReductionPercent: 100 * (1 - optimized / baseline),
      speedup: baseline / optimized,
    };
  });
  console.log(
    JSON.stringify(
      {
        runtime,
        recordedAt: new Date().toISOString(),
        builtFiles: {
          base: {
            path: base,
            sha256: createHash('sha256')
              .update(await readFile(base))
              .digest('hex'),
          },
          candidate: {
            path: candidate,
            sha256: createHash('sha256')
              .update(await readFile(candidate))
              .digest('hex'),
          },
        },
        machine: { cpu: cpus()[0]?.model, arch: arch(), platform: platform() },
        config: {
          ...config,
          repeats,
          method: 'preallocated split buffers, median of per-revision medians, alternating fresh processes/pages',
        },
        comparison,
        records,
      },
      null,
      2,
    ),
  );
}
