// Usage: node compare-outputs.mts --base=/path/dist/utm.js --candidate=/path/dist/utm.js
//   [--reference=/path/reference.json] [--csv=/path/matrix.csv] [--summary=/path/summary.json]
//   [--json=/path/full-results.json] [--markdown=/path/results.md]
// The default reference is ../test/fixtures/reference.json relative to this script.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const flags = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--(base|candidate|reference|json|markdown|csv|summary)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  flags.set(match[1], match[2]);
}
if (!flags.has('base') || !flags.has('candidate')) {
  throw new Error('Provide --base=/path/dist/utm.js and --candidate=/path/dist/utm.js');
}
const basePath = resolve(flags.get('base'));
const candidatePath = resolve(flags.get('candidate'));
const { utm: baseline } = await import(pathToFileURL(basePath).href);
const { utm: candidate } = await import(pathToFileURL(candidatePath).href);
const referencePath = flags.has('reference')
  ? resolve(flags.get('reference'))
  : new URL('../test/fixtures/reference.json', import.meta.url);
const reference = JSON.parse(await readFile(referencePath, 'utf8'));
const ellipsoids = [
  ['sphere', 0],
  ['WGS84', 1 / 298.257223563],
  ['GRS80', 1 / 298.257222101],
  ['f=0.005', 0.005],
  ['f=0.0099999', 0.0099999],
];
const latitudes = [
  ...Array.from({ length: 181 }, (_, i) => i - 90),
  -89.99999999999999,
  -89.999999999,
  -89.99999,
  -0,
  89.99999,
  89.999999999,
  89.99999999999999,
];
const classify = (n) =>
  Number.isFinite(n)
    ? 'finite'
    : Number.isNaN(n)
      ? 'NaN'
      : n === Infinity
        ? '+Infinity'
        : n === -Infinity
          ? '-Infinity'
          : 'non-number';
const encode = (n) => (Object.is(n, -0) ? '-0' : Number.isFinite(n) ? n : classify(n));
const wrappedDelta = (a, b) => {
  let delta = a - b;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return Math.abs(delta);
};

function metrics(direction) {
  const [first, second] = direction === 'forward' ? ['x', 'y'] : ['lon', 'lat'];
  return {
    points: 0,
    identical: { [first]: 0, [second]: 0, pairs: 0 },
    classificationDiscrepancies: { [first]: 0, [second]: 0, pairs: 0 },
    signedZeroDiscrepancies: { [first]: 0, [second]: 0 },
    commonFinitePairs: 0,
    maxAbsoluteDelta: direction === 'forward' ? { x: 0, y: 0 } : { lon: 0, lonWrapped: 0, lonWeighted: 0, lat: 0 },
  };
}

function compare(m, direction, a, b, latitude) {
  const names = direction === 'forward' ? ['x', 'y'] : ['lon', 'lat'];
  m.points++;
  let identical = true;
  let discrepancy = false;
  for (let i = 0; i < 2; i++) {
    const key = names[i];
    if (Object.is(a[i], b[i])) m.identical[key]++;
    else identical = false;
    if (classify(a[i]) !== classify(b[i])) {
      m.classificationDiscrepancies[key]++;
      discrepancy = true;
    }
    if (a[i] === 0 && b[i] === 0 && !Object.is(a[i], b[i])) m.signedZeroDiscrepancies[key]++;
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      m.maxAbsoluteDelta[key] = Math.max(m.maxAbsoluteDelta[key], Math.abs(a[i] - b[i]));
    }
  }
  if (identical) m.identical.pairs++;
  if (discrepancy) m.classificationDiscrepancies.pairs++;
  if ([...a, ...b].every(Number.isFinite)) m.commonFinitePairs++;
  if (direction === 'inverse' && Number.isFinite(a[0]) && Number.isFinite(b[0])) {
    const delta = wrappedDelta(a[0], b[0]);
    m.maxAbsoluteDelta.lonWrapped = Math.max(m.maxAbsoluteDelta.lonWrapped, delta);
    m.maxAbsoluteDelta.lonWeighted = Math.max(
      m.maxAbsoluteDelta.lonWeighted,
      delta * Math.abs(Math.cos((latitude * Math.PI) / 180)),
    );
  }
}

