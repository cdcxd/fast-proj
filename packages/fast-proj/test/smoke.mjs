// Imports the built package through its `exports` (package self-reference). Run after `bun run build`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { GRS80, WGS84, centralMeridian, gcj02, tmerc, utm, utmFor, zoneFor } from 'fast-proj';
import { latLngs, lineString } from 'fast-proj/geojson';
import { loadWasm } from 'fast-proj/wasm';

const pkg = createRequire(import.meta.url)('fast-proj/package.json');
assert.equal(pkg.name, 'fast-proj');
assert.equal(typeof GRS80.a, 'number');
assert.equal(Object.isFrozen(WGS84), true);
assert.equal(centralMeridian(33), 15);
assert.equal(zoneFor(15, 52), 33);
assert.deepEqual(utmFor(15, -1), { zone: 33, south: true });
const conv = utm({ zone: 33 });
const [x, y] = conv.fromLonLatPoint(15, 0);
assert.ok(Math.abs(x - 500000) < 1e-6 && Math.abs(y) < 1e-6);
const [lon, lat] = conv.toLonLatPoint(500000, 5761038.212590415);
assert.ok(Math.abs(lon - 15) < 1e-12 && Math.abs(lat - 52) < 1e-9);
assert.equal(tmerc({ lon0: 117, falseEasting: 500000 }).fromLonLatPoint(117, 0)[0], 500000);
const buf = conv.toLonLatInterleaved([500000, 0]);
assert.equal(lineString(buf).type, 'LineString');
assert.ok(Math.abs(latLngs(buf)[0][1] - 15) < 1e-12);
const [gl, gp] = gcj02().toWgs84Point(...gcj02().fromWgs84Point(116.391, 39.907));
assert.ok(Math.abs(gl - 116.391) < 1e-10 && Math.abs(gp - 39.907) < 1e-10);

const ctx = await loadWasm();
assert.match(ctx.backend, /^wasm/);
const [wl] = ctx.utm({ zone: 33 }).toLonLatPoint(500000, 5761038.212590415);
assert.ok(Math.abs(wl - 15) < 1e-12);
ctx.dispose();
console.log(`smoke ok (Node ${process.version}, ${ctx.backend})`);
