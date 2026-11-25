/**
 * Leaflet layers for large typed-array data, for Leaflet 1.x (1.3.4+) and 2.0.
 *
 * Points are converted once, on setData, to Leaflet's zoom-0 pixels (with fast-proj's Web Mercator for EPSG:3857 maps,
 * after an optional datum shift such as GCJ-02 for Chinese basemaps). A redraw only scales them, clips and simplifies
 * to the canvas ({@link screenPath}), and strokes. The canvas follows Leaflet's renderers: redrawn on moveend, moved
 * and scaled with CSS during zoom animations.
 */
// oxlint-disable no-underscore-dangle -- Leaflet layers use this._map, and Leaflet's underscore naming for internals
import * as L from 'leaflet';
import type { Geographic } from './types.js';
import { webMercator } from './webmerc.js';
import { pathBlocks, type ScreenPath, screenPath } from './screen.js';

export interface FastPolylineOptions extends L.LayerOptions {
  /** Stroke color. Default '#3388ff', as L.Path. */
  color?: string;
  /** Stroke width in CSS pixels. Default 3, as L.Path. */
  weight?: number;
  /** Opacity of the whole layer (self-overlaps do not darken). Default 1. */
  opacity?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  /**
   * The basemap's geographic system when it is not WGS84, e.g. GCJ02 for AMap or Tencent tiles: input WGS84 longitudes
   * and latitudes are converted to it before drawing.
   */
  basemap?: Geographic;
  /** Simplification tolerance in device pixels. Default 0.5; 0 draws every visible point. */
  tolerance?: number;
  /** Extra canvas area around the view on each side, as a fraction of its size, as L.Renderer. Default 0.1. */
  padding?: number;
}

const R = 6378137;
const MAX_LAT = 85.0511287798; // L.Projection.SphericalMercator.MAX_LATITUDE

type Point = { x: number; y: number };

// Without its undefined values: L.Util.setOptions copies them over the defaults.
const defined = <T extends object>(o: T | undefined): T =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as T;
type ZoomAnimEvent = { center: L.LatLng; zoom: number };

// Leaflet's own EPSG:3857 (L.CRS.EPSG3857 in 1.x, L.EPSG3857 in 2.0), which the fast path reproduces. By identity:
// a custom CRS can keep the code with another scale, origin or wrapping (a Proj4Leaflet tile cache, 512-pixel tiles),
// and goes through map.project.
const LEAFLET_3857: unknown =
  (L as unknown as { CRS?: { EPSG3857?: unknown } }).CRS?.EPSG3857 ?? (L as unknown as { EPSG3857?: unknown }).EPSG3857;
// Leaflet's own latLngToPoint and Transformation#_transform: a CRS that keeps them maps to pixels as
// scale(zoom) · transformation(projection.project(latlng)) at scale 1, for any zoom (CRS#latLngToPoint).
type Crs = {
  latLngToPoint: unknown;
  transformation: { _transform: unknown; _a: number; _b: number; _c: number; _d: number };
  projection: { project(ll: L.LatLng): Point };
  scale(zoom: number): number;
};
const LEAFLET_LATLNG_TO_POINT = (L as unknown as { CRS: Crs }).CRS.latLngToPoint;
const LEAFLET_TRANSFORM = (L as unknown as { Transformation: { prototype: { _transform: unknown } } }).Transformation
  .prototype._transform;
// Leaflet 1.x without 3D transforms (L_DISABLE_3D, old browsers) positions with left/top; 2.0 always transforms.
const ANY_3D = (L as unknown as { Browser?: { any3d?: boolean } }).Browser?.any3d !== false;

/**
 * A polyline from interleaved WGS84 [lon0, lat0, lon1, lat1, ...]. A NaN longitude or latitude breaks the line.
 *
 * ```ts
 * import { FastPolyline } from 'fast-proj/leaflet';
 * new FastPolyline(track, { color: '#e34948', weight: 2 }).addTo(map);
 * ```
 */
// Extends the plain L.Layer so the declarations work with Leaflet 2's types and with @types/leaflet for 1.9, whose Layer
// is not generic; the options are read through `_opts`.
export class FastPolyline extends L.Layer {
  // Leaflet 2.0 runs init hooks (FastPolyline.addInitHook) at the end of the constructor, not inside super().
  static initHooks = true;

  private get _opts(): Required<Omit<FastPolylineOptions, 'basemap'>> & FastPolylineOptions {
    return this.options as never;
  }

