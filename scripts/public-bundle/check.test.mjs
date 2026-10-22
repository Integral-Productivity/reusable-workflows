import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from './check.mjs';
import { buildDenylist } from './denylist-build.mjs';
import { tree, SKILL, tmp } from './test-fixtures.mjs';

const KEY = 'test-key-not-a-secret';
const NOW = new Date('2026-10-22T12:00:00Z');
const denylist = (built = '2026-10-20', names = ['demo-client']) => JSON.stringify(buildDenylist(names, KEY, built));
const opts = (o = {}) => ({ denylist: denylist(), key: KEY, now: NOW, ...o });
const clean = (extra = {}) => tree({ 'skills/demo/SKILL.md': SKILL(), 'README.md': '# demo\n', ...extra });
const layers = (r) => r.findings.map((f) => f.layer);

test('a clean copy passes', () => {
  const r = check(clean(), opts());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.findings, []);
});

test('"Demo Client" in a skill fails with denylist entry #1, without the name (AE3)', () => {
  const r = check(clean({ 'skills/demo/SKILL.md': SKILL('Prepared for Demo Client last week.') }), opts());
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings, [{ file: 'skills/demo/SKILL.md', line: 8, layer: 'L3', detail: 'denylist entry #1' }]);
  assert.doesNotMatch(JSON.stringify(r), /demo client|prepared for/i);
});

test('demoClient inside a URL path fails on L3', () => {
  const r = check(clean({ 'README.md': 'See https://example.com/accounts/demoClient/notes\n' }), opts());
  assert.deepEqual(layers(r), ['L3']);
});

test('a joined form (democlient) fails on L3', () => {
  assert.deepEqual(layers(check(clean({ 'README.md': 'democlient\n' }), opts())), ['L3']);
});

test('a skill directory named demo-client-renewal fails on L3 by path', () => {
  const r = check(clean({ 'skills/demo-client-renewal/SKILL.md': SKILL() }), opts());
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings, [{ file: 'skills/demo-client-renewal/SKILL.md', line: 0, layer: 'L3', detail: 'denylist entry #1 (in path)' }]);
});

test('the denylist entry number follows the list order', () => {
  const r = check(clean({ 'README.md': 'demo partner\n' }), opts({ denylist: denylist('2026-10-20', ['demo-client', 'demo partner']) }));
  assert.equal(r.findings[0].detail, 'denylist entry #2');
});