const matrix = [];
for (const halfWidth of [30, 45]) {
  for (const [ellipsoid, flattening] of ellipsoids) {
    for (const zone of [1, 31, 33, 60]) {
      for (const south of [false, true]) {
        const options = { zone, south, ellipsoid: { a: 6378137, f: flattening } };
        const base = baseline(options);
        const changed = candidate(options);
        const row = {
          halfWidth,
          ellipsoid,
          flattening,
          zone,
          south,
          forward: metrics('forward'),
          inverse: metrics('inverse'),
        };
        for (let deltaLon = -halfWidth; deltaLon <= halfWidth; deltaLon++) {
          for (const lat of latitudes) {
            const lon = zone * 6 - 183 + deltaLon;
            const xy = base.fromLonLatPoint(lon, lat);
            compare(row.forward, 'forward', xy, changed.fromLonLatPoint(lon, lat), lat);
            // Both inverse implementations receive identical baseline-projected inputs.
            compare(row.inverse, 'inverse', base.toLonLatPoint(...xy), changed.toLonLatPoint(...xy), lat);
          }
        }
        matrix.push(row);
      }
    }
  }
}

function referenceAccuracy(utm) {
  const conv = utm({ zone: 31 });
  const max = { xMetres: 0, yMetres: 0, latitudeDegrees: 0, longitudeWeightedDegrees: 0 };
  let nonFinite = 0;
  for (const p of reference.points) {
    const xy = conv.fromLonLatPoint(3 + p.dlon, p.lat);
    const ll = conv.toLonLatPoint(Number(p.x), Number(p.y));
    if (![...xy, ...ll].every(Number.isFinite)) nonFinite++;
    max.xMetres = Math.max(max.xMetres, Math.abs(xy[0] - Number(p.x)));
    max.yMetres = Math.max(max.yMetres, Math.abs(xy[1] - Number(p.y)));
    max.latitudeDegrees = Math.max(max.latitudeDegrees, Math.abs(ll[1] - p.lat));
    max.longitudeWeightedDegrees = Math.max(
      max.longitudeWeightedDegrees,
      wrappedDelta(ll[0], 3 + p.dlon) * Math.abs(Math.cos((p.lat * Math.PI) / 180)),
    );
  }
  return {
    points: reference.points.length,
    max,
    nonFinite,
    pass:
      nonFinite === 0 &&
      max.xMetres < 5e-9 &&
      max.yMetres < 5e-9 &&
      max.latitudeDegrees < 1e-13 &&
      max.longitudeWeightedDegrees < 1e-13,
  };
}

const exceptional = [];
for (const zone of [1, 31, 33, 60]) {
  const base = baseline({ zone });
  const changed = candidate({ zone });
  const meridian = zone * 6 - 183;
  const cases = [
    ...[89.999999, 90, 90.000001, -90, 180, -180, 360, -360].flatMap((d) =>
      [0, 45, 90, -90].map((lat) => ({ direction: 'forward', input: [meridian + d, lat] })),
    ),
    ...[
      [meridian, -0],
      [meridian, NaN],
      [Infinity, 45],
      [-Infinity, 45],
      [NaN, 45],
      [meridian, 91],
      [meridian, -91],
    ].map((input) => ({ direction: 'forward', input })),
    ...[-40000000, -10000000, -0, 0, 10000000, 20000000, 40000000].flatMap((y) =>
      [500000, -10000000, 10000000].map((x) => ({ direction: 'inverse', input: [x, y] })),
    ),
    ...[-0, 166000, 500000, 834000].map((x) => ({ direction: 'inverse', input: [x, -0] })),
    ...[
      [NaN, 0],
      [Infinity, 0],
      [-Infinity, 0],
      [500000, NaN],
      [500000, Infinity],
      [500000, -Infinity],
    ].map((input) => ({ direction: 'inverse', input })),
  ];
  for (const { direction, input } of cases) {
    const method = direction === 'forward' ? 'fromLonLatPoint' : 'toLonLatPoint';
    const a = base[method](...input);
    const b = changed[method](...input);
    exceptional.push({
      zone,
      direction,
      input: input.map(encode),
      baseline: a.map(encode),
      candidate: b.map(encode),
      identical: a.every((v, i) => Object.is(v, b[i])),
      classificationDiscrepancies: a.filter((v, i) => classify(v) !== classify(b[i])).length,
      signedZeroDiscrepancies: a.filter((v, i) => v === 0 && b[i] === 0 && !Object.is(v, b[i])).length,
      absoluteDeltas: a.map((v, i) => (Number.isFinite(v) && Number.isFinite(b[i]) ? Math.abs(v - b[i]) : null)),
    });
  }
}