  private _lonlat: ArrayLike<number>;
  private _world = new Float64Array(0);
  private _blocks = new Float64Array(0);
  private _worldCrs: unknown = null;
  private _worldMode = 0;
  private _worldZoom = 0;
  private _canvas: HTMLCanvasElement | undefined;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _path: ScreenPath | undefined;
  private _frame = 0;
  // The canvas was drawn at _zoom with its top left corner at the absolute pixel _origin.
  private _zoom = 0;
  private _origin: Point = { x: 0, y: 0 };
  // The canvas centre, as a LatLng and as absolute pixels at _zoom.
  private _center: L.LatLng | undefined;
  private _centerPx: Point = { x: 0, y: 0 };
  // The zoom and canvas size it was drawn for ('' for none).
  private _drawn = '';

  constructor(lonlat: ArrayLike<number>, options?: FastPolylineOptions) {
    super();
    if (lonlat.length % 2) throw new RangeError('fast-proj: lonlat must have an even length');
    this._lonlat = lonlat;
    L.Util.setOptions(this, defined(options));
    // Leaflet 1.x ran the hooks in super() already, and this is a no-op there.
    (this as unknown as { callInitHooks(): void }).callInitHooks();
  }

  /** Replaces the points. */
  setData(lonlat: ArrayLike<number>): this {
    if (lonlat.length % 2) throw new RangeError('fast-proj: lonlat must have an even length');
    this._lonlat = lonlat;
    this._worldCrs = null;
    return this.redraw();
  }

  /** Changes style options (color, weight, opacity, lineCap, lineJoin, tolerance). */
  setStyle(
    style: Pick<FastPolylineOptions, 'color' | 'weight' | 'opacity' | 'lineCap' | 'lineJoin' | 'tolerance'>,
  ): this {
    L.Util.setOptions(this, defined(style) as L.LayerOptions);
    if (this._canvas) this._canvas.style.opacity = String(this._opts.opacity);
    return this.redraw();
  }

  /** Redraws on the next animation frame. */
  redraw(): this {
    if (this._map && !this._frame) this._frame = requestAnimationFrame(() => this._redraw());
    return this;
  }

  override onAdd(map: L.Map): this {
    const canvas = (this._canvas = document.createElement('canvas'));
    // transform-origin 0 0, as Leaflet's own animated layers
    canvas.className = 'leaflet-layer leaflet-zoom-animated';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = String(this._opts.opacity);
    this._ctx = canvas.getContext('2d');
    this.getPane()!.appendChild(canvas);
    this._reset();
    // Added during a zoom animation (in a zoomanim handler that runs before the map's own): start at its target.
    const m = map as unknown as { _animatingZoom?: boolean; _animateToCenter?: L.LatLng; _animateToZoom?: number };
    if (m._animatingZoom && m._animateToCenter) {
      this._animateZoom({ center: m._animateToCenter, zoom: m._animateToZoom! } as ZoomAnimEvent);
    }
    this._watchDpr();
    return this;
  }

  override onRemove(): this {
    // Read the data again on the next add.
    this._worldCrs = null;
    this._drawn = '';
    if (this._canvas) {
      // Frees the backing store now (WebKit keeps it until collection, against a total canvas memory cap).
      this._canvas.width = 0;
      this._canvas.height = 0;
      this._canvas.remove();
    }
    this._canvas = undefined;
    this._dprQuery?.removeEventListener('change', this._onDpr);
    this._dprQuery = undefined;
    this._ctx = null;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    return this;
  }

  // A device pixel ratio change alone (a window moved to another screen) fires no map event.
  private _dprQuery: MediaQueryList | undefined;
  private _onDpr = (): void => {
    this._watchDpr();
    this._reset();
  };
  private _watchDpr(): void {
    this._dprQuery?.removeEventListener('change', this._onDpr);
    this._dprQuery =
      typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : undefined;
    this._dprQuery?.addEventListener('change', this._onDpr);
  }

  override getEvents() {
    return {
      viewreset: this._reset,
      moveend: this._reset,
      resize: this._reset,
      zoom: this._onZoom,
      zoomanim: this._animateZoom,
    } as unknown as ReturnType<NonNullable<L.Layer['getEvents']>>;
  }

