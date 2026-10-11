export function runCases(proj4, utm, { n = 10000, runs = 31, reps = 5 } = {}) {
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
  const conv = utm({ zone: 33 });

  const cases = [
    [
      'UTM → WGS84',
      'proj4 converter.forward',
      () => {
        for (let i = 0; i < n; i++) inv.forward([xs[i], ys[i]]);
      },
    ],
    [
      'UTM → WGS84',
      'toLonLatPoint',
      () => {
        for (let i = 0; i < n; i++) conv.toLonLatPoint(xs[i], ys[i]);
      },
    ],
    ['UTM → WGS84', 'toLonLat (output buffers)', () => conv.toLonLat(xs, ys, a, b)],
    ['UTM → WGS84', 'toLonLatInterleaved (output buffer)', () => conv.toLonLatInterleaved(xy, out)],
    [
      'WGS84 → UTM',
      'proj4 converter.inverse',
      () => {
        for (let i = 0; i < n; i++) inv.inverse([lonIn[i], latIn[i]]);
      },
    ],
    ['WGS84 → UTM', 'fromLonLat (output buffers)', () => conv.fromLonLat(lonIn, latIn, a, b)],
  ];

  return cases.map(([direction, method, fn]) => {
    for (let i = 0; i < 10; i++) fn();
    const t = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      for (let r = 0; r < reps; r++) fn();
      t.push((performance.now() - s) / reps);
    }
    t.sort((x, y) => x - y);
    return { direction, method, ms: t[runs >> 1] };
  });
}
