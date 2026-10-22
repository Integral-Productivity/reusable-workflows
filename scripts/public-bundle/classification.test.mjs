import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, evaluate, parse } from './classification.mjs';

const file = ({
  classification = 'public',
  owner = 'Product Engineering',
  reviewed = '2026-10-22',
  catalog = 'labs',
  extra = '',
} = {}) =>
  [
    '# Distribution classification (read by reusable-public-bundle.yml)',
    classification === null ? '' : `classification: ${classification}`,
    owner === null ? '' : `owner: ${owner}`,
    reviewed === null ? '' : `reviewed: ${reviewed}`,
    catalog === null ? '' : `catalog: ${catalog}`,
    extra,
  ].join('\n');

test('both trees public with all keys: public, with the named catalog', () => {
  const r = classify({ atTag: file(), atHead: file({ catalog: 'labs' }) });
  assert.equal(r.classification, 'public');
  assert.equal(r.catalog, 'labs');
  assert.equal(r.owner, 'Product Engineering');
  assert.equal(r.reviewed, '2026-10-22');
  assert.deepEqual(r.include, []);
});

test('core catalog is accepted', () => {
  assert.equal(classify({ atTag: file({ catalog: 'core' }), atHead: file({ catalog: 'core' }) }).catalog, 'core');
});

test('missing file: private, reason missing (AE2)', () => {
  assert.deepEqual(
    { c: classify({ atTag: null, atHead: null }).classification, r: classify({ atTag: null, atHead: null }).reason },
    { c: 'private', r: 'missing' },
  );
});

test('public without reviewed: private, reason incomplete', () => {
  const r = classify({ atTag: file({ reviewed: null }), atHead: file() });
  assert.equal(r.classification, 'private');
  assert.equal(r.reason, 'incomplete');
});

test('public without owner or catalog: incomplete', () => {
  assert.equal(evaluate(file({ owner: null })).reason, 'incomplete');
  assert.equal(evaluate(file({ catalog: null })).reason, 'incomplete');
});

test('unparseable YAML: private, reason unreadable', () => {
  const r = classify({ atTag: 'classification: [public\n  owner', atHead: file() });
  assert.equal(r.classification, 'private');
  assert.equal(r.reason, 'unreadable');
});

test('tag tree public, default branch private: private, reason reclassified', () => {
  const r = classify({ atTag: file(), atHead: file({ classification: 'private' }) });
  assert.equal(r.classification, 'private');
  assert.equal(r.reason, 'reclassified');
});

test('tag tree public, default branch file deleted: reclassified', () => {
  assert.equal(classify({ atTag: file(), atHead: null }).reason, 'reclassified');
});

test('tag tree private, default branch public: private, reason from the tag tree', () => {
  const r = classify({ atTag: file({ classification: 'private' }), atHead: file() });
  assert.equal(r.classification, 'private');
  assert.equal(r.reason, 'declared-private');
});

test('declared private needs no other keys', () => {
  const r = evaluate('classification: private\n');
  assert.equal(r.classification, 'private');
  assert.equal(r.reason, 'declared-private');
});

test('values outside the vocabulary: invalid', () => {
  assert.equal(evaluate(file({ classification: 'Public' })).reason, 'invalid');
  assert.equal(evaluate(file({ catalog: 'internal' })).reason, 'invalid');
  assert.equal(evaluate(file({ reviewed: '22/10/2026' })).reason, 'invalid');
  assert.equal(evaluate(file({ reviewed: '2026-02-30' })).reason, 'invalid');
});

test('unknown key: invalid, so a typo cannot pass silently', () => {
  assert.equal(evaluate(file({ extra: 'catlog: core' })).reason, 'invalid');
});

test('duplicate key: unreadable', () => {
  assert.equal(evaluate(file({ extra: 'classification: public' })).reason, 'unreadable');
});

test('include list is read', () => {
  const r = evaluate(file({ extra: 'include:\n  - lib/\n  - "scripts/tool.sh"' }));
  assert.equal(r.classification, 'public');
  assert.deepEqual(r.include, ['lib/', 'scripts/tool.sh']);
});

test('include entries that escape the copy or name .github: invalid', () => {
  for (const bad of ['../secret', '/etc/passwd', '.github/', 'lib/../../x', '.git/config', '']) {
    const r = evaluate(file({ extra: `include:\n  - "${bad}"` }));
    assert.equal(r.reason, 'invalid', bad);
  }
});

test('quoted values and trailing comments are read', () => {
  const r = evaluate(file({ owner: '"Product Engineering"  # role name', reviewed: "'2026-10-22'" }));
  assert.equal(r.classification, 'public');
  assert.equal(r.owner, 'Product Engineering');
  assert.equal(r.reviewed, '2026-10-22');
});

test('empty file and a file of comments: incomplete', () => {
  assert.equal(evaluate('').reason, 'incomplete');
  assert.equal(evaluate('# nothing yet\n').reason, 'incomplete');
});

test('nested mapping is not supported: unreadable', () => {
  assert.equal(parse('owner:\n  name: x\n').ok, false);
});

test('CLI reads both trees from git and prints JSON', () => {
  const repo = mkdtempSync(join(tmpdir(), 'classification-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'demo@example.invalid');
  git('config', 'user.name', 'demo');
  mkdirSync(join(repo, '.github'));
  writeFileSync(join(repo, '.github', 'plugin-distribution.yml'), file());
  git('add', '.');
  git('commit', '-q', '-m', 'public');
  git('tag', 'v1.0.0');
  writeFileSync(join(repo, '.github', 'plugin-distribution.yml'), file({ classification: 'private' }));
  git('commit', '-q', '-am', 'private');

  const cli = fileURLToPath(new URL('./classification.mjs', import.meta.url));
  const run = (tag, head) => {
    const r = spawnSync(process.execPath, [cli, '--repo', repo, '--tag', tag, '--head', head], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(run('v1.0.0', 'v1.0.0').classification, 'public');
  assert.equal(run('v1.0.0', 'main').reason, 'reclassified');
  assert.equal(run('v9.9.9', 'main').reason, 'missing');
});
