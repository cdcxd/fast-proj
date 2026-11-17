//! f64x2 BD-09 offset kernels — the vector twin of src/bd09.ts, bit for bit (the same operations in the same order;
//! wasm has no fused multiply-add). WGS84 <-> BD-09 runs `vgcj` and these as two calls on the workspace: a fused
//! kernel measured within 2% of that once it stopped inlining the Newton pass, and held a third copy of the GCJ-02
//! kernel (+15 kB).
//!
//! Lanes outside the China box (with `boxed`, 'passthrough' mode) select their reduced input at the end, as in
//! `vgcj`; pairs with no lane in the box skip the math. The inverse's second pass (a solution at or below longitude
//! -180, solved again a turn away) runs only when a lane needs it.

use crate::gcj::KY;
use crate::simd::{store_pair, Vx};
use crate::vgcj;
use core::arch::wasm32::{v128, v128_any_true};

// As in src/bd09.ts.
const KB: f64 = core::f64::consts::PI * 3000.0 / 180.0;
const AR: f64 = 2e-5;
const AT: f64 = 3e-6;
const AKB: f64 = AR * KB;
const TKB: f64 = AT * KB;
const DLON: f64 = 0.0065;
const DLAT: f64 = 0.006;
const S: [f64; 5] = [
    -0.1666666666660356,
    0.008333333321635857,
    -0.00019841262251392823,
    2.7555079875852748e-6,
    -2.474433021199332e-8,
];
const C: [f64; 5] = [
    0.04166666666659918,
    -0.001388888887795134,
    2.480158085064316e-5,
    -2.7555547913821156e-7,
    2.0646636973611476e-9,
];

#[inline(always)]
fn spl<T: Vx>(x: f64) -> T {
    T::splat(x)
}

/// Horner from the highest coefficient, as the TS kernel writes it.
#[inline(always)]
fn horner<T: Vx>(z: T, c: &[f64; 5]) -> T {
    let mut p: T = spl(c[4]);
    for k in (0..4).rev() {
        p = spl::<T>(c[k]).add(z.mul(p));
    }
    p
}

/// (sin, cos) of 3000 deg degrees, as `turn` in src/bd09.ts: quarter turns taken off in degrees. The TS kernel's
/// branch-free selection by q & 1 and q & 2 becomes masks from q mod 4, computed exactly in floating point.
#[inline(always)]
fn turn<T: Vx>(deg: T) -> (T, T) {
    let t = spl::<T>(3000.0).mul(deg);
    let q = t.mul(spl(1.0 / 90.0)).nearest();
    let h = t.sub(spl::<T>(90.0).mul(q)).mul(spl(KY));
    let z = h.mul(h);
    let sn = h.add(h.mul(z).mul(horner(z, &S)));
    let cs = spl::<T>(1.0).sub(spl::<T>(0.5).mul(z)).add(z.mul(z).mul(horner(z, &C)));
    // m = q mod 4 in {0, 1, 2, 3}: q & 1 is m odd, q & 2 is m >= 2, (q + 1) & 2 is m in {1, 2}.
    let m = q.sub(spl::<T>(4.0).mul(q.mul(spl(0.25)).floor()));
    let odd = m.sub(spl::<T>(2.0).mul(m.mul(spl(0.5)).floor())).gt(spl(0.5));
    let neg_s = m.gt(spl(1.5));
    let neg_c = m.sub(spl(1.5)).abs().lt(spl(1.0));
    // sn + o (cs - sn) and cs + o (sn - cs), o in {0, 1}: o = 1 gives the sum, not cs or sn exactly.
    let s = T::select(sn.add(cs.sub(sn)), sn, odd);
    let c = T::select(cs.add(sn.sub(cs)), cs, odd);
    let sign: T = spl(-0.0);
    (s.xor(sign.and(neg_s)), c.xor(sign.and(neg_c)))
}

/// Lanes with latitude in [-90, 90] (false for NaN).
#[inline(always)]
fn lat_ok<T: Vx>(lat: T) -> T {
    spl::<T>(-90.0).le(lat).and(lat.le(spl(90.0)))
}

