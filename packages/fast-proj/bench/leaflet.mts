// FastPolyline against L.Polyline on Leaflet's canvas renderer, in Chromium, for Leaflet 1.9 and 2.0.
// Usage: node bench/leaflet.mts [--points=1000000]   (after a build; needs `bunx playwright install chromium`)
//
// Times are the work for each step: requestAnimationFrame is queued and run synchronously, so they exclude the wait
// for the next frame, and include the canvas rasterization (forced by a pixel read).
// oxlint-disable no-await-in-loop -- one measurement at a time
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const n = Number(process.argv.find((a) => a.startsWith('--points='))?.slice(9) ?? 1e6);
const pkg = fileURLToPath(new URL('../', import.meta.url));
const modules = fileURLToPath(new URL('../../../node_modules/', import.meta.url));
const versions = [
  { name: '1.9', dir: `${modules}leaflet1/dist/`, entry: 'leaflet-src.esm.js' },
  { name: '2.0', dir: `${modules}leaflet/dist/`, entry: 'leaflet.js' },
];

const page = (entry: string) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/leaflet/leaflet.css">
<script>
const queue = new Map();
let id = 0;
window.requestAnimationFrame = (f) => (queue.set(++id, f), id);
window.cancelAnimationFrame = (i) => queue.delete(i);
window.flushFrames = () => {
  for (let k = 0; k < 4 && queue.size; k++) {
    const fs = [...queue.values()];
    queue.clear();
    const t = performance.now();
    for (const f of fs) f(t);
  }
};
</script>
<script type="importmap">{"imports":{"leaflet":"/leaflet/${entry}"}}</script>
<body style="margin:0"><div id="map" style="width:1024px;height:768px"></div>
<script type="module">
import * as L from 'leaflet';
import { FastPolyline } from '/dist/leaflet.js';
// A drive: fixes every second at 5-30 m/s, heading pulled toward a target that changes every five minutes.
function drive(n) {
  let s = 2;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const a = new Float64Array(2 * n);
  for (let i = 0, lon = 116.4, lat = 39.9, h = 0, target = 0, v = 15; i < n; i++) {
    if (i % 300 === 0) target = h + (rnd() - 0.5) * 2;
    h += (target - h) * 0.02 + (rnd() - 0.5) * 0.05;
    v = Math.min(30, Math.max(5, v + rnd() - 0.5));
    lon += (Math.cos(h) * v) / (111320 * Math.cos((lat * Math.PI) / 180));
    lat += (Math.sin(h) * v) / 110540;
    a[2 * i] = lon;
    a[2 * i + 1] = lat;
  }
  return a;
}
const flush = () => { for (const c of document.querySelectorAll('canvas')) c.getContext('2d').getImageData(0, 0, 1, 1); };
const pause = () => new Promise((r) => setTimeout(r, 30));
async function timed(f) { await pause(); const t = performance.now(); f(); flushFrames(); flush(); return performance.now() - t; }
async function median(f, k = 5) { const t = []; for (let i = 0; i < k; i++) t.push(await timed(() => f(i))); return t.sort((a, b) => a - b)[k >> 1]; }

window.run = async (kind, n) => {
  const map = new L.Map('map', { zoomAnimation: false, fadeAnimation: false });
  const ll = drive(n);
  let lon0 = Infinity, lat0 = Infinity, lon1 = -Infinity, lat1 = -Infinity;
  for (let i = 0; i < ll.length; i += 2) {
    lon0 = Math.min(lon0, ll[i]); lon1 = Math.max(lon1, ll[i]); lat0 = Math.min(lat0, ll[i + 1]); lat1 = Math.max(lat1, ll[i + 1]);
  }
  map.fitBounds([[lat0, lon0], [lat1, lon1]], { animate: false });
  flushFrames();
  const z = map.getZoom();
  const out = {};
  if (kind === 'leaflet') {
    let latlngs;
    out.add = await timed(() => {
      latlngs = new Array(n);
      for (let i = 0; i < n; i++) latlngs[i] = [ll[2 * i + 1], ll[2 * i]];
      new L.Polyline(latlngs, { renderer: new L.Canvas(), weight: 3 }).addTo(map);
    });
  } else {
    out.add = await timed(() => new FastPolyline(ll, { weight: 3 }).addTo(map));
  }
  const pan = (i) => map.panBy([i % 2 ? -150 : 150, 60], { animate: false });
  out.pan = await median(pan);
  // Each zoom from the other level, set untimed before it.
  const zoom = async (from, to) => {
    const t = [];
    for (let k = 0; k < 5; k++) {
      map.setZoom(from, { animate: false });
      flushFrames();
      t.push(await timed(() => map.setZoom(to, { animate: false })));
    }
    return t.sort((a, b) => a - b)[2];
  };
  out.zoomIn = await zoom(z, z + 3);
  out.panZoomedIn = await median(pan);
  out.zoomOut = await zoom(z + 3, z);
  return out;
};
window.ready = true;
</script>`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const rows: string[] = [];
for (const v of versions) {
  const res: Record<string, Record<string, number>> = {};
  for (const kind of ['leaflet', 'fast']) {
    // A fresh page per layer, so neither warms the JIT for the other.
    const p = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
    await p.route('http://bench.local/**', (r) => {
      const u = new URL(r.request().url()).pathname;
      if (u === '/') return r.fulfill({ body: page(v.entry), contentType: 'text/html' });
      const f = u.startsWith('/leaflet/') ? v.dir + u.slice(9) : pkg + u.slice(1);
      return r.fulfill({ body: readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await p.goto('http://bench.local/');
    await p.waitForFunction('window.ready');
    res[kind] = await p.evaluate(([k, m]) => (window as any).run(k, m), [kind, n] as const);
    await p.close();
  }
  for (const step of Object.keys(res.fast!)) {
    const a = res.leaflet![step]!;
    const b = res.fast![step]!;
    rows.push(`| ${v.name} | ${step} | ${a.toFixed(1)} ms | ${b.toFixed(1)} ms | ${(a / b).toFixed(1)}× |`);
  }
}
console.log(`${n} points, ${browser.version()}, 1024×768 at DPR 2\n`);
console.log('| Leaflet | Step | L.Polyline | FastPolyline | Speedup |\n| --- | --- | --: | --: | --: |');
console.log(rows.join('\n'));
await browser.close();
