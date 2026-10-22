import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from './build.mjs';
import { plugin, tmp, SKILL } from './test-fixtures.mjs';

const has = (dir, p) => existsSync(join(dir, p));

test('plans and strategy files are not copied (AE1)', () => {
  const src = plugin({ 'docs/plans/2026-10-01-plan.md': 'plan', 'STRATEGY.md': 'strategy', 'CLAUDE.md': 'x', 'test/a.test.mjs': 'x' });
  const out = tmp();
  const r = build(src, out);
  assert.equal(r.ok, true, r.reason);
  assert.equal(has(out, 'docs'), false);
  assert.equal(has(out, 'STRATEGY.md'), false);
  assert.equal(has(out, 'CLAUDE.md'), false);
  assert.equal(has(out, 'test'), false);
  for (const p of ['.claude-plugin/plugin.json', 'skills/demo/SKILL.md', 'README.md', 'LICENSE']) assert.ok(has(out, p), p);
});

test('.github, .git and marketplace.json never ship', () => {
  const src = plugin({ '.github/plugin-distribution.yml': 'classification: public\n', '.git/config': 'x', '.claude-plugin/marketplace.json': '{}' });
  const out = tmp();
  assert.equal(build(src, out).ok, true);
  assert.equal(has(out, '.github'), false);
  assert.equal(has(out, '.git'), false);
  assert.equal(has(out, '.claude-plugin/marketplace.json'), false);
});

test('.claude-plugin/hooks.json ships and its paths resolve', () => {
  const src = plugin({
    '.claude-plugin/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/start.sh' }] }] } }),
    'hooks/start.sh': '#!/bin/sh\nexit 0\n',
  });
  const out = tmp();
  const r = build(src, out);
  assert.equal(r.ok, true, r.reason);
  assert.ok(has(out, '.claude-plugin/hooks.json'));
  assert.ok(has(out, 'hooks/start.sh'));
});

test('commands, agents, hooks-handlers and .mcp.json ship', () => {
  const src = plugin({ 'commands/go.md': 'x', 'agents/a.md': 'x', 'hooks-handlers/h.sh': 'x', '.mcp.json': '{}' });
  const out = tmp();
  assert.equal(build(src, out).ok, true);
  for (const p of ['commands/go.md', 'agents/a.md', 'hooks-handlers/h.sh', '.mcp.json']) assert.ok(has(out, p), p);
});

test('component paths declared in plugin.json ship', () => {
  const src = plugin({
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', description: 'Demo.', commands: ['./extra/cmd.md'], agents: './team/' }),
    'extra/cmd.md': 'x',
    'team/a.md': 'x',
  });
  const out = tmp();
  assert.equal(build(src, out).ok, true);
  assert.ok(has(out, 'extra/cmd.md'));
  assert.ok(has(out, 'team/a.md'));
});

test('a reference outside the copy fails; include fixes it', () => {
  const files = { 'skills/demo/SKILL.md': SKILL('Run `${CLAUDE_PLUGIN_ROOT}/lib/tool.sh`.'), 'lib/tool.sh': '#!/bin/sh\n' };
  const r1 = build(plugin(files), tmp());
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'reference-outside-copy');
  assert.match(r1.detail, /skills\/demo\/SKILL\.md:\d+ -> lib\/tool\.sh/);
  const out = tmp();
  const r2 = build(plugin(files), out, { include: ['lib/'] });
  assert.equal(r2.ok, true, r2.reason);
  assert.ok(has(out, 'lib/tool.sh'));
});

test('a reference that climbs out of the plugin root fails', () => {
  const r = build(plugin({ 'skills/demo/SKILL.md': SKILL('See ${CLAUDE_PLUGIN_ROOT}/../secret.txt') }), tmp());
  assert.equal(r.reason, 'reference-outside-copy');
});

test('no LICENSE fails license-missing (R8)', () => {
  const src = plugin();
  rmSync(join(src, 'LICENSE'));
  assert.equal(build(src, tmp()).reason, 'license-missing');
});

test('LICENSE.md is accepted', () => {
  const src = plugin({ 'LICENSE.md': 'MIT\n' });
  rmSync(join(src, 'LICENSE'));
  assert.equal(build(src, tmp()).ok, true);
});

test('a symlink anywhere in the copy fails closed', () => {
  const src = plugin();
  symlinkSync('/etc/hostname', join(src, 'skills', 'demo', 'link.md'));
  assert.equal(build(src, tmp()).reason, 'symlink');
});

test('an upload-limit breach fails the build', () => {
  const src = plugin({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', description: 'x'.repeat(501) }) });
  assert.equal(build(src, tmp()).reason, 'upload-limits');
});

test('missing plugin.json fails manifest-missing', () => {
  const src = plugin();
  rmSync(join(src, '.claude-plugin', 'plugin.json'));
  assert.equal(build(src, tmp()).reason, 'manifest-missing');
});

test('the output directory must be empty', () => {
  const out = tmp();
  build(plugin(), out);
  assert.equal(build(plugin(), out).reason, 'output-not-empty');
});

test('the clean copy passes `claude plugin validate` when the CLI is present', (t) => {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('claude CLI not on PATH');
  const out = tmp();
  assert.equal(build(plugin(), out).ok, true);
  const r = spawnSync('claude', ['plugin', 'validate', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(out, 'README.md'), 'utf8'), '# demo\n');
});