/// GCJ-02 -> BD-09 on reduced longitudes, without the box: `fromGcj02` in src/bd09.ts. Not inlined: one copy per
/// width serves both exports that use it.
#[inline(never)]
fn from_gcj<T: Vx>(lon: T, lat: T) -> (T, T) {
    let nan: T = spl(f64::NAN);
    let lon = T::select(spl(180.0), lon, lon.le(spl(-180.0)));
    let r = lon.mul(lon).add(lat.mul(lat)).sqrt();
    let pos = r.gt(spl(0.0));
    let ir = T::select(spl::<T>(1.0).div(r), spl(0.0), pos);
    let ca = T::select(lon.mul(ir), spl(1.0), pos);
    let sa = lat.mul(ir);
    let (sl, _) = turn(lat);
    let (_, cx) = turn(lon);
    let w = spl::<T>(AR).mul(sl);
    let d = spl::<T>(AT).mul(cx);
    let d2 = d.mul(d);
    let sd = d.sub(d.mul(d2).mul(spl(1.0 / 6.0)));
    let cm = spl::<T>(-0.5).mul(d2);
    let pc = ca.add(ca.mul(cm).sub(sa.mul(sd)));
    let ps = sa.add(sa.mul(cm).add(ca.mul(sd)));
    let shifted = lat.add(lat.mul(cm).add(lon.mul(sd)).add(w.mul(ps)).add(spl(DLAT)));
    let x = lon.add(lon.mul(cm).sub(lat.mul(sd)).add(w.mul(pc)).add(spl(DLON)));
    let x = T::select(x.sub(spl(360.0)), x, x.gt(spl(180.0)));
    let ok = lat_ok(lat).andnot(shifted.abs().gt(spl(90.0)));
    (T::select(x, nan, ok), T::select(shifted, nan, ok))
}

/// One pass of `toGcj02` in src/bd09.ts: two Newton steps on F(w) = (gx, lat) from (gx, lat) - (DLON, DLAT). Not
/// inlined: one copy per width serves both passes and both exports.
#[inline(never)]
fn solve<T: Vx>(gx: T, lat: T) -> (T, T) {
    let mut x = gx.sub(spl(DLON));
    let mut y = lat.sub(spl(DLAT));
    let (mut sy, mut cy) = turn(y);
    let (mut sx, mut cx) = turn(x);
    for k in 0..2 {
        let r = x.mul(x).add(y.mul(y)).sqrt();
        let pos = r.gt(spl(0.0));
        let ir = T::select(spl::<T>(1.0).div(r), spl(0.0), pos);
        let ca = T::select(x.mul(ir), spl(1.0), pos);
        let sa = y.mul(ir);
        let w = spl::<T>(AR).mul(sy);
        let d = spl::<T>(AT).mul(cx);
        let d2 = d.mul(d);
        let sd = d.sub(d.mul(d2).mul(spl(1.0 / 6.0)));
        let cm = spl::<T>(-0.5).mul(d2);
        let pc = ca.add(ca.mul(cm).sub(sa.mul(sd)));
        let ps = sa.add(sa.mul(cm).add(ca.mul(sd)));
        let fx = x.sub(gx).add(x.mul(cm).sub(y.mul(sd)).add(w.mul(pc)).add(spl(DLON)));
        let fy = y.sub(lat).add(y.mul(cm).add(x.mul(sd)).add(w.mul(ps)).add(spl(DLAT)));
        let z = r.add(w);
        let zy = sa.add(spl::<T>(AKB).mul(cy));
        let tx = sa.neg().mul(ir).sub(spl::<T>(TKB).mul(sx));
        let ty = ca.mul(ir);
        let j11 = pc.mul(ca).sub(z.mul(ps).mul(tx));
        let j12 = pc.mul(zy).sub(z.mul(ps).mul(ty));
        let j21 = ps.mul(ca).add(z.mul(pc).mul(tx));
        let j22 = ps.mul(zy).add(z.mul(pc).mul(ty));
        let idet = spl::<T>(1.0).div(j11.mul(j22).sub(j12.mul(j21)));
        let dx = j22.mul(fx).sub(j12.mul(fy)).mul(idet);
        let dy = j11.mul(fy).sub(j21.mul(fx)).mul(idet);
        x = x.sub(dx);
        y = y.sub(dy);
        if k == 1 {
            break;
        }
        // Rotate the sines by the step, as the TS kernel does.
        let ex = dx.neg().mul(spl(KB));
        let ey = dy.neg().mul(spl(KB));
        let ex2 = ex.mul(ex);
        let ey2 = ey.mul(ey);
        let sin = |e: T, e2: T| e.mul(spl::<T>(1.0).sub(e2.mul(spl::<T>(1.0 / 6.0).sub(e2.mul(spl(1.0 / 120.0))))));
        let cos = |e2: T| {
            spl::<T>(1.0).sub(e2.mul(spl::<T>(0.5).sub(e2.mul(spl::<T>(1.0 / 24.0).sub(e2.mul(spl(1.0 / 720.0)))))))
        };
        let (sex, cex, sey, cey) = (sin(ex, ex2), cos(ex2), sin(ey, ey2), cos(ey2));
        let (sx0, sy0) = (sx, sy);
        sx = sx0.mul(cex).add(cx.mul(sex));
        cx = cx.mul(cex).sub(sx0.mul(sex));
        sy = sy0.mul(cey).add(cy.mul(sey));
        cy = cy.mul(cey).sub(sy0.mul(sey));
    }
    (x, y)
}

