import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, frontmatterField } from './check-upload-limits.mjs';

function plugin({ pluginDesc = 'ok', skills = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'upload-limits-'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', description: pluginDesc }));
  for (const [name, body] of Object.entries(skills)) {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), body);
  }
  return root;
}

const skill = (desc) => `---\nname: demo\ndescription: >\n  ${desc}\nstatus: draft\n---\n\n# Demo\n`;

test('a plugin inside every limit passes', () => {
  assert.deepEqual(check(plugin({ skills: { demo: skill('short') } })).errors, []);
});

test('plugin description of 501 characters fails', () => {
  const { errors } = check(plugin({ pluginDesc: 'x'.repeat(501) }));
  assert.match(errors[0], /plugin\.json: description is 501 characters/);
});

test('plugin description of exactly 500 characters passes', () => {
  assert.deepEqual(check(plugin({ pluginDesc: 'x'.repeat(500) })).errors, []);
});

test('skill description of 1025 characters fails', () => {
  const { errors } = check(plugin({ skills: { demo: skill('y'.repeat(1025)) } }));
  assert.match(errors[0], /skills\/demo\/SKILL\.md: description is 1025 characters/);
});

test('skill without a name fails', () => {
  const { errors } = check(plugin({ skills: { demo: '---\ndescription: d\n---\n' } }));
  assert.match(errors[0], /name is missing/);
});

test('missing manifest fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'upload-limits-'));
  assert.match(check(root).errors[0], /plugin\.json is missing/);
});

test('folded block lines join with a single space', () => {
  const text = '---\ndescription: >\n  one\n  two\nname: n\n---\n';
  assert.equal(frontmatterField(text, 'description'), 'one two');
  assert.equal(frontmatterField(text, 'name'), 'n');
});

test('quoted single-line value is unquoted', () => {
  assert.equal(frontmatterField('---\nname: "demo"\n---\n', 'name'), 'demo');
});

const cli = fileURLToPath(new URL('./check-upload-limits.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('CLI exits 1 with ::error:: on a violation', () => {
  const r = run(plugin({ pluginDesc: 'x'.repeat(501) }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error::/);
});

test('CLI with --warn exits 0 with ::warning:: on a violation', () => {
  const r = run('--warn', plugin({ pluginDesc: 'x'.repeat(501) }));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /::warning::/);
});

test('CLI exits 0 on a clean plugin', () => {
  const r = run(plugin({ skills: { demo: skill('short') } }));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Upload limits OK: plugin\.json and 1 skills/);
});

// validate-plugin-manifest.yml embeds this script in a heredoc, because the
// reusable runs in the caller's checkout. This keeps the embedded copy honest.
test('the copy embedded in validate-plugin-manifest.yml matches this script', () => {
  const yml = readFileSync(new URL('../.github/workflows/validate-plugin-manifest.yml', import.meta.url), 'utf8');
  const m = yml.match(/<<'UPLOAD_LIMITS_EOF'\n([\s\S]*?)\n( *)UPLOAD_LIMITS_EOF\n/);
  assert.ok(m, 'heredoc not found in validate-plugin-manifest.yml');
  const embedded = m[1].split('\n').map((l) => l.slice(m[2].length)).join('\n');
  const source = readFileSync(cli, 'utf8').replace(/\n+$/, '');
  assert.equal(embedded, source);
});
