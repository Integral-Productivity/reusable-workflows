// Builds synthetic plugin trees for the public-bundle tests. Synthetic names
// only (`demo`, `demo-client`): a real Client name must never appear in a test.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SKILL = (body = 'Use this skill to demo things.', extra = '') =>
  `---\nname: demo\ndescription: Demo skill for tests.\n${extra}---\n\n# Demo\n\n${body}\n`;

export function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'public-bundle-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

export function plugin(overrides = {}) {
  return tree({
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', description: 'Demo plugin.', version: '1.0.0' }),
    'skills/demo/SKILL.md': SKILL(),
    'README.md': '# demo\n',
    LICENSE: 'MIT License\n',
    ...overrides,
  });
}

export const tmp = (prefix = 'public-bundle-out-') => mkdtempSync(join(tmpdir(), prefix));