const rawEquator = [];
for (const [ellipsoid, f] of ellipsoids)
  for (const zone of [1, 31, 33, 60])
    for (const south of [false, true]) {
      const options = { zone, south, ellipsoid: { a: 6378137, f } };
      const base = baseline(options),
        changed = candidate(options);
      for (const x of [166000, 500000, 834000])
        for (const offset of [0, -0]) {
          // Southern false northing is 10,000,000 m: adding either zero sign yields the same representable number.
          const input = [x, south ? 10000000 : offset];
          const a = base.toLonLatPoint(...input),
            b = changed.toLonLatPoint(...input);
          rawEquator.push({
            ellipsoid,
            zone,
            south,
            requestedNorthingOffset: encode(offset),
            input: input.map(encode),
            baseline: a.map(encode),
            candidate: b.map(encode),
            identical: a.every((v, i) => Object.is(v, b[i])),
            classificationDiscrepancies: a.filter((v, i) => classify(v) !== classify(b[i])).length,
            signedZeroDiscrepancies: a.filter((v, i) => v === 0 && b[i] === 0 && !Object.is(v, b[i])).length,
            absoluteDeltas: a.map((v, i) => (Number.isFinite(v) && Number.isFinite(b[i]) ? Math.abs(v - b[i]) : null)),
          });
        }
    }

// These stress cases are outside the geographic grids. Report them separately; they do not
// define the supported-domain success criteria or assert accuracy of either implementation.
const diagnostics = [];
for (const [label, options, input] of [
  ['high-flattening extreme easting', { zone: 33, ellipsoid: { a: 6378137, f: 0.0099999 } }, [100000000, 0]],
  [
    'high-flattening extreme easting/nonzero northing',
    { zone: 33, ellipsoid: { a: 6378137, f: 0.0099999 } },
    [100000000, 1000000],
  ],
  ['sphere extreme easting', { zone: 33, ellipsoid: { a: 6378137, f: 0 } }, [1200000000, 0]],
  ['sphere negative extreme easting', { zone: 33, ellipsoid: { a: 6378137, f: 0 } }, [-1200000000, 0]],
]) {
  const a = baseline(options).toLonLatPoint(...input);
  const b = candidate(options).toLonLatPoint(...input);
  diagnostics.push({
    label,
    options,
    input,
    baseline: a.map(encode),
    candidate: b.map(encode),
    identical: a.every((v, i) => Object.is(v, b[i])),
    classificationDiscrepancies: a.filter((v, i) => classify(v) !== classify(b[i])).length,
    absoluteDeltas: a.map((v, i) => (Number.isFinite(v) && Number.isFinite(b[i]) ? Math.abs(v - b[i]) : null)),
  });
}

