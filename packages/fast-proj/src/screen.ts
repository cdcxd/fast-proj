/**
 * Polyline to screen: scales and offsets world coordinates, clips each segment to a box, and simplifies each visible run
 * of segments to within a tolerance, in one pass with no allocation. The output is the input for a canvas path or a
 * WebGL line strip.
 *
 * Simplification is a corridor test (Reumann–Witkam): a run keeps its last kept point as an anchor and the direction to
 * the first later point at least `tolerance` from it, and skips points within `tolerance` of that line that keep moving
 * forward. Linear in the point count, against Douglas–Peucker's n log n with a stack. At half a device pixel the result
 * differs from the full path on about 1% of the stroked pixels, at the edges.
 */

/** A world → screen mapping and clip box, in output units (device pixels for a canvas). */
export interface ScreenView {
  /** screen = world · scale + offset, per axis. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The clip box, in screen units. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Simplification tolerance in screen units; 0 keeps every visible point. */
  tolerance: number;
}

/** Reusable output of {@link screenPath}; its buffers are longer than the output. */
export interface ScreenPath {
  /** Interleaved screen points [x0, y0, x1, y1, ...] of all runs, back to back. */
  xy: Float32Array;
  /** Run k is points runs[k] (inclusive) to runs[k + 1] (exclusive); runs[runCount] is the point count. */
  runs: Uint32Array;
  runCount: number;
}

/**
 * Screen paths of an interleaved world polyline [x0, y0, x1, y1, ...]. A NaN or infinite coordinate breaks the line.
 * Pass the previous result back as `out` to reuse its buffers; they grow as needed.
 */
export function screenPath(world: ArrayLike<number>, view: ScreenView, out?: ScreenPath): ScreenPath {
  const n = world.length >> 1;
  let xy = out?.xy ?? new Float32Array(4096);
  let runs = out?.runs ?? new Uint32Array(256);
  const { scale, offsetX, offsetY, minX, minY, maxX, maxY } = view;
  const tol2 = view.tolerance * view.tolerance;

  const px = world[0]! * scale + offsetX;
  const py = world[1]! * scale + offsetY;
  F[0] = px;
  F[1] = py;
  I.fill(0);
  I[0] = outcode(px, py, minX, minY, maxX, maxY);
  F[8] = scale;
  F[9] = offsetX;
  F[10] = offsetY;
  F[11] = minX;
  F[12] = minY;
  F[13] = maxX;
  F[14] = maxY;
  F[15] = tol2;
  // Chunks, so that V8 optimizes chunk() as a whole after a few calls instead of entering a long loop by on-stack
  // replacement, which in Chromium 156 runs the first redraws about 4x slower. i = n is a break that closes the last
  // run, inside the loop: code after a loop entered by on-stack replacement has no type feedback, and V8 deoptimized
  // there on every call.
  for (let i0 = 1; i0 <= n; i0 += CHUNK) {
    const i1 = Math.min(i0 + CHUNK, n + 1);
    // Room for the chunk's worst case: each segment writes at most its clipped end, plus its start when it opens a
    // run; the buffers grow by doubling, so they stay near the output size rather than the input size.
    const points = I[1]! + 2 * (i1 - i0) + 1;
    if (xy.length < 2 * points) xy = grow(xy, 2 * points) as Float32Array;
    const starts = I[2]! + (i1 - i0) + 2;
    if (runs.length < starts) runs = grow(runs, starts) as Uint32Array;
    chunk(world, i0, i1, n, xy, runs);
  }
  const m = I[1]!;
  const r = I[2]!;
  runs[r] = m;
  if (out) {
    out.xy = xy;
    out.runs = runs;
    out.runCount = r;
    return out;
  }
  return { xy, runs, runCount: r };
}

function grow(a: Float32Array | Uint32Array, min: number): Float32Array | Uint32Array {
  let k = a.length * 2;
  while (k < min) k *= 2;
  const b = a instanceof Float32Array ? new Float32Array(k) : new Uint32Array(k);
  b.set(a);
  return b;
}

// State between chunks: px, py (the previous point), ax, ay (the anchor, the last point written), ux, uy (the corridor
// direction), cx, cy (the pending point, the furthest one skipped) and cf (its distance along the corridor); pc (its outcode), m (points written), r (runs
// started), open, hasDir, pend.
const F = new Float64Array(17);
const I = new Int32Array(6);
const CHUNK = 4096;

// Outcodes: 1 left, 2 right, 4 above, 8 below; 16 not finite.
function outcode(x: number, y: number, minX: number, minY: number, maxX: number, maxY: number): number {
  return x - x !== 0 || y - y !== 0 ? 16 : (x < minX ? 1 : x > maxX ? 2 : 0) | (y < minY ? 4 : y > maxY ? 8 : 0);
}

