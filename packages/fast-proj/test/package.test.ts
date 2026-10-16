import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const smoke = fileURLToPath(new URL('./smoke.mts', import.meta.url));
const built = existsSync(fileURLToPath(new URL('../dist/index.js', import.meta.url)));

it.skipIf(!built)('built package imports through its exports', () => {
  expect(execFileSync(process.execPath, [smoke], { encoding: 'utf8' })).toContain('smoke ok');
});