const api = { comparisons: 0, mismatches: 0, outputIdentityFailures: 0, examples: [] };
function apiCompare(expected, actual, context) {
  api.comparisons += expected.length;
  for (let i = 0; i < expected.length; i++) {
    if (Object.is(expected[i], actual[i])) continue;
    api.mismatches++;
    if (api.examples.length < 8)
      api.examples.push({
        ...context,
        index: i,
        expected: encode(expected[i]),
        actual: encode(actual[i]),
      });
  }
}
for (const [ellipsoid, f] of ellipsoids)
  for (const zone of [1, 31, 33, 60])
    for (const south of [false, true]) {
      const conv = candidate({ zone, south, ellipsoid: { a: 6378137, f } });
      const samples = [-90, -89.999999999, -80, -45, -0, 0, 45, 84, 89.999999999, 90];
      const geographic = Float64Array.from(
        samples.flatMap((lat, i) => [zone * 6 - 183 + [-30, -3, 0, 3, 30][i % 5], lat]),
      );
      const projected = Float64Array.from(samples.flatMap((lat, i) => conv.fromLonLatPoint(geographic[2 * i], lat)));
      for (const direction of ['forward', 'inverse']) {
        const input = direction === 'forward' ? geographic : projected;
        const method = direction === 'forward' ? 'fromLonLat' : 'toLonLat';
        const pointMethod = `${method}Point`;
        const interleavedMethod = `${method}Interleaved`;
        const first = Float64Array.from(samples, (_, i) => input[2 * i]);
        const second = Float64Array.from(samples, (_, i) => input[2 * i + 1]);
        const expected = samples.flatMap((_, i) => conv[pointMethod](first[i], second[i]));
        const split = conv[method](first, second);
        const values = direction === 'forward' ? [split.x, split.y] : [split.lon, split.lat];
        apiCompare(
          expected,
          samples.flatMap((_, i) => [values[0][i], values[1][i]]),
          { direction, ellipsoid, zone, south, form: 'split' },
        );
        apiCompare(expected, conv[interleavedMethod](input), {
          direction,
          ellipsoid,
          zone,
          south,
          form: 'interleaved',
        });
        const inPlace = input.slice();
        if (conv[interleavedMethod](inPlace, inPlace) !== inPlace) api.outputIdentityFailures++;
        apiCompare(expected, inPlace, {
          direction,
          ellipsoid,
          zone,
          south,
          form: 'interleaved in-place',
        });
        const splitInPlace = conv[method](first, second, first, second);
        const outputs =
          direction === 'forward' ? [splitInPlace.x, splitInPlace.y] : [splitInPlace.lon, splitInPlace.lat];
        if (outputs[0] !== first || outputs[1] !== second) api.outputIdentityFailures++;
        apiCompare(
          expected,
          samples.flatMap((_, i) => [first[i], second[i]]),
          { direction, ellipsoid, zone, south, form: 'split in-place' },
        );
      }
    }

const groups = [];
for (const halfWidth of [30, 45])
  for (const [ellipsoid] of ellipsoids) {
    const rows = matrix.filter((r) => r.halfWidth === halfWidth && r.ellipsoid === ellipsoid);
    const group = {
      halfWidth,
      ellipsoid,
      forward: metrics('forward'),
      inverse: metrics('inverse'),
    };
    for (const row of rows)
      for (const direction of ['forward', 'inverse']) {
        const target = group[direction];
        const source = row[direction];
        target.points += source.points;
        target.commonFinitePairs += source.commonFinitePairs;
        for (const field of ['identical', 'classificationDiscrepancies', 'signedZeroDiscrepancies']) {
          for (const key of Object.keys(target[field])) target[field][key] += source[field][key];
        }
        for (const key of Object.keys(target.maxAbsoluteDelta))
          target.maxAbsoluteDelta[key] = Math.max(target.maxAbsoluteDelta[key], source.maxAbsoluteDelta[key]);
      }
    groups.push(group);
  }
