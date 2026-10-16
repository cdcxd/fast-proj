# Coming from proj4

fast-proj intentionally does not parse proj4 strings or look up EPSG codes: you construct the converter for the
projection you have. A small `fromEpsg()` for the supported codes may be added later.

| proj4 / EPSG                                                                                                               | fast-proj                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `+proj=utm +zone=33 +datum=WGS84`, EPSG:32633                                                                              | `utm({ zone: 33 })`                                                                           |
| `+proj=utm +zone=33 +south +datum=WGS84`, EPSG:32733                                                                       | `utm({ zone: 33, south: true })`                                                              |
| EPSG:326NN / 327NN                                                                                                         | `utm({ zone: NN })` / `utm({ zone: NN, south: true })`                                        |
| `+proj=utm +zone=32 +ellps=GRS80` (ETRS89 / UTM 32N, EPSG:25832)                                                           | `utm({ zone: 32, ellipsoid: GRS80 })`                                                         |
| `+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80` (CGCS2000 3° Gauss-Krüger CM 117E, EPSG:4548)       | `tmerc({ centralMeridian: 117, falseEasting: 500000, ellipsoid: GRS80 })`                     |
| `+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=39500000 +y_0=0 +ellps=GRS80` (CGCS2000 3° zone 39 with zone prefix, EPSG:4527) | `tmerc({ centralMeridian: 117, falseEasting: 39500000, ellipsoid: GRS80 })`                   |
| `+proj=tmerc +lat_0=0 +lon_0=L +k=K +x_0=E +y_0=N +ellps=…`                                                                | `tmerc({ centralMeridian: L, scaleFactor: K, falseEasting: E, falseNorthing: N, ellipsoid })` |
| `+proj=longlat +datum=WGS84`, EPSG:4326                                                                                    | the hub: what `toLonLat` returns and `fromLonLat` takes                                       |
| GCJ-02 (not in proj4; gcoord `GCJ02`, coordtransform `wgs84togcj02`)                                                       | `gcj02()`: `fromWgs84` / `toWgs84`                                                            |

How calls map:

```ts
// proj4
const conv = proj4('EPSG:32633', 'EPSG:4326');
const [lon, lat] = conv.forward([x, y]);
const [x2, y2] = conv.inverse([lon, lat]);

// fast-proj
const zone33 = utm({ zone: 33 });
const [lon, lat] = zone33.toLonLatPoint(x, y);
const [x2, y2] = zone33.fromLonLatPoint(lon, lat);
zone33.toLonLatInterleaved(xy, xy); // whole buffers, in place
```

Not covered: `+lat_0` other than 0 (e.g. the British National Grid), datum shifts (`+towgs84`, grids), and other
projections. For those, keep using proj4.

Ellipsoid parameters: proj4's `+a`/`+rf` map to `{ a, f: 1 / rf }`. `+ellps=GRS80` and `+ellps=WGS84` are exported as
`GRS80` and `WGS84`.
