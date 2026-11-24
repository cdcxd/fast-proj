import { describe, expect, it } from 'vitest';
import { type ScreenPath, type ScreenView, screenPath } from '../src/screen.js';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
}

// A wandering line with occasional sharp turns and doubling back, in world units.
function walk(n: number, seed: number, step = 0.3): Float64Array {
  const r = rng(seed);
  const w = new Float64Array(2 * n);
  let x = 0;
  let y = 0;
  let h = 0;
  for (let i = 0; i < n; i++) {
    h += (r() - 0.5) * 0.3 + (r() < 0.01 ? Math.PI * (r() - 0.5) * 2 : 0);
    x += Math.cos(h) * step * (0.2 + r());
    y += Math.sin(h) * step * (0.2 + r());
    w[2 * i] = x;
    w[2 * i + 1] = y;
  }
  return w;
}

const runsOf = (p: ScreenPath) =>
  Array.from({ length: p.runCount }, (_, k) => Array.from(p.xy.subarray(2 * p.runs[k]!, 2 * p.runs[k + 1]!)));

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const view = (o: Partial<ScreenView>): ScreenView => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  minX: 0,
  minY: 0,
  maxX: 1000,
  maxY: 1000,
  tolerance: 0,
  ...o,
});

describe('screenPath', () => {
  it('keeps every point inside the box at tolerance 0', () => {
    const w = [10, 10, 20, 10, 20, 20, 10.25, 20.5];
    const p = screenPath(w, view({}));
    expect(runsOf(p)).toEqual([w]);
    const q = screenPath(w, view({ scale: 2, offsetX: 5, offsetY: -3 }));
    expect(runsOf(q)).toEqual([[25, 17, 45, 17, 45, 37, 25.5, 38]]);
  });

  it('clips segments to the box and splits runs', () => {
    const v = view({ maxX: 100, maxY: 100 });
    // In, out to the right, back in, then a segment across the whole box from outside to outside.
    const w = [50, 50, 150, 50, 150, 60, 50, 60, -50, 200, -50, -50, 150, 150];
    expect(runsOf(screenPath(w, v))).toEqual([
      [50, 50, 100, 50],
      // leaves through the bottom edge, 40 / 140 of the way to (-50, 200)
      [100, 60, 50, 60, Math.fround(50 - (100 * 40) / 140), 100],
      [0, 0, 100, 100],
    ]);
  });

  it('breaks the line at non-finite points', () => {
    const w = [1, 1, 2, 2, NaN, 3, 4, 4, 5, 5, Infinity, 0, 6, 6];
    expect(runsOf(screenPath(w, view({})))).toEqual([
      [1, 1, 2, 2],
      [4, 4, 5, 5],
    ]);
    expect(screenPath([], view({})).runCount).toBe(0);
    expect(screenPath([1, 2], view({})).runCount).toBe(0);
  });

  it('stays within twice the tolerance of every visible point, across chunks', () => {
    for (const [seed, tol, zoom] of [
      [1, 0.5, 1],
      [2, 1, 1],
      [3, 0.5, 8],
      [4, 2, 0.25],
    ] as const) {
      const w = walk(30000, seed);
      const v = view({ scale: zoom, offsetX: 500 - w[30000]! * zoom, offsetY: 500 - w[30001]! * zoom, tolerance: tol });
      const p = screenPath(w, v);
      const runs = runsOf(p);
      expect(p.runs[p.runCount]).toBeLessThan(30000);
      for (const r of runs) for (const c of r) expect(c >= -1e-3 && c <= 1000 + 1e-3).toBe(true);
      // Every input point inside the box, against the output segments near it (an 8-unit grid of their bounds).
      const cell = 8;
      const grid = new Map<number, number[]>();
      const segs: number[] = [];
      for (const r of runs) {
        for (let j = 0; j + 3 < r.length; j += 2) {
          const k = segs.length;
          segs.push(r[j]!, r[j + 1]!, r[j + 2]!, r[j + 3]!);
          for (
            let gx = Math.floor(Math.min(r[j]!, r[j + 2]!) / cell);
            gx <= Math.floor(Math.max(r[j]!, r[j + 2]!) / cell);
            gx++
          ) {
            for (
              let gy = Math.floor(Math.min(r[j + 1]!, r[j + 3]!) / cell);
              gy <= Math.floor(Math.max(r[j + 1]!, r[j + 3]!) / cell);
              gy++
            ) {
              const key = gx * 4096 + gy;
              const list = grid.get(key);
              if (list) list.push(k);
              else grid.set(key, [k]);
            }
          }
        }
      }
      let worst = 0;
      for (let i = 0; i < 30000; i++) {
        const x = w[2 * i]! * v.scale + v.offsetX;
        const y = w[2 * i + 1]! * v.scale + v.offsetY;
        if (x < 0 || x > 1000 || y < 0 || y > 1000) continue;
        let d = Infinity;
        for (let gx = Math.floor(x / cell) - 1; gx <= Math.floor(x / cell) + 1; gx++) {
          for (let gy = Math.floor(y / cell) - 1; gy <= Math.floor(y / cell) + 1; gy++) {
            for (const k of grid.get(gx * 4096 + gy) ?? []) {
              d = Math.min(d, distToSegment(x, y, segs[k]!, segs[k + 1]!, segs[k + 2]!, segs[k + 3]!));
            }
          }
        }
        worst = Math.max(worst, d);
      }
      expect(worst).toBeLessThanOrEqual(2 * tol + 1e-3);
    }
  });

  it('gives the same result when called again with its output', () => {
    const w = walk(20000, 7);
    const v = view({ scale: 4, offsetX: 500 - w[20000]! * 4, offsetY: 500 - w[20001]! * 4, tolerance: 0.5 });
    const a = screenPath(w, v);
    const first = runsOf(a);
    const b = screenPath(w, v, a);
    expect(b).toBe(a);
    expect(runsOf(b)).toEqual(first);
  });
});