const result = {
  runtime: `${typeof Bun === 'undefined' ? 'Node' : 'Bun'} ${typeof Bun === 'undefined' ? process.version : Bun.version}`,
  baseline: basePath,
  candidate: candidatePath,
  grid: {
    longitudeStepDegrees: 1,
    latitudes: latitudes.map(encode),
    halfWidths: [30, 45],
    zones: [1, 31, 33, 60],
    hemispheres: ['N', 'S'],
    semiMajorAxisMetres: 6378137,
  },
  interpretation:
    'Identity uses Object.is (including NaN and signed zero). Inverse inputs are baseline-projected points. Weighted longitude deltas use the shortest circular difference times abs(cos(original latitude)). ±30 and ±45 grids overlap and are reported separately. These checks do not prove universal identity or accuracy outside the sampled domain.',
  fixture: { baseline: referenceAccuracy(baseline), candidate: referenceAccuracy(candidate) },
  groups,
  matrix,
  exceptional,
  rawEquator,
  diagnostics,
  api,
};
const exceptionalSummary = {
  cases: exceptional.length,
  identicalPairs: exceptional.filter((r) => r.identical).length,
  classificationDiscrepancies: exceptional.reduce((sum, r) => sum + r.classificationDiscrepancies, 0),
  signedZeroDiscrepancies: exceptional.reduce((sum, r) => sum + r.signedZeroDiscrepancies, 0),
  nonidentical: exceptional.filter((r) => !r.identical),
};
const rawEquatorSummary = {
  cases: rawEquator.length,
  identicalPairs: rawEquator.filter((r) => r.identical).length,
  classificationDiscrepancies: rawEquator.reduce((sum, r) => sum + r.classificationDiscrepancies, 0),
  signedZeroDiscrepancies: rawEquator.reduce((sum, r) => sum + r.signedZeroDiscrepancies, 0),
  nonidentical: rawEquator.filter((r) => !r.identical),
  interpretation:
    'North equator uses both +0 and -0 northings. South equator uses 10000000 m, where a distinct negative-zero offset is not representable. West/central/east eastings are checked for every ellipsoid, zone, and hemisphere.',
};
const summary = { ...result, matrix: undefined, exceptional: exceptionalSummary, rawEquator: rawEquatorSummary };
const columns = [
  'halfWidth',
  'ellipsoid',
  'flattening',
  'zone',
  'south',
  'direction',
  'points',
  'firstOrdinate',
  'secondOrdinate',
  'identicalFirst',
  'identicalSecond',
  'identicalPairs',
  'classificationDiscrepanciesFirst',
  'classificationDiscrepanciesSecond',
  'classificationDiscrepanciesPairs',
  'signedZeroDiscrepanciesFirst',
  'signedZeroDiscrepanciesSecond',
  'commonFinitePairs',
  'maxAbsoluteDeltaFirst',
  'maxAbsoluteDeltaSecond',
  'maxLongitudeCircularDelta',
  'maxLongitudeWeightedDelta',
];
const csvCell = (value) => {
  const cell = String(value);
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};
const csv =
  [
    columns.join(','),
    ...matrix.flatMap((row) =>
      ['forward', 'inverse'].map((direction) => {
        const m = row[direction],
          [first, second] = direction === 'forward' ? ['x', 'y'] : ['lon', 'lat'];
        return [
          row.halfWidth,
          row.ellipsoid,
          row.flattening,
          row.zone,
          row.south,
          direction,
          m.points,
          first,
          second,
          m.identical[first],
          m.identical[second],
          m.identical.pairs,
          m.classificationDiscrepancies[first],
          m.classificationDiscrepancies[second],
          m.classificationDiscrepancies.pairs,
          m.signedZeroDiscrepancies[first],
          m.signedZeroDiscrepancies[second],
          m.commonFinitePairs,
          m.maxAbsoluteDelta[first],
          m.maxAbsoluteDelta[second],
          m.maxAbsoluteDelta.lonWrapped ?? '',
          m.maxAbsoluteDelta.lonWeighted ?? '',
        ]
          .map(csvCell)
          .join(',');
      }),
    ),
  ].join('\n') + '\n';
