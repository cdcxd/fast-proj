// Imports the built package through its `exports` (package self-reference). Run after `bun run build`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { latLngs, lineString } from '@fast-proj/utm/geojson';
import { GRS80, WGS84, centralMeridian, utm, utmFor, zoneFor } from '@fast-proj/utm';

const pkg = createRequire(import.meta.url)('@fast-proj/utm/package.json');
assert.equal(pkg.name, '@fast-proj/utm');
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
assert.equal(lineString(conv, [500000, 0]).type, 'LineString');
assert.ok(Math.abs(latLngs(conv, [500000, 0])[0][1] - 15) < 1e-12);
console.log(`smoke ok (Node ${process.version})`);
