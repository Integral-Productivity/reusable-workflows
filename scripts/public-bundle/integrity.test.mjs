import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit, reclassify } from './integrity.mjs';
import { apply, RECEIPT } from './publish.mjs';
import { plugin, tree, SKILL } from './test-fixtures.mjs';

const META = {
  sourceRepo: 'Integral-Productivity/demo-claude-plugin',
  tag: 'v1.0.0',
  commit: 'a'.repeat(40),
  tagTime: '2026-10-22T10:00:00Z',
  checkVersion: 'b'.repeat(40),
};

const GITHUB_ENTRY = { name: 'demo-third-party', source: { source: 'github', repo: 'demo/demo-third-party' } };

const catalog = (plugins = []) =>
  tree({
    '.claude-plugin/marketplace.json': `${JSON.stringify({ name: 'demo-catalog', owner: { name: 'Demo' }, plugins }, null, 2)}\n`,
  });

const manifest = (name, version = '1.0.0') => JSON.stringify({ name, description: 'Demo plugin.', version });

// A catalog with two published plugins, as publish.mjs leaves it.
function published() {
  const cat = catalog();
  assert.equal(apply(cat, plugin(), META).ok, true);
  const two = plugin({ '.claude-plugin/plugin.json': manifest('demo-two') });
  assert.equal(apply(cat, two, { ...META, sourceRepo: 'Integral-Productivity/demo-two-claude-plugin' }).ok, true);
  return cat;
}

const rules = (r) => r.errors.map((e) => `${e.plugin ?? '-'}:${e.rule}`).sort();
const editReceipt = (cat, name, change) => {
  const path = join(cat, 'plugins', name, RECEIPT);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...change }));
};

test('a clean catalog with two plugins passes', () => {
  const r = audit(published());
  assert.deepEqual(r, { ok: true, errors: [], warnings: [], checked: ['demo', 'demo-two'] });
});

test('an entry with a failed receipt fails (AE5)', () => {
  const cat = published();
  editReceipt(cat, 'demo', { checkResult: 'held' });
  assert.deepEqual(rules(audit(cat)), ['demo:receipt-failed']);
});

test('a skill edited by hand with the receipt unchanged fails on the digest', () => {
  const cat = published();
  writeFileSync(join(cat, 'plugins/demo/skills/demo/SKILL.md'), SKILL('Edited by hand.'));
  assert.deepEqual(rules(audit(cat)), ['demo:digest-mismatch']);
});

test('a folder with no catalog entry fails', () => {
  const cat = published();
  const path = join(cat, '.claude-plugin/marketplace.json');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  m.plugins = m.plugins.filter((e) => e.name !== 'demo-two');
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  assert.deepEqual(rules(audit(cat)), ['-:catalog-stale']);
});

test('an entry whose folder is gone fails', () => {
  const cat = published();
  rmSync(join(cat, 'plugins/demo-two'), { recursive: true });
  assert.deepEqual(rules(audit(cat)), ['-:catalog-stale']);
});

test('a receipt for 1.4.0 next to a plugin.json at 1.5.0 fails', () => {
  const cat = published();
  editReceipt(cat, 'demo', { version: '1.4.0' });
  const r = audit(cat);
  assert.deepEqual(rules(r), ['demo:receipt-version']);
  assert.equal(r.errors[0].detail, 'receipt 1.4.0, plugin.json 1.0.0');
});

test('a missing receipt fails', () => {
  const cat = published();
  rmSync(join(cat, 'plugins/demo', RECEIPT));
  assert.deepEqual(rules(audit(cat)), ['demo:receipt-missing']);
});

test('a receipt that is not JSON, or lacks a field, fails', () => {
  const cat = published();
  writeFileSync(join(cat, 'plugins/demo', RECEIPT), 'not json');
  editReceipt(cat, 'demo-two', { sourceRepo: '' });
  assert.deepEqual(rules(audit(cat)), ['demo-two:receipt-incomplete', 'demo:receipt-unreadable']);
});

test('a folder catalog.mjs cannot read fails as catalog-invalid, not with a stack trace', () => {
  const cat = published();
  writeFileSync(join(cat, 'plugins/demo/.claude-plugin/plugin.json'), manifest('other-name'));
  const r = audit(cat);
  assert.deepEqual(rules(r), ['-:catalog-invalid']);
  assert.match(r.errors[0].detail, /does not match its folder/);
});

test('an entry with another source only warns, and names its source', () => {
  const cat = catalog([GITHUB_ENTRY]);
  assert.equal(apply(cat, plugin(), META).ok, true);
  const r = audit(cat);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [{ plugin: 'demo-third-party', rule: 'other-source', detail: 'github demo/demo-third-party; no receipt to check' }]);
});

test('the report never holds file contents', () => {
  const cat = published();
  writeFileSync(join(cat, 'plugins/demo/skills/demo/SKILL.md'), SKILL('secret-looking-body'));
  assert.doesNotMatch(JSON.stringify(audit(cat)), /secret-looking-body/);
});

const PUBLIC_LABS = 'classification: public\nowner: demo\nreviewed: 2026-10-01\ncatalog: labs\n';

test('reclassify keeps folders whose source is still public in this catalog', () => {
  const cat = published();
  const r = reclassify(cat, 'labs', () => PUBLIC_LABS);
  assert.deepEqual(r, { remove: [], unreadable: [] });
});

test('reclassify removes a folder whose source is now private, or moved catalog', () => {
  const cat = published();
  const read = (repo) => (repo.endsWith('/demo-claude-plugin') ? 'classification: private\n' : PUBLIC_LABS.replace('labs', 'core'));
  assert.deepEqual(reclassify(cat, 'labs', read), {
    remove: [
      { plugin: 'demo', sourceRepo: META.sourceRepo, reason: 'declared-private' },
      { plugin: 'demo-two', sourceRepo: 'Integral-Productivity/demo-two-claude-plugin', reason: 'catalog-core' },
    ],
    unreadable: [],
  });
});

test('reclassify removes when the file is gone, but never on a read failure', () => {
  const cat = published();
  const read = (repo) => (repo.endsWith('/demo-claude-plugin') ? undefined : null);
  assert.deepEqual(reclassify(cat, 'labs', read), {
    remove: [{ plugin: 'demo', sourceRepo: META.sourceRepo, reason: 'missing' }],
    unreadable: [{ plugin: 'demo-two', sourceRepo: 'Integral-Productivity/demo-two-claude-plugin' }],
  });
});