const sci = (n) => n.toExponential(3);
const percent = (m, key) => `${m.identical[key]}/${m.points} (${((100 * m.identical[key]) / m.points).toFixed(2)}%)`;
const markdown = [
  '# Output comparison',
  '',
  `${result.runtime}. Each grid covers all 181 integer latitudes from −90° to 90°, six near-pole latitudes, and an additional signed-zero latitude. Eight zone/hemisphere combinations per row.`,
  '',
  '| Longitude range | Ellipsoid | Points | Forward identical pairs | Inverse identical pairs | Max Δx (m) | Max Δy (m) | Max Δlon (°) | Max weighted Δlon (°) | Max Δlat (°) |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...groups.map(
    (g) =>
      `| ±${g.halfWidth}° | ${g.ellipsoid} | ${g.forward.points} | ${percent(g.forward, 'pairs')} | ${percent(g.inverse, 'pairs')} | ${sci(g.forward.maxAbsoluteDelta.x)} | ${sci(g.forward.maxAbsoluteDelta.y)} | ${sci(g.inverse.maxAbsoluteDelta.lon)} | ${sci(g.inverse.maxAbsoluteDelta.lonWeighted)} | ${sci(g.inverse.maxAbsoluteDelta.lat)} |`,
  ),
  '',
  'The CSV includes separate x/y and lon/lat identity counts, signed-zero differences, classification discrepancies, circular longitude deltas, and every zone/hemisphere row. The summary JSON includes aggregate rows, fixture results, API checks, and every nonidentical exceptional case. Inverse comparisons use identical baseline-projected inputs. Longitude weighting uses the original latitude; unweighted longitude can be ill-conditioned near a pole.',
  '',
  `Grid classification discrepancies: ${matrix.reduce((sum, r) => sum + r.forward.classificationDiscrepancies.pairs + r.inverse.classificationDiscrepancies.pairs, 0)}.`,
  `Exceptional inputs: ${exceptionalSummary.cases} cases; ${exceptionalSummary.identicalPairs} identical pairs; ${exceptionalSummary.classificationDiscrepancies} ordinate classification discrepancies; ${exceptionalSummary.signedZeroDiscrepancies} signed-zero differences.`,
  '',
  'Nonidentical exceptional inputs (signed zeros are preserved as strings):',
  '',
  '| Zone | Direction | Input | Baseline | Candidate | Absolute deltas |',
  '|---:|---|---|---|---|---|',
  ...exceptionalSummary.nonidentical.map(
    (r) =>
      `| ${r.zone} | ${r.direction} | ${JSON.stringify(r.input)} | ${JSON.stringify(r.baseline)} | ${JSON.stringify(r.candidate)} | ${JSON.stringify(r.absoluteDeltas)} |`,
  ),
  '',
  'The near-90° forward cases have enormous finite series outputs outside both grids. The raw equator suite below separately checks both northing zero signs, including ordinary eastings west of the central meridian.',
  `Raw equator inputs: ${rawEquatorSummary.cases} cases; ${rawEquatorSummary.identicalPairs} identical pairs; ${rawEquatorSummary.classificationDiscrepancies} classification differences; ${rawEquatorSummary.signedZeroDiscrepancies} signed-zero differences. Southern equator northing is 10000000 m, where a distinct negative-zero offset is not representable.`,
  '',
  'Out-of-domain diagnostics (reported independently of the success criteria):',
  '',
  '| Case | Input | Baseline | Candidate | Classification differences |',
  '|---|---|---|---|---:|',
  ...diagnostics.map(
    (r) =>
      `| ${r.label} | ${JSON.stringify(r.input)} | ${JSON.stringify(r.baseline)} | ${JSON.stringify(r.candidate)} | ${r.classificationDiscrepancies} |`,
  ),
  '',
  `Candidate API forms: ${api.comparisons} ordinate comparisons; ${api.mismatches} differences; ${api.outputIdentityFailures} output-buffer identity failures.`,
  '',
  `Independent fixture (${result.fixture.candidate.points} points): candidate max Δx ${sci(result.fixture.candidate.max.xMetres)} m, Δy ${sci(result.fixture.candidate.max.yMetres)} m, weighted Δlon ${sci(result.fixture.candidate.max.longitudeWeightedDegrees)}°, Δlat ${sci(result.fixture.candidate.max.latitudeDegrees)}°. Strict 5 nm / 1e-13° thresholds: **${result.fixture.candidate.pass ? 'PASS' : 'FAIL'}**.`,
  '',
  'Object.is identity applies only to these samples. Numerical differences are reported rather than treated as universal bit identity. The ±30° and ±45° grids overlap. The fixture checks independent accuracy; baseline agreement alone does not establish accuracy.',
  '',
].join('\n');
if (flags.has('json')) await writeFile(flags.get('json'), `${JSON.stringify(result, null, 2)}\n`);
if (flags.has('markdown')) await writeFile(flags.get('markdown'), markdown);
if (flags.has('summary')) await writeFile(flags.get('summary'), `${JSON.stringify(summary, null, 2)}\n`);
if (flags.has('csv')) await writeFile(flags.get('csv'), csv);
console.log(markdown);
const classifications =
  matrix.some((r) => r.forward.classificationDiscrepancies.pairs || r.inverse.classificationDiscrepancies.pairs) ||
  [...exceptional, ...rawEquator].some((r) => r.classificationDiscrepancies);
const signedZeros =
  matrix.some((r) =>
    [r.forward, r.inverse].some((m) => Object.values(m.signedZeroDiscrepancies).some((count) => count !== 0)),
  ) || [...exceptional, ...rawEquator].some((r) => r.signedZeroDiscrepancies);
if (!result.fixture.candidate.pass || classifications || signedZeros || api.mismatches || api.outputIdentityFailures)
  process.exitCode = 1;