  /**
   * The points in world units, cached per CRS: pixels at a zoom are world · _worldScale(zoom). Leaflet's EPSG:3857: its
   * zoom-0 pixels; a CRS with Leaflet's latLngToPoint: transformed projected units, scaled by crs.scale(zoom) (which
   * may be undefined at zoom 0); any other: the pixels at the given zoom, projected again for another zoom.
   */
  private _project(zoom: number): Float64Array {
    const map = this._map!;
    const crs = map.options.crs as unknown as Crs;
    if (this._worldCrs === crs && (this._worldMode !== 2 || this._worldZoom === zoom)) return this._world;
    const src = this._lonlat;
    const n = src.length;
    // Read in place without a datum shift (no copy of a large input).
    const g = this._opts.basemap;
    const ll: ArrayLike<number> = g ? g.fromWgs84Interleaved(src, new Float64Array(n)) : src;
    const world = n === this._world.length ? this._world : new Float64Array(n);
    const t = crs.transformation;
    this._worldMode =
      crs === LEAFLET_3857
        ? 0
        : crs.latLngToPoint === LEAFLET_LATLNG_TO_POINT && t._transform === LEAFLET_TRANSFORM
          ? 1
          : 2;
    this._worldZoom = zoom;
    if (this._worldMode === 0) {
      // L.CRS.EPSG3857: x = 256 (1/2 + X / 2piR), y = 256 (1/2 - Y / 2piR) of the spherical Mercator X, Y, from a
      // latitude clamped as L.Projection.SphericalMercator does (every clamped latitude has the same y). x is linear in
      // the longitude and, as in Leaflet, not wrapped (webMercator wraps it to [-180, 180]): a track across the
      // antimeridian stays continuous.
      webMercator().fromLonLatInterleaved(ll, world);
      const k = 256 / (2 * Math.PI * R);
      const top = 128 - k * R * Math.log(Math.tan(Math.PI / 4 + (MAX_LAT * Math.PI) / 360));
      for (let i = 0; i < n; i += 2) {
        const lon = ll[i]!;
        const lat = ll[i + 1]!;
        // Non-finite input breaks the line.
        const ok = lon - lon === 0 && lat - lat === 0;
        world[i] = ok ? 128 + lon * (256 / 360) : NaN;
        world[i + 1] = !ok ? NaN : lat > MAX_LAT ? top : lat < -MAX_LAT ? 256 - top : 128 - world[i + 1]! * k;
      }
    } else {
      for (let i = 0; i < n; i += 2) {
        const lon = ll[i]!;
        const lat = ll[i + 1]!;
        if (lon - lon === 0 && lat - lat === 0) {
          if (this._worldMode === 1) {
            const p = crs.projection.project(new L.LatLng(lat, lon));
            world[i] = t._a * p.x + t._b;
            world[i + 1] = t._c * p.y + t._d;
          } else {
            const p = map.project([lat, lon], zoom);
            world[i] = p.x;
            world[i + 1] = p.y;
          }
        } else {
          // A break; LatLng rejects NaN.
          world[i] = NaN;
          world[i + 1] = NaN;
        }
      }
    }
    this._world = world;
    this._blocks = pathBlocks(world);
    this._worldCrs = crs;
    return world;
  }

  private _worldScale(zoom: number): number {
    const crs = this._map!.options.crs as unknown as Crs;
    return this._worldMode === 0 ? this._map!.getZoomScale(zoom, 0) : this._worldMode === 1 ? crs.scale(zoom) : 1;
  }

  private _reset(): void {
    const map = this._map;
    const canvas = this._canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const pad = this._opts.padding!;
    const w = Math.round(size.x * (1 + 2 * pad));
    const h = Math.round(size.y * (1 + 2 * pad));
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    const zoom = map.getZoom();
    const po = map.getPixelOrigin();
    const key = `${zoom} ${bw} ${bh}`;
    // The view in absolute pixels. Still inside the drawn canvas (a pan within the padding, or viewreset, resize and
    // moveend for one change): the drawing holds, and only the position, relative to a pixel origin a viewreset can
    // move, is set again.
    const v = map.containerPointToLayerPoint([0, 0]);
    const vx = po.x + v.x;
    const vy = po.y + v.y;
    const o = this._origin;
    if (
      key === this._drawn &&
      vx >= o.x &&
      vy >= o.y &&
      vx + size.x <= o.x + w &&
      vy + size.y <= o.y + h &&
      canvas.width === bw &&
      canvas.height === bh
    ) {
      L.DomUtil.setPosition(canvas, new L.Point(o.x - po.x, o.y - po.y));
      return;
    }
    const topLeft = map.containerPointToLayerPoint([-pad * size.x, -pad * size.y]).round();
    L.DomUtil.setPosition(canvas, topLeft);
    this._zoom = zoom;
    this._origin = { x: po.x + topLeft.x, y: po.y + topLeft.y };
    this._centerPx = { x: this._origin.x + w / 2, y: this._origin.y + h / 2 };
    this._center = map.unproject(this._centerPx as L.Point, zoom);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    this._drawn = key;
    this._redraw();
  }