function chunk(world: ArrayLike<number>, i0: number, i1: number, n: number, xy: Float32Array, runs: Uint32Array): void {
  const scale = F[8]!;
  const offsetX = F[9]!;
  const offsetY = F[10]!;
  const minX = F[11]!;
  const minY = F[12]!;
  const maxX = F[13]!;
  const maxY = F[14]!;
  const tol2 = F[15]!;
  let px = F[0]!;
  let py = F[1]!;
  let ax = F[2]!;
  let ay = F[3]!;
  let ux = F[4]!;
  let uy = F[5]!;
  let cx = F[6]!;
  let cy = F[7]!;
  let cf = F[16]!;
  let pc = I[0]!;
  let m = I[1]!;
  let r = I[2]!;
  let open = I[3] === 1;
  let hasDir = I[4] === 1;
  let pend = I[5] === 1;
  for (let i = i0; i < i1; i++) {
    const qx = i < n ? world[2 * i]! * scale + offsetX : NaN;
    const qy = i < n ? world[2 * i + 1]! * scale + offsetY : NaN;
    const qc =
      qx - qx !== 0 || qy - qy !== 0 ? 16 : (qx < minX ? 1 : qx > maxX ? 2 : 0) | (qy < minY ? 4 : qy > maxY ? 8 : 0);

    if ((pc | qc) & 16 || pc & qc) {
      // Not finite, or wholly on one side of the box: close the run.
      if (open) {
        if (pend) {
          xy[2 * m] = cx;
          xy[2 * m + 1] = cy;
          m++;
        }
        open = false;
      }
    } else {
      let sx = px;
      let sy = py;
      let ex = qx;
      let ey = qy;
      if (pc | qc) {
        // Liang–Barsky: the parameter range [t0, t1] of the segment inside the box.
        const dx = qx - px;
        const dy = qy - py;
        let t0 = 0;
        let t1 = 1;
        if (dx !== 0) {
          const a = (minX - px) / dx;
          const b = (maxX - px) / dx;
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          if (lo > t0) t0 = lo;
          if (hi < t1) t1 = hi;
        }
        if (dy !== 0) {
          const a = (minY - py) / dy;
          const b = (maxY - py) / dy;
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          if (lo > t0) t0 = lo;
          if (hi < t1) t1 = hi;
        }
        if (t0 > t1) {
          // Misses the box (crosses only the corner region outside it).
          if (open) {
            if (pend) {
              xy[2 * m] = cx;
              xy[2 * m + 1] = cy;
              m++;
            }
            open = false;
          }
          px = qx;
          py = qy;
          pc = qc;
          continue;
        }
        if (pc) {
          sx = px + t0 * dx;
          sy = py + t0 * dy;
        }
        if (qc) {
          ex = px + t1 * dx;
          ey = py + t1 * dy;
        }
      }
      if (!open) {
        runs[r++] = m;
        xy[2 * m] = sx;
        xy[2 * m + 1] = sy;
        m++;
        ax = sx;
        ay = sy;
        hasDir = false;
        pend = false;
        open = true;
      }
      // Feed the segment end to the corridor.
      const fx = ex - ax;
      const fy = ey - ay;
      if (!hasDir) {
        const d2 = fx * fx + fy * fy;
        if (d2 >= tol2 && d2 > 0) {
          const l = Math.sqrt(d2);
          ux = fx / l;
          uy = fy / l;
          cf = l;
          hasDir = true;
        }
        cx = ex;
        cy = ey;
        pend = true;
      } else {
        // Skipped while within the corridor and not behind the pending point (which would cut off the tip of a
        // doubling back): every skipped point is then within about 2 tolerances of the anchor-pending segment.
        const off = fx * uy - fy * ux;
        const f = fx * ux + fy * uy;
        if (off * off < tol2 && f >= cf) {
          cf = f;
          cx = ex;
          cy = ey;
          pend = true;
        } else {
          // Leaves the corridor: keep the pending point and start a new corridor from it.
          xy[2 * m] = cx;
          xy[2 * m + 1] = cy;
          m++;
          ax = cx;
          ay = cy;
          const gx = ex - ax;
          const gy = ey - ay;
          const g2 = gx * gx + gy * gy;
          if (g2 >= tol2 && g2 > 0) {
            const l = Math.sqrt(g2);
            ux = gx / l;
            uy = gy / l;
            cf = l;
            hasDir = true;
          } else hasDir = false;
          cx = ex;
          cy = ey;
          pend = true;
        }
      }
      if (qc) {
        // Leaves the box: the clipped end closes the run.
        xy[2 * m] = cx;
        xy[2 * m + 1] = cy;
        m++;
        pend = false;
        open = false;
      }
    }
    px = qx;
    py = qy;
    pc = qc;
  }
  F[0] = px;
  F[1] = py;
  F[2] = ax;
  F[3] = ay;
  F[4] = ux;
  F[5] = uy;
  F[6] = cx;
  F[7] = cy;
  F[16] = cf;
  I[0] = pc;
  I[1] = m;
  I[2] = r;
  I[3] = open ? 1 : 0;
  I[4] = hasDir ? 1 : 0;
  I[5] = pend ? 1 : 0;
}