/// BD-09 -> GCJ-02 on reduced longitudes, without the box: `toGcj02` in src/bd09.ts.
#[inline(always)]
fn to_gcj<T: Vx>(lon: T, lat: T) -> (T, T) {
    let (mut x, mut y) = solve(lon, lat);
    // The TS loop solves again a turn away when x <= -180 (or NaN).
    let again = x.gt(spl(-180.0)).not().and(lat_ok(lat));
    if again.any() {
        let (x1, y1) = solve(lon.add(spl(360.0)), lat);
        x = T::select(x1, x, again);
        y = T::select(y1, y, again);
    }
    let ok = lat_ok(lat).and(x.gt(spl(-180.0))).and(x.le(spl(180.0))).and(lat_ok(y));
    let nan: T = spl(f64::NAN);
    (T::select(x, nan, ok), T::select(y, nan, ok))
}

/// `f` on two pairs at a time, or one (a group with a single pair to compute, or the last pair if odd):
/// `(lon, lat, mask) -> (lon, lat)`, with lon reduced and `mask` the box (or all lanes, without `boxed`). Pairs with
/// no lane in the mask pass through.
#[inline(always)]
fn batch(
    lon: &[f64],
    lat: &[f64],
    olon: &mut [f64],
    olat: &mut [f64],
    boxed: bool,
    f2: impl Fn([v128; 2], [v128; 2], [v128; 2]) -> ([v128; 2], [v128; 2]),
    f1: impl Fn(v128, v128, v128) -> (v128, v128),
) {
    let prep = |i: usize| {
        let (l, p, b) = vgcj::prepare(lon, lat, i);
        (l, p, if boxed { b } else { spl::<v128>(0.0).le(spl(0.0)) })
    };
    let mut i = 0;
    while i + 4 <= lon.len() {
        let (l0, p0, b0) = prep(i);
        let (l1, p1, b1) = prep(i + 2);
        let (ol, op) = match (v128_any_true(b0), v128_any_true(b1)) {
            (true, true) => f2([l0, l1], [p0, p1], [b0, b1]),
            (true, false) => {
                let (a, b) = f1(l0, p0, b0);
                ([a, l1], [b, p1])
            }
            (false, true) => {
                let (a, b) = f1(l1, p1, b1);
                ([l0, a], [p0, b])
            }
            (false, false) => ([l0, l1], [p0, p1]),
        };
        store_pair(ol[0], olon, i);
        store_pair(op[0], olat, i);
        store_pair(ol[1], olon, i + 2);
        store_pair(op[1], olat, i + 2);
        i += 4;
    }
    while i < lon.len() {
        let (l, p, b) = prep(i);
        let (ol, op) = if v128_any_true(b) { f1(l, p, b) } else { (l, p) };
        store_pair(ol, olon, i);
        store_pair(op, olat, i);
        i += 2;
    }
}

#[inline(always)]
fn from_gcj_masked<T: Vx>(l: T, p: T, b: T) -> (T, T) {
    let (x, y) = from_gcj(l, p);
    (T::select(x, l, b), T::select(y, p, b))
}

#[inline(always)]
fn to_gcj_masked<T: Vx>(l: T, p: T, b: T) -> (T, T) {
    let (x, y) = to_gcj(l, p);
    (T::select(x, l, b), T::select(y, p, b))
}

pub fn from_gcj_batch(lon: &[f64], lat: &[f64], olon: &mut [f64], olat: &mut [f64], boxed: bool) {
    batch(lon, lat, olon, olat, boxed, from_gcj_masked, from_gcj_masked);
}

pub fn to_gcj_batch(lon: &[f64], lat: &[f64], olon: &mut [f64], olat: &mut [f64], boxed: bool) {
    batch(lon, lat, olon, olat, boxed, to_gcj_masked, to_gcj_masked);
}
