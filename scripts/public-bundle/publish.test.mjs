import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, digest, foldersFromSource, RECEIPT, remove } from './publish.mjs';
import { plugin, tree, SKILL } from './test-fixtures.mjs';

const META = {
  sourceRepo: 'Integral-Productivity/demo-claude-plugin',
  tag: 'v1.0.0',
  commit: 'a'.repeat(40),
  tagTime: '2026-10-22T10:00:00Z',
  checkVersion: 'b'.repeat(40),
};

const catalog = (plugins = [], files = {}) =>
  tree({
    '.claude-plugin/marketplace.json': `${JSON.stringify({ name: 'demo-catalog', owner: { name: 'Demo' }, plugins }, null, 2)}\n`,
    'README.md': '# catalog\n',
    ...files,
  });

const read = (dir, p) => readFileSync(join(dir, p), 'utf8');
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

test('digest changes when any file changes, and ignores the receipt', () => {
  const copy = plugin();
  const before = digest(copy);
  writeFileSync(join(copy, RECEIPT), '{"anything":true}');
  assert.equal(digest(copy), before);
  writeFileSync(join(copy, 'skills/demo/SKILL.md'), SKILL('Changed body.'));
  assert.notEqual(digest(copy), before);
  assert.match(before, /^sha256:[0-9a-f]{64}$/);
});

test('digest depends on paths, not only bytes', () => {
  const a = tree({ 'x/a.md': 'same' });
  const b = tree({ 'x/b.md': 'same' });
  assert.notEqual(digest(a), digest(b));
});

test('first publish copies the folder, writes the receipt and the entry', () => {
  const cat = catalog();
  const copy = plugin();
  const r = apply(cat, copy, META);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.name, 'demo');
  assert.equal(r.version, '1.0.0');
  assert.equal(r.firstPublish, true);
  assert.equal(read(cat, 'plugins/demo/skills/demo/SKILL.md'), read(copy, 'skills/demo/SKILL.md'));
  const receipt = JSON.parse(read(cat, `plugins/demo/${RECEIPT}`));
  assert.deepEqual(receipt, {
    sourceRepo: META.sourceRepo,
    version: '1.0.0',
    commit: META.commit,
    tagTime: META.tagTime,
    checkVersion: META.checkVersion,
    checkResult: 'pass',
    digest: digest(join(cat, 'plugins/demo')),
  });
  const entries = JSON.parse(read(cat, '.claude-plugin/marketplace.json')).plugins;
  assert.deepEqual(entries, [{ name: 'demo', source: './plugins/demo', description: 'Demo plugin.', version: '1.0.0' }]);
});

test('the receipt holds no finding text and no file contents', () => {
  const cat = catalog();
  apply(cat, plugin(), META);
  const text = read(cat, `plugins/demo/${RECEIPT}`);
  assert.doesNotMatch(text, /Demo skill|findings|detail/);
});

test('a later version replaces the folder, so a file removed upstream is gone', () => {
  const cat = catalog();
  apply(cat, plugin({ 'skills/old/SKILL.md': SKILL() }), META);
  const r = apply(cat, plugin({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', description: 'Demo plugin.', version: '1.1.0' }) }), { ...META, tag: 'v1.1.0' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.firstPublish, false);
  assert.equal(existsSync(join(cat, 'plugins/demo/skills/old')), false);
  assert.equal(JSON.parse(read(cat, '.claude-plugin/marketplace.json')).plugins[0].version, '1.1.0');
});

test('a tag that does not match the copy version fails, and nothing changes', () => {
  const cat = catalog();
  const r = apply(cat, plugin(), { ...META, tag: 'v2.0.0' });
  assert.deepEqual(r, { ok: false, reason: 'version-mismatch', detail: 'tag v2.0.0, plugin.json 1.0.0' });
  assert.equal(existsSync(join(cat, 'plugins')), false);
});

test('a plugin name that is not a safe folder name fails', () => {
  const cat = catalog();
  const copy = plugin({ '.claude-plugin/plugin.json': JSON.stringify({ name: '../escape', version: '1.0.0' }) });
  assert.equal(apply(cat, copy, META).reason, 'name-invalid');
  assert.equal(existsSync(join(cat, 'plugins')), false);
});

test('a copy whose name is already a non-folder entry fails and leaves the catalog as it was', () => {
  const kept = [{ name: 'demo', source: { source: 'github', repo: 'demo/demo', ref: 'stable' } }];
  const cat = catalog(kept);
  const before = read(cat, '.claude-plugin/marketplace.json');
  const r = apply(cat, plugin(), META);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'catalog-invalid');
  assert.match(r.detail, /already listed with another source/);
  assert.equal(read(cat, '.claude-plugin/marketplace.json'), before);
  assert.equal(existsSync(join(cat, 'plugins/demo')), false);
});

test('missing receipt metadata fails before anything is written', () => {
  const cat = catalog();
  const r = apply(cat, plugin(), { ...META, commit: '' });
  assert.deepEqual(r, { ok: false, reason: 'metadata-missing', detail: 'commit' });
  assert.equal(existsSync(join(cat, 'plugins')), false);
});

test('only plugins/<name>/ and marketplace.json change in a git checkout', () => {
  const cat = catalog([{ name: 'other', source: { source: 'github', repo: 'demo/other', ref: 'stable' } }]);
  git(cat, 'init', '-q');
  git(cat, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qam', 'init', '--allow-empty');
  git(cat, 'add', '-A');
  git(cat, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base');
  assert.equal(apply(cat, plugin(), META).ok, true);
  git(cat, 'add', '-A');
  const changed = git(cat, 'diff', '--cached', '--name-only').stdout.trim().split('\n');
  assert.ok(changed.every((p) => p === '.claude-plugin/marketplace.json' || p.startsWith('plugins/demo/')), changed.join(','));
  assert.ok(changed.includes('.claude-plugin/marketplace.json'));
});

test('removal deletes the folder and the entry, and keeps other entries', () => {
  const kept = { name: 'other', source: { source: 'github', repo: 'demo/other', ref: 'stable' } };
  const cat = catalog([kept]);
  apply(cat, plugin(), META);
  const r = remove(cat, 'demo');
  assert.deepEqual(r, { ok: true, name: 'demo', removed: true });
  assert.equal(existsSync(join(cat, 'plugins/demo')), false);
  assert.deepEqual(JSON.parse(read(cat, '.claude-plugin/marketplace.json')).plugins, [kept]);
});

test('removal of an absent folder changes nothing', () => {
  const cat = catalog();
  const before = read(cat, '.claude-plugin/marketplace.json');
  assert.deepEqual(remove(cat, 'demo'), { ok: true, name: 'demo', removed: false });
  assert.equal(read(cat, '.claude-plugin/marketplace.json'), before);
});

test('foldersFromSource finds folders by the source repo in their receipt', () => {
  const cat = catalog();
  apply(cat, plugin(), META);
  const otherCopy = plugin({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo-two', description: 'x', version: '1.0.0' }) });
  apply(cat, otherCopy, { ...META, sourceRepo: 'Integral-Productivity/other-claude-plugin' });
  assert.deepEqual(foldersFromSource(cat, 'Integral-Productivity/demo-claude-plugin'), ['demo']);
  assert.deepEqual(foldersFromSource(cat, 'integral-productivity/OTHER-claude-plugin'), ['demo-two']);
  assert.deepEqual(foldersFromSource(catalog(), 'Integral-Productivity/demo-claude-plugin'), []);
});
