import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDenylist } from './denylist-build.mjs';

test('one entry per name, both separated and joined forms, no plain text', () => {
  const d = buildDenylist(['Demo Client', 'demo partner'], 'k', '2026-10-22');
  assert.equal(d.built, '2026-10-22');
  assert.equal(d.entries.length, 2);
  assert.equal(d.entries[0].length, 2);
  assert.doesNotMatch(JSON.stringify(d), /demo/i);
});

test('the same name in any spelling gives the same hashes', () => {
  const a = buildDenylist(['Demo-Client'], 'k', '2026-10-22').entries[0];
  const b = buildDenylist(['demo client'], 'k', '2026-10-22').entries[0];
  const c = buildDenylist(['DemoClient'], 'k', '2026-10-22').entries[0];
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('a name over three words is refused, because the check cannot match it', () => {
  assert.throws(() => buildDenylist(['demo client of demo'], 'k', '2026-10-22'), /entry 1 has 4 words/);
});

test('an empty key is refused', () => {
  assert.throws(() => buildDenylist(['demo'], '', '2026-10-22'), /key/);
});

test('CLI reads names on stdin, ignores blanks and comments, never echoes a name', () => {
  const cli = fileURLToPath(new URL('./denylist-build.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli], {
    input: '# list\ndemo-client\n\ndemo partner\n',
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_BUNDLE_DENYLIST_KEY: 'k' },
  });
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.entries.length, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /demo/i);
});