  private _redraw(): void {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    const map = this._map;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;
    const o = this._opts;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // A canvas ignores lineWidth 0; L.Canvas skips the stroke too.
    if (!(o.weight! > 0)) return;
    const world = this._project(this._zoom);
    const dpr = w / parseFloat(canvas.style.width);
    const s = this._worldScale(this._zoom) * dpr;
    // Clip beyond the canvas by the furthest a join reaches from its point, so joins at its edge are drawn whole: half
    // the width for round and bevel joins, up to half the width times the miter limit (10) for miters.
    const reach = o.lineJoin === 'miter' ? Math.max(1, ctx.miterLimit / 2) : 1;
    const m = o.weight! * dpr * reach + 2;
    const path = (this._path = screenPath(
      world,
      {
        scale: s,
        offsetX: -this._origin.x * dpr,
        offsetY: -this._origin.y * dpr,
        minX: -m,
        minY: -m,
        maxX: w + m,
        maxY: h + m,
        tolerance: o.tolerance!,
      },
      this._path,
      this._blocks,
    ));
    ctx.lineWidth = o.weight! * dpr;
    ctx.strokeStyle = o.color!;
    ctx.lineCap = o.lineCap!;
    ctx.lineJoin = o.lineJoin!;
    const { xy, runs, runCount } = path;
    // One stroke, as L.Canvas: strokes in pieces were 10% faster, but darken antialiased edges where pieces cross.
    ctx.beginPath();
    for (let k = 0; k < runCount; k++) {
      const a = runs[k]!;
      const b = runs[k + 1]!;
      ctx.moveTo(xy[2 * a]!, xy[2 * a + 1]!);
      for (let j = a + 1; j < b; j++) ctx.lineTo(xy[2 * j]!, xy[2 * j + 1]!);
    }
    ctx.stroke();
  }

  // Live zooms (pinch, flyTo) fire zoom per frame; CSS zoom animations fire zoomanim at the start with the target.
  private _onZoom(): void {
    const map = this._map;
    if (map) this._updateTransform(map.getZoom(), map.getPixelOrigin());
  }

  private _animateZoom(e: ZoomAnimEvent): void {
    const map = this._map!;
    const half = map.getSize().divideBy(2);
    const origin = map
      .project(e.center, e.zoom)
      .subtract(half)
      .subtract(map.containerPointToLayerPoint([0, 0]))
      .round();
    this._updateTransform(e.zoom, origin);
  }

  private _updateTransform(zoom: number, pixelOrigin: Point): void {
    const map = this._map!;
    const scale = map.getZoomScale(zoom, this._zoom);
    let x = this._origin.x * scale;
    let y = this._origin.y * scale;
    // A CRS with its own latLngToPoint may also shift pixels per zoom: place the canvas by its centre projected at the
    // new zoom, as L.Renderer does.
    if (this._worldMode === 2 && this._center) {
      const c = map.project(this._center, zoom);
      x = c.x - (this._centerPx.x - this._origin.x) * scale;
      y = c.y - (this._centerPx.y - this._origin.y) * scale;
    }
    const pos = new L.Point(x - pixelOrigin.x, y - pixelOrigin.y);
    if (ANY_3D) L.DomUtil.setTransform(this._canvas!, pos, scale);
    // As L.Renderer: no zoom animation without 3D transforms, and setPosition in _reset uses left/top too.
    else L.DomUtil.setPosition(this._canvas!, pos);
  }
}

// Leaflet 1.x keeps defaults on the prototype; without an own copy, mergeOptions would change every L.Layer.
if (L.version.startsWith('1.')) {
  FastPolyline.prototype.options = Object.create(L.Layer.prototype.options);
}
(FastPolyline as unknown as { mergeOptions(o: object): void }).mergeOptions({
  color: '#3388ff',
  weight: 3,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
  tolerance: 0.5,
  padding: 0.1,
});
