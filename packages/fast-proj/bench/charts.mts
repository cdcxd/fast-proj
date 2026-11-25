// Draws the README speedup charts from the tables in docs/benchmarks.md.
// Usage: node bench/charts.mts  (writes docs/img/bench-{batch,point}-{light,dark}.svg)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const md = readFileSync(new URL('docs/benchmarks.md', root), 'utf8');

interface Row {
  op: string;
  wasm: boolean;
  x: number[]; // speedup per runtime
}
interface Group {
  baseline: string;
  rows: Row[];
}

const cells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());

// Each table is a group; its baseline is the row without a speedup, or the Baseline column.
function parse(): { runtimes: string[]; batch: Group[]; point: Group[] } {
  const batch: Group[] = [];
  const point: Group[] = [];
  let runtimes: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith('|') || !lines[i + 1]?.startsWith('| --')) continue;
    const head = cells(lines[i]!);
    // Only the conversion tables (the Leaflet table has its own layout).
    if (head[0] !== 'Operation') continue;
    runtimes = head.slice(2);
    const isPoint = head[1] === 'Baseline';
    let op = '';
    let baseline = '';
    const byBaseline = new Map<string, Group>();
    const groups: Group[] = [];
    for (i += 2; lines[i]?.startsWith('|'); i++) {
      const c = cells(lines[i]!);
      if (c[0]) op = c[0];
      const x = c.slice(2).map((s) => Number(/\(([\d.]+)×\)/.exec(s)?.[1] ?? NaN));
      if (x.some(Number.isNaN)) {
        baseline = c[1]!;
        continue;
      }
      const base = isPoint ? c[1]! : baseline;
      let g = byBaseline.get(base);
      if (!g || (isPoint && groups.at(-1) !== g)) {
        g = { baseline: base, rows: [] };
        byBaseline.set(base, g);
        groups.push(g);
      }
      g.rows.push({ op, wasm: c[1]!.includes('WebAssembly'), x });
    }
    (isPoint ? point : batch).push(...groups);
  }
  // Merge consecutive batch groups with the same baseline.
  const merged: Group[] = [];
  for (const g of batch) {
    const last = merged.at(-1);
    if (last?.baseline === g.baseline) last.rows.push(...g.rows);
    else merged.push(g);
  }
  return { runtimes, batch: merged, point };
}

const themes = {
  light: {
    surface: '#fcfcfb',
    text: '#0b0b0b',
    secondary: '#52514e',
    muted: '#76756f',
    grid: '#e6e5e0',
    axis: '#c3c2b7',
    js: '#2a78d6',
    wasm: '#eb6834',
  },
  dark: {
    surface: '#1a1a19',
    text: '#f0efec',
    secondary: '#c3c2b7',
    muted: '#9a998f',
    grid: '#2c2c2a',
    axis: '#4a4a46',
    js: '#3987e5',
    wasm: '#d95926',
  },
};
type Theme = (typeof themes)['light'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v: number) => `${v.toFixed(1)}×`;

// Horizontal bar, square at the baseline, 4px rounded data end.
function bar(x0: number, y: number, w: number, h: number, fill: string, title: string) {
  const r = Math.min(4, w, h / 2);
  const x1 = x0 + w;
  return (
    `<path fill="${fill}" d="M${x0} ${y}H${x1 - r}Q${x1} ${y} ${x1} ${y + r}V${y + h - r}Q${x1} ${y + h} ${x1 - r} ${y + h}H${x0}Z">` +
    `<title>${esc(title)}</title></path>`
  );
}

