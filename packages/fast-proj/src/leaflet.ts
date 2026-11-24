/**
 * Leaflet layers for large typed-array data, for Leaflet 1.9 and 2.0.
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
import { type ScreenPath, screenPath } from './screen.js';

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
  private get _opts(): Required<Omit<FastPolylineOptions, 'basemap'>> & FastPolylineOptions {
    return this.options as never;
  }

  private _lonlat: ArrayLike<number>;
  private _world = new Float64Array(0);
  private _worldCrs: unknown = null;
  private _canvas: HTMLCanvasElement | undefined;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _path: ScreenPath | undefined;
  private _frame = 0;
  // The canvas was drawn at _zoom with its top left corner at the absolute pixel _origin.
  private _zoom = 0;
  private _origin: Point = { x: 0, y: 0 };
  // The view the canvas was last drawn for: viewreset, resize and moveend often come together for one change.
  private _drawn = '';

  constructor(lonlat: ArrayLike<number>, options?: FastPolylineOptions) {
    super();
    if (lonlat.length % 2) throw new RangeError('fast-proj: lonlat must have an even length');
    this._lonlat = lonlat;
    L.Util.setOptions(this, defined(options));
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
    void map;
    return this;
  }

  override onRemove(): this {
    // Read the data again on the next add.
    this._worldCrs = null;
    this._drawn = '';
    this._canvas?.remove();
    this._canvas = undefined;
    this._ctx = null;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    return this;
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

  /** Leaflet's zoom-0 pixels of the points, cached per CRS. */
  private _project(): Float64Array {
    const map = this._map!;
    const crs = map.options.crs;
    if (this._worldCrs === crs) return this._world;
    const src = this._lonlat;
    const n = src.length;
    let ll = Float64Array.from(src);
    const g = this._opts.basemap;
    if (g) ll = g.fromWgs84Interleaved(ll, ll);
    const world = n === this._world.length ? this._world : new Float64Array(n);
    if ((crs as { code?: string }).code === 'EPSG:3857') {
      // L.CRS.EPSG3857: x = 256 (1/2 + X / 2piR), y = 256 (1/2 - Y / 2piR) of the spherical Mercator X, Y, from a
      // latitude clamped as L.Projection.SphericalMercator does. x is linear in the longitude and, as in Leaflet, not
      // wrapped (webMercator wraps it to [-180, 180]): a track across the antimeridian stays continuous.
      for (let i = 1; i < n; i += 2) {
        const lat = ll[i]!;
        if (lat > MAX_LAT) ll[i] = MAX_LAT;
        else if (lat < -MAX_LAT) ll[i] = -MAX_LAT;
      }
      webMercator().fromLonLatInterleaved(ll, world);
      const k = 256 / (2 * Math.PI * R);
      for (let i = 0; i < n; i += 2) {
        const lon = ll[i]!;
        const lat = ll[i + 1]!;
        // Non-finite input breaks the line (a clamped infinite latitude would not).
        const ok = lon - lon === 0 && lat - lat === 0;
        world[i] = ok ? 128 + lon * (256 / 360) : NaN;
        world[i + 1] = ok ? 128 - world[i + 1]! * k : NaN;
      }
    } else {
      for (let i = 0; i < n; i += 2) {
        const lon = ll[i]!;
        const lat = ll[i + 1]!;
        if (lon - lon === 0 && lat - lat === 0) {
          const p = map.project([lat, lon], 0);
          world[i] = p.x;
          world[i + 1] = p.y;
        } else {
          // A break; LatLng rejects NaN.
          world[i] = NaN;
          world[i + 1] = NaN;
        }
      }
    }
    this._world = world;
    this._worldCrs = crs;
    return world;
  }

  private _reset(): void {
    const map = this._map;
    const canvas = this._canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const pad = this._opts.padding!;
    const topLeft = map.containerPointToLayerPoint([-pad * size.x, -pad * size.y]).round();
    L.DomUtil.setPosition(canvas, topLeft);
    this._zoom = map.getZoom();
    const po = map.getPixelOrigin();
    this._origin = { x: po.x + topLeft.x, y: po.y + topLeft.y };
    const w = Math.round(size.x * (1 + 2 * pad));
    const h = Math.round(size.y * (1 + 2 * pad));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    const view = `${this._zoom} ${this._origin.x} ${this._origin.y} ${bw} ${bh}`;
    if (view === this._drawn && canvas.width === bw && canvas.height === bh) return;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    this._drawn = view;
    this._redraw();
  }

  private _redraw(): void {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    const map = this._map;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;
    const world = this._project();
    const o = this._opts;
    const w = canvas.width;
    const h = canvas.height;
    const dpr = w / parseFloat(canvas.style.width);
    const s = map.getZoomScale(this._zoom, 0) * dpr;
    // Clip a stroke width beyond the canvas, so joins at its edge are drawn whole.
    const m = o.weight! * dpr + 2;
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
    ));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = o.weight! * dpr;
    ctx.strokeStyle = o.color!;
    ctx.lineCap = o.lineCap!;
    ctx.lineJoin = o.lineJoin!;
    const { xy, runs, runCount } = path;
    // With round caps and joins, a path stroked in pieces of 256 points looks the same and strokes up to 40% faster
    // in Chromium (opacity applies to the whole canvas, so overlapping pieces do not darken).
    const piece = o.lineCap === 'round' && o.lineJoin === 'round' ? 256 : Infinity;
    ctx.beginPath();
    for (let k = 0; k < runCount; k++) {
      const a = runs[k]!;
      const b = runs[k + 1]!;
      ctx.moveTo(xy[2 * a]!, xy[2 * a + 1]!);
      for (let j = a + 1, c = 0; j < b; j++) {
        ctx.lineTo(xy[2 * j]!, xy[2 * j + 1]!);
        if (++c === piece && j + 1 < b) {
          c = 0;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(xy[2 * j]!, xy[2 * j + 1]!);
        }
      }
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
    const scale = this._map!.getZoomScale(zoom, this._zoom);
    const pos = new L.Point(this._origin.x * scale - pixelOrigin.x, this._origin.y * scale - pixelOrigin.y);
    L.DomUtil.setTransform(this._canvas!, pos, scale);
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
