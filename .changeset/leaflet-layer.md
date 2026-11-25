---
'fast-proj': minor
---

New `fast-proj/leaflet` entry with `FastPolyline`, a Leaflet 1.x / 2.0 layer for large polylines from interleaved
WGS84 typed arrays, with an optional `basemap: GCJ02` shift for Chinese basemaps. For 1M points in Chromium it zooms
20-45× faster than `L.Polyline` and adds 5× faster. New `screenPath` and `pathBlocks` in the root entry: clip and
simplify a polyline to screen coordinates for canvas or WebGL drawing, skipping blocks of points outside the view. `leaflet` is an optional peer dependency.
