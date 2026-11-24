---
'fast-proj': minor
---

New `fast-proj/leaflet` entry with `FastPolyline`, a Leaflet 1.9 / 2.0 layer for large polylines from interleaved
WGS84 typed arrays, with an optional `basemap: GCJ02` shift for Chinese basemaps. For 1M points in Chromium it zooms
about 30× faster than `L.Polyline`, adds 5× faster and pans 2× faster. New `screenPath` in the root entry: clips and
simplifies a polyline to screen coordinates for canvas or WebGL drawing. `leaflet` is an optional peer dependency.