test('denylist key unset fails input-unavailable (AE4)', () => {
  const r = check(clean(), opts({ key: '' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'input-unavailable');
});

test('denylist unset or unparseable fails input-unavailable', () => {
  assert.equal(check(clean(), opts({ denylist: undefined })).reason, 'input-unavailable');
  assert.equal(check(clean(), opts({ denylist: '{not json' })).reason, 'input-unavailable');
  assert.equal(check(clean(), opts({ denylist: '{"built":"2026-10-20"}' })).reason, 'input-unavailable');
});

test('a denylist built 31 days ago fails denylist-stale', () => {
  assert.equal(check(clean(), opts({ denylist: denylist('2026-09-21') })).reason, 'denylist-stale');
  assert.equal(check(clean(), opts({ denylist: denylist('2026-09-22') })).ok, true);
});

test('a connector-ID tool name in allowed-tools fails on L4 (AE6)', () => {
  const r = check(clean({ 'skills/demo/SKILL.md': SKILL('Body.', 'allowed-tools: mcp__00000000-0000-0000-0000-000000000000__get_entities\n') }), opts());
  assert.deepEqual(r.findings, [{ file: 'skills/demo/SKILL.md', line: 4, layer: 'L4', detail: 'claude.ai connector ID in a tool name' }]);
});

test('a Google Docs link fails on L4 (F2)', () => {
  const r = check(clean({ 'README.md': 'Spec: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit\n' }), opts());
  assert.deepEqual(layers(r), ['L4']);
});

test('other internal locators fail on L4', () => {
  for (const text of [
    'https://drive.google.com/drive/folders/0AbCdEfGhIjK',
    'https://app.hubspot.com/contacts/12345678/record/0-1/987',
    'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
    'https://vercel.com/demo-team/demo-project/settings',
    'cat /Users/demo/Documents/notes.md',
    'cat /home/demo/notes.md',
    'C:\\Users\\demo\\notes.md',
  ]) {
    assert.deepEqual(layers(check(clean({ 'README.md': `${text}\n` }), opts())), ['L4'], text);
  }
});

test('placeholder paths do not fail L4', () => {
  assert.equal(check(clean({ 'README.md': 'cp x /Users/<you>/y and ~/notes and /home/runner/work\n' }), opts()).ok, true);
});

test('a synthetic AWS-style key fails on L1 and never appears in the result', () => {
  const key = ['AKIA', 'Z7Q3', 'X2M9', 'P4L8', 'K6N5'].join('');
  const r = check(clean({ 'README.md': `aws_access_key_id = ${key}\n` }), opts());
  assert.deepEqual(layers(r), ['L1']);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(key));
});

test('a private key header fails on L1', () => {
  const header = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
  assert.deepEqual(layers(check(clean({ 'hooks/k.pem': `${header}\nabc\n` }), opts())), ['L1']);
});

test('a personal email fails on L2; example and role addresses pass', () => {
  assert.deepEqual(layers(check(clean({ 'README.md': 'Ask demo.person@gmail.com\n' }), opts())), ['L2']);
  assert.equal(
    check(clean({ 'README.md': 'demo@example.com opensource@integralproductivity.com 3432367+demo@users.noreply.github.com x@demo.invalid\n' }), opts()).ok,
    true,
  );
});

test('a phone number fails on L2; versions and dates pass', () => {
  assert.deepEqual(layers(check(clean({ 'README.md': 'Call (415) 555-0134 today\n' }), opts())), ['L2']);
  assert.deepEqual(layers(check(clean({ 'README.md': 'Call +44 20 7946 0958\n' }), opts())), ['L2']);
  assert.equal(check(clean({ 'README.md': 'v1.2.3 on 2026-10-22, build 20261022.1234\n' }), opts()).ok, true);
});

test('a confidential marker fails on L5', () => {
  assert.deepEqual(layers(check(clean({ 'README.md': 'CONFIDENTIAL: do not share\n' }), opts())), ['L5']);
  assert.deepEqual(layers(check(clean({ 'README.md': 'Internal only.\n' }), opts())), ['L5']);
});

test('an unreadable copy directory fails input-unavailable', () => {
  assert.equal(check(join(tmp(), 'nope'), opts()).reason, 'input-unavailable');
});

function fakeGitleaks(behaviour) {
  const dir = tmp('fake-gitleaks-');
  const bin = join(dir, 'gitleaks');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const report = args[args.indexOf('--report-path') + 1];
if (!args.includes('--redact')) process.exit(9);
const b = ${JSON.stringify(behaviour)};
if (b === 'crash') process.exit(3);
require('fs').writeFileSync(report, b === 'finding'
  ? JSON.stringify([{ RuleID: 'generic-api-key', File: args[args.indexOf('dir') + 1] + '/README.md', StartLine: 1, Secret: 'REDACTED', Match: 'REDACTED' }])
  : '[]');
console.log('leaked-value-should-not-be-streamed');
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

test('gitleaks findings become L1 findings by file, line and rule', () => {
  const r = check(clean(), opts({ gitleaks: fakeGitleaks('finding') }));
  assert.deepEqual(r.findings, [{ file: 'README.md', line: 1, layer: 'L1', detail: 'gitleaks rule generic-api-key' }]);
  assert.doesNotMatch(JSON.stringify(r), /leaked-value/);
});

test('gitleaks that cannot run fails input-unavailable', () => {
  assert.equal(check(clean(), opts({ gitleaks: fakeGitleaks('crash') })).reason, 'input-unavailable');
  assert.equal(check(clean(), opts({ gitleaks: '/nonexistent/gitleaks' })).reason, 'input-unavailable');
  assert.equal(check(clean(), opts({ gitleaks: fakeGitleaks('clean') })).ok, true);
});

test('CLI reads secrets from env, prints the report and exits 1 on findings', () => {
  const cli = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const dir = clean({ 'README.md': 'Prepared for Demo Client\n' });
  const env = { ...process.env, PUBLIC_BUNDLE_DENYLIST: denylist(new Date().toISOString().slice(0, 10)), PUBLIC_BUNDLE_DENYLIST_KEY: KEY };
  const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', env });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /README\.md:1 L3 denylist entry #1/);
  assert.doesNotMatch(r.stdout + r.stderr, /Demo Client/);
  const missing = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', env: { ...env, PUBLIC_BUNDLE_DENYLIST_KEY: '' } });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /input-unavailable/);
});
