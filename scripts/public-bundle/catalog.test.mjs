import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate, isFolderEntry, stale, write } from './catalog.mjs';
import { tree } from './test-fixtures.mjs';

const manifest = (name, version = '1.0.0', extra = {}) => JSON.stringify({ name, version, description: `${name} plugin.`, ...extra });
const catalog = (plugins = [], files = {}) =>
  tree({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'demo-catalog', owner: { name: 'Demo' }, plugins }),
    ...files,
  });

test('two folders produce two sorted entries with relative sources and versions', () => {
  const dir = catalog([], {
    'plugins/zeta/.claude-plugin/plugin.json': manifest('zeta', '2.1.0'),
    'plugins/alpha/.claude-plugin/plugin.json': manifest('alpha'),
  });
  const m = generate(dir);
  assert.deepEqual(m.plugins, [
    { name: 'alpha', source: './plugins/alpha', description: 'alpha plugin.', version: '1.0.0' },
    { name: 'zeta', source: './plugins/zeta', description: 'zeta plugin.', version: '2.1.0' },
  ]);
  assert.equal(m.name, 'demo-catalog');
  assert.deepEqual(m.owner, { name: 'Demo' });
});

test('entries that are not folder entries are kept, in their order, before the folders', () => {
  const kept = [
    { name: 'other', source: { source: 'github', repo: 'demo/other', ref: 'stable' }, description: 'x' },
    { name: 'third', source: { source: 'github', repo: 'demo/third', ref: 'v1.0.0' } },
  ];
  const dir = catalog([...kept, { name: 'gone', source: './plugins/gone', version: '0.1.0' }], {
    'plugins/demo/.claude-plugin/plugin.json': manifest('demo'),
  });
  const m = generate(dir);
  assert.deepEqual(m.plugins.slice(0, 2), kept);
  assert.deepEqual(m.plugins.map((p) => p.name), ['other', 'third', 'demo']);
});

test('a folder entry whose folder is gone is dropped', () => {
  const dir = catalog([{ name: 'gone', source: './plugins/gone', version: '0.1.0' }]);
  assert.deepEqual(generate(dir).plugins, []);
});

test('a folder missing plugin.json throws', () => {
  const dir = catalog([], { 'plugins/demo/skills/demo/SKILL.md': 'x' });
  assert.throws(() => generate(dir), /plugins\/demo: \.claude-plugin\/plugin\.json is missing/);
});

test('an unreadable plugin.json throws', () => {
  const dir = catalog([], { 'plugins/demo/.claude-plugin/plugin.json': '{not json' });
  assert.throws(() => generate(dir), /plugins\/demo: \.claude-plugin\/plugin\.json is not valid JSON/);
});

test('a plugin.json whose name differs from its folder throws', () => {
  const dir = catalog([], { 'plugins/demo/.claude-plugin/plugin.json': manifest('other') });
  assert.throws(() => generate(dir), /name "other" does not match its folder/);
});

test('a plugin.json without a version throws', () => {
  const dir = catalog([], { 'plugins/demo/.claude-plugin/plugin.json': JSON.stringify({ name: 'demo' }) });
  assert.throws(() => generate(dir), /plugins\/demo: version is missing/);
});

test('a folder whose name is already a non-folder entry throws', () => {
  const dir = catalog([{ name: 'demo', source: { source: 'github', repo: 'demo/demo', ref: 'stable' } }], {
    'plugins/demo/.claude-plugin/plugin.json': manifest('demo'),
  });
  assert.throws(() => generate(dir), /"demo" is already listed with another source/);
});

test('a file directly under plugins/ is not a plugin and throws', () => {
  const dir = catalog([], { 'plugins/README.md': 'x' });
  assert.throws(() => generate(dir), /plugins\/README\.md is not a folder/);
});

test('isFolderEntry accepts only ./plugins/<name> string sources', () => {
  assert.equal(isFolderEntry({ source: './plugins/demo' }), true);
  assert.equal(isFolderEntry({ source: './elsewhere/demo' }), false);
  assert.equal(isFolderEntry({ source: { source: 'github' } }), false);
});

test('write then stale: a written catalog is current, an edited one is stale', () => {
  const dir = catalog([], { 'plugins/demo/.claude-plugin/plugin.json': manifest('demo') });
  assert.equal(stale(dir), true);
  write(dir);
  assert.equal(stale(dir), false);
  const text = readFileSync(join(dir, '.claude-plugin/marketplace.json'), 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.match(text, /\n {2}"plugins"/);
});
