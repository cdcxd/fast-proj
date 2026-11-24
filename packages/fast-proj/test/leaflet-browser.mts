// Checks fast-proj/leaflet in Chromium against Leaflet 1.9 and 2.0: FastPolyline must draw where L.Polyline draws and
// move with the tiles during zoom animations. Usage: node test/leaflet-browser.mts (after a build; needs
// `bunx playwright install chromium`). Prints LEAFLET_CHECKS_PASS.
// oxlint-disable no-await-in-loop -- the steps drive one map in order
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

declare const map: any;

const pkg = fileURLToPath(new URL('../', import.meta.url));
const modules = fileURLToPath(new URL('../../../node_modules/', import.meta.url));
const versions = [
  { name: '1.9', dir: `${modules}leaflet1/dist/`, entry: 'leaflet-src.esm.js' },
  { name: '2.0', dir: `${modules}leaflet/dist/`, entry: 'leaflet.js' },
];

const page = (entry: string) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>.leaflet-zoom-anim .leaflet-zoom-animated { transition: none !important; }</style>
<script type="importmap">{"imports":{"leaflet":"/leaflet/${entry}"}}</script>
<body style="margin:0"><div id="map" style="width:900px;height:640px"></div>
<script type="module">
import * as L from 'leaflet';
import { FastPolyline } from '/dist/leaflet.js';
import { GCJ02 } from '/dist/index.js';
const v2 = !L.version.startsWith('1.');
let s = 3;
const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
const ll = new Float64Array(10000);
for (let i = 0, lon = 116.3, lat = 39.9, h = 0; i < 5000; i++) {
  h += (rnd() - 0.5) * 0.4; lon += Math.cos(h) * 4e-4; lat += Math.sin(h) * 3e-4;
  ll[2 * i] = lon; ll[2 * i + 1] = lat;
}
ll[5000] = NaN; // a break
const map = (window.map = new L.Map('map', { zoomSnap: 0, fadeAnimation: false }));
for (const [name, z] of [['ref', 400], ['fast', 401]]) { map.createPane(name); map.getPane(name).style.zIndex = z; }
const tile = (c) => { const d = document.createElement('div'); d.dataset.k = c.x + ':' + c.y + ':' + c.z; return d; };
const Blank = v2 ? class extends L.GridLayer { createTile(c) { return tile(c); } } : L.GridLayer.extend({ createTile: tile });
new Blank().addTo(map);
let fast;
window.setup = (gcj) => {
  const src = gcj ? GCJ02.fromWgs84Interleaved(ll) : ll;
  const parts = [[]];
  for (let i = 0; i < src.length; i += 2) {
    if (Number.isNaN(src[i]) || Number.isNaN(src[i + 1])) parts.push([]); else parts.at(-1).push([src[i + 1], src[i]]);
  }
  const renderer = new L.Canvas({ pane: 'ref' });
  const ref = new L.Polyline(parts, { renderer, color: '#ff0000', weight: 3, smoothFactor: 0, interactive: false }).addTo(map);
  fast = new FastPolyline(ll, { pane: 'fast', color: '#0000ff', weight: 3, tolerance: 0, basemap: gcj ? GCJ02 : undefined }).addTo(map);
  map.fitBounds(ref.getBounds(), { animate: false });
};
window.show = (which) => {
  map.getPane('ref').style.visibility = which === 'fast' ? 'hidden' : '';
  map.getPane('fast').style.visibility = which === 'ref' ? 'hidden' : '';
};
// Offsets between tiles and where the layer's canvas puts the tiles' corners, in CSS pixels. Zoom transitions are off
// (see the style above), so during an animation every element is already where its transition would end.
window.tileOffsets = () => {
  const c = map.getPane('fast').querySelector('canvas');
  const cr = c.getBoundingClientRect();
  const sc = cr.width / parseFloat(c.style.width);
  return [...document.querySelectorAll('.leaflet-tile')].slice(0, 16).map((t) => {
    const [x, y, z] = t.dataset.k.split(':').map(Number);
    const tr = t.getBoundingClientRect();
    const f = map.getZoomScale(fast._zoom, z);
    return Math.max(
      Math.abs(tr.x - (cr.x + (x * 256 * f - fast._origin.x) * sc)),
      Math.abs(tr.y - (cr.y + (y * 256 * f - fast._origin.y) * sc)),
    );
  });
};
window.api = () => {
  fast.setStyle({ color: '#00ff00', opacity: 0.5 });
  fast.setData(ll.subarray(0, 2000));
  const n = map.getPane('fast').querySelectorAll('canvas').length;
  fast.remove();
  return [n, map.getPane('fast').querySelectorAll('canvas').length];
};
window.ready = true;
</script>`;

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch();
for (const v of versions) {
  for (const dpr of [1, 2]) {
    for (const gcj of [false, true]) {
      const p = await browser.newPage({ viewport: { width: 900, height: 640 }, deviceScaleFactor: dpr });
      p.on('pageerror', (e) => failures.push(`${v.name}: page error ${e.message}`));
      await p.route('http://check.local/**', (r) => {
        const u = new URL(r.request().url()).pathname;
        if (u === '/') return r.fulfill({ body: page(v.entry), contentType: 'text/html' });
        const f = u.startsWith('/leaflet/') ? v.dir + u.slice(9) : pkg + u.slice(1);
        const type = f.endsWith('.css') ? 'text/css' : 'text/javascript';
        try {
          return r.fulfill({ body: readFileSync(f), contentType: type });
        } catch {
          return r.fulfill({ status: 404 });
        }
      });
      await p.goto('http://check.local/');
      await p.waitForFunction('window.ready');
      await p.evaluate((g) => (window as any).setup(g), gcj);
      const tag = `Leaflet ${v.name}, dpr ${dpr}${gcj ? ', GCJ-02' : ''}`;

      // Stroke pixels of one layer with no stroke pixel of the other within r device pixels, from screenshots with
      // one pane shown, as a fraction of the reference's stroke pixels.
      const shot = async (which: string) => {
        await p.evaluate((w) => (window as any).show(w), which);
        await p.waitForTimeout(30);
        return (await p.screenshot()).toString('base64');
      };
      const compare = async (label: string) => {
        await p.waitForTimeout(50);
        // Leaflet 1.9 rounds points to whole CSS pixels; 2.0 does not.
        const radius = v.name === '1.9' ? dpr : 0;
        const [on, diff] = await p.evaluate(
          async ([a64, b64, r]) => {
            const masks = await Promise.all(
              [a64, b64].map(async (data) => {
                const img = new Image();
                img.src = `data:image/png;base64,${data}`;
                await img.decode();
                const c = new OffscreenCanvas(img.width, img.height);
                const x = c.getContext('2d')!;
                x.drawImage(img, 0, 0);
                const d = x.getImageData(0, 0, img.width, img.height).data;
                const m = new Uint8Array(img.width * img.height);
                for (let i = 0; i < m.length; i++)
                  m[i] = Math.max(d[4 * i]!, d[4 * i + 2]!) - d[4 * i + 1]! > 100 ? 1 : 0;
                return { m, w: img.width, h: img.height };
              }),
            );
            const { w, h } = masks[0]!;
            const near = (m: Uint8Array, x: number, y: number) => {
              for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  const xx = x + dx;
                  const yy = y + dy;
                  if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) return true;
                }
              }
              return false;
            };
            const [a, b] = [masks[0]!.m, masks[1]!.m];
            let count = 0;
            let misses = 0;
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const i = y * w + x;
                count += a[i]!;
                if ((a[i] && !near(b, x, y)) || (b[i] && !near(a, x, y))) misses++;
              }
            }
            return [count, misses];
          },
          [await shot('ref'), await shot('fast'), radius] as const,
        );
        check(
          on > 1000 && diff / on < 0.01,
          `${tag}, ${label}: ${((100 * diff) / on).toFixed(2)}% of ${on} pixels differ`,
        );
      };
      await compare('fit');
      await p.evaluate(() => map.panBy([123.4, -57.3], { animate: false }));
      await compare('pan');
      await p.evaluate(() => map.setZoom(map.getZoom() + 2.37, { animate: false }));
      await compare('zoom +2.37');
      await p.evaluate(() => map.setView(map.getCenter(), map.getZoom() - 3.1, { animate: false }));
      await compare('zoom -3.1');
      // During zoom animations (a whole level and a fraction) and after, the canvas moves with the tiles.
      // Leaflet 1.9 rounds tile level transforms to whole pixels; 2.0 does not.
      const slack = v.name === '1.9' ? 0.5 : 0.01;
      for (const dz of [1, -0.6]) {
        const mid = await p.evaluate(
          (d) =>
            new Promise<number[]>((done) => {
              map.once('zoomanim', () => setTimeout(() => done((window as any).tileOffsets()), 0));
              map.setZoom(map.getZoom() + d);
            }),
          dz,
        );
        check(
          mid.length > 0 && Math.max(...mid) < slack,
          `${tag}, zoom animation ${dz}: tile offsets ${Math.max(...mid)}`,
        );
        // With transitions off, Leaflet 2.0 ends the animation on its 1 s fallback timer (1.9: 250 ms).
        await p.waitForTimeout(1100);
        const settled = await p.evaluate(() => (window as any).tileOffsets() as number[]);
        check(Math.max(...settled) < slack, `${tag}, after zoom animation ${dz}: tile offsets ${Math.max(...settled)}`);
      }
      await compare('after zoom animations');
      const [before, after] = await p.evaluate(() => (window as any).api());
      check(before === 1 && after === 0, `${tag}, setStyle, setData, remove: canvases ${before} then ${after}`);
      await p.close();
    }
  }
}
await browser.close();
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('LEAFLET_CHECKS_PASS');
