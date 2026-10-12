// `backends` maps a column name to a `utm` factory, e.g. { js: utm, wasm: ctx.utm }.
export function runCases(proj4, backends, lineString, { n = 10000, runs = 31, reps = 5 } = {}) {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const lonIn = new Float64Array(n);
  const latIn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = 300000 + ((i * 7919) % n) * (400000 / n);
    ys[i] = 5000000 + ((i * 104729) % n) * (2000000 / n);
    lonIn[i] = 12 + ((i * 7919) % n) * (6 / n);
    latIn[i] = 45 + ((i * 104729) % n) * (18 / n);
  }
  const xy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    xy[2 * i] = xs[i];
    xy[2 * i + 1] = ys[i];
  }
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const out = new Float64Array(2 * n);
  const inv = proj4('+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs', 'WGS84');

  const baselines = {
    'UTM → WGS84': () => {
      for (let i = 0; i < n; i++) inv.forward([xs[i], ys[i]]);
    },
    'WGS84 → UTM': () => {
      for (let i = 0; i < n; i++) inv.inverse([lonIn[i], latIn[i]]);
    },
    'flat UTM → GeoJSON LineString': () => {
      const coordinates = [];
      for (let i = 0; i < n; i++) coordinates.push(inv.forward([xy[2 * i], xy[2 * i + 1]]));
      return { type: 'LineString', coordinates };
    },
  };
  const cases = (conv) => [
    [
      'UTM → WGS84',
      'toLonLatPoint',
      () => {
        for (let i = 0; i < n; i++) conv.toLonLatPoint(xs[i], ys[i]);
      },
    ],
    ['UTM → WGS84', 'toLonLat (output buffers)', () => conv.toLonLat(xs, ys, a, b)],
    ['UTM → WGS84', 'toLonLatInterleaved (output buffer)', () => conv.toLonLatInterleaved(xy, out)],
    ['WGS84 → UTM', 'fromLonLat (output buffers)', () => conv.fromLonLat(lonIn, latIn, a, b)],
    [
      'flat UTM → GeoJSON LineString',
      'toLonLatInterleaved + lineString',
      () => lineString(conv.toLonLatInterleaved(xy, out)),
    ],
  ];

  function time(fn) {
    for (let i = 0; i < 10; i++) fn();
    const t = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      for (let r = 0; r < reps; r++) fn();
      t.push((performance.now() - s) / reps);
    }
    t.sort((x, y) => x - y);
    return t[runs >> 1];
  }

  const proj4Ms = Object.fromEntries(Object.entries(baselines).map(([k, fn]) => [k, time(fn)]));
  const rows = cases(null).map(([direction, method]) => ({ direction, method, proj4: proj4Ms[direction], ms: {} }));
  for (const [name, utm] of Object.entries(backends)) {
    cases(utm({ zone: 33 })).forEach(([, , fn], i) => {
      rows[i].ms[name] = time(fn);
    });
  }
  return rows;
}