function chart(
  title: string,
  subtitle: string,
  runtimes: string[],
  groups: Group[],
  t: Theme,
  legend: boolean,
): string {
  const W = 960;
  const pad = 20;
  const labelW = 196;
  const gap = 24;
  const panelW = (W - 2 * pad - labelW - gap * (runtimes.length - 1)) / runtimes.length;
  const tipRoom = 42; // value label past the bar end
  const barH = 10;
  const barGap = 2;
  const ops = (g: Group) => [...new Set(g.rows.map((r) => r.op))];
  const perOp = Math.max(...groups.flatMap((g) => ops(g).map((op) => g.rows.filter((r) => r.op === op).length)));
  const rowH = perOp * barH + (perOp - 1) * barGap + 12;
  const groupHead = 22;
  const max = Math.max(...groups.flatMap((g) => g.rows.flatMap((r) => r.x)));
  const step = max > 12 ? 10 : max > 6 ? 2 : 1;
  const top = Math.ceil(max / step) * step;
  const sx = (v: number) => (v / top) * (panelW - tipRoom);

  let y = pad;
  const out: string[] = [];
  out.push(`<text x="${pad}" y="${y + 16}" font-size="17" font-weight="600" fill="${t.text}">${esc(title)}</text>`);
  y += 24;
  out.push(`<text x="${pad}" y="${y + 14}" font-size="13" fill="${t.secondary}">${esc(subtitle)}</text>`);
  if (legend) {
    let lx = W - pad;
    const items: [string, string][] = [
      ['WebAssembly', t.wasm],
      ['JavaScript', t.js],
    ];
    for (const [name, color] of items) {
      const w = name.length * 7.2;
      lx -= w;
      out.push(`<text x="${lx}" y="${y + 14}" font-size="13" fill="${t.secondary}">${name}</text>`);
      lx -= 16;
      out.push(`<rect x="${lx}" y="${y + 4}" width="10" height="10" rx="2" fill="${color}"/>`);
      lx -= 18;
    }
  }
  y += 34;

  const x0 = (k: number) => pad + labelW + k * (panelW + gap);
  const plotTop = y + 22;
  runtimes.forEach((rt, k) => {
    out.push(`<text x="${x0(k)}" y="${y + 13}" font-size="13" font-weight="600" fill="${t.text}">${esc(rt)}</text>`);
  });
  y = plotTop;

  const body: string[] = [];
  for (const [gi, g] of groups.entries()) {
    if (gi > 0) y += 8;
    body.push(`<text x="${pad}" y="${y + 15}" font-size="12" fill="${t.muted}">vs ${esc(g.baseline)}</text>`);
    y += groupHead;
    for (const op of ops(g)) {
      const rows = g.rows.filter((r) => r.op === op);
      const h = rows.length * barH + (rows.length - 1) * barGap;
      const cy = y + 6 + h / 2;
      body.push(`<text x="${pad}" y="${cy + 4.5}" font-size="13" fill="${t.text}">${esc(op)}</text>`);
      runtimes.forEach((rt, k) => {
        rows.forEach((r, j) => {
          const by = y + 6 + j * (barH + barGap);
          const w = sx(r.x[k]!);
          const name = r.wasm ? 'WebAssembly' : 'JavaScript';
          const color = r.wasm ? t.wasm : t.js;
          body.push(bar(x0(k), by, w, barH, color, `${op}, ${name}, ${rt}: ${fmt(r.x[k]!)} faster than ${g.baseline}`));
          body.push(
            `<text x="${x0(k) + w + 5}" y="${by + barH - 1}" font-size="11" fill="${t.secondary}">${fmt(r.x[k]!)}</text>`,
          );
        });
      });
      y += rowH;
    }
  }
  const plotBottom = y;

  // Grid and the baseline at 0, under the bars.
  const grid: string[] = [];
  runtimes.forEach((_, k) => {
    for (let v = 0; v <= top; v += step) {
      const gx = x0(k) + sx(v);
      grid.push(
        `<line x1="${gx}" y1="${plotTop}" x2="${gx}" y2="${plotBottom}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/>`,
      );
      grid.push(
        `<text x="${gx}" y="${plotBottom + 15}" font-size="11" text-anchor="middle" fill="${t.muted}">${v}×</text>`,
      );
    }
  });
  y = plotBottom + 22;

  const H = y + pad - 4;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" role="img">\n` +
    `<title>${esc(title)}</title>\n` +
    `<rect width="${W}" height="${H}" rx="8" fill="${t.surface}"/>\n` +
    [...out, ...grid, ...body].join('\n') +
    '\n</svg>\n'
  );
}

const { runtimes, batch, point } = parse();
const dir = new URL('docs/img/', root);
mkdirSync(dir, { recursive: true });
for (const [mode, t] of Object.entries(themes)) {
  writeFileSync(
    new URL(`bench-batch-${mode}.svg`, dir),
    chart(
      'Batch conversion, 10,000 points',
      'Times faster than the baseline library (higher is better)',
      runtimes,
      batch,
      t,
      true,
    ),
  );
  writeFileSync(
    new URL(`bench-point-${mode}.svg`, dir),
    chart(
      'Single-point calls',
      'Times faster than the baseline library, one point per call (higher is better)',
      runtimes,
      point,
      t,
      false,
    ),
  );
}
console.log(`${batch.length} batch groups, ${point.length} point groups -> docs/img`);
