#!/usr/bin/env node
// Builds the public copy of a plugin release: only the files Claude needs to
// install and run the plugin (marketplace ADR 0002, plan R5).
//
// Copied: .claude-plugin/*.json except marketplace.json; skills/, commands/,
// agents/, hooks/, hooks-handlers/; .mcp.json; README.md; LICENSE (or
// LICENSE.md / LICENSE.txt); any component path plugin.json declares; and the
// classification file's `include` list. Nothing else, and never .github/ or
// .git/.
//
// Fails closed, with one reason:
//   manifest-missing / manifest-unreadable   no readable .claude-plugin/plugin.json
//   path-outside-root    a declared or included path leaves the plugin root
//   declared-path-missing  plugin.json or include names a path that does not exist
//   symlink              a symlink in a copied path (it could point anywhere)
//   license-missing      no LICENSE (R8)
//   reference-outside-copy  a ${CLAUDE_PLUGIN_ROOT}/<path> in a copied file
//                        names a file the copy does not hold
//   upload-limits        the copy breaks a Claude upload limit (check-upload-limits.mjs)
//   output-not-empty     the output directory already has files
//
// Usage: node build.mjs --repo <dir> --ref <tag> --out <dir> [--include-json '["lib/"]']
//   Works from `git archive <ref>`, so the copy has no .git and no history.
//   Prints the result as JSON. Exit 0 = built, 1 = failed, 2 = usage.

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check as checkUploadLimits } from '../check-upload-limits.mjs';

const DIRS = ['skills', 'commands', 'agents', 'hooks', 'hooks-handlers'];
const FILES = ['.mcp.json', 'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt'];
const COMPONENT_FIELDS = ['commands', 'agents', 'skills', 'hooks', 'mcpServers', 'outputStyles', 'lspServers'];
const NEVER = new Set(['.github', '.git']);
const REFERENCE = /\$\{?CLAUDE_PLUGIN_ROOT\}?\/([^\s"'`()<>\[\]{},;|]+)/g;

const fail = (reason, detail) => ({ ok: false, reason, ...(detail ? { detail } : {}) });

function safeRel(p) {
  const n = normalize(p).split(sep).join('/').replace(/\/+$/, '');
  if (n === '' || n === '.' || n.startsWith('../') || n === '..' || n.startsWith('/')) return null;
  if (NEVER.has(n.split('/')[0])) return null;
  return n;
}

function declaredPaths(manifest) {
  const out = [];
  for (const field of COMPONENT_FIELDS) {
    const v = manifest[field];
    for (const p of typeof v === 'string' ? [v] : Array.isArray(v) ? v : []) if (typeof p === 'string') out.push(p);
  }
  return out;
}

function assertNoSymlinks(path, root) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw Object.assign(new Error(relative(root, path)), { symlink: true });
  if (st.isDirectory()) for (const name of readdirSync(path)) assertNoSymlinks(join(path, name), root);
}

function listFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (lstatSync(full).isDirectory()) visit(full);
      else files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function brokenReference(out) {
  for (const full of listFiles(out)) {
    const buf = readFileSync(full);
    if (buf.includes(0)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(REFERENCE)) {
        const ref = m[1].replace(/[.:]+$/, '');
        if (ref.includes('*') || ref.includes('$')) continue;
        const target = resolve(out, ref);
        if (relative(out, target).startsWith('..') || !existsSync(target)) {
          return `${relative(out, full).split(sep).join('/')}:${i + 1} -> ${ref}`;
        }
      }
    }
  }
  return null;
}

export function build(src, out, { include = [] } = {}) {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length) return fail('output-not-empty');

  const manifestPath = join(src, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) return fail('manifest-missing');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return fail('manifest-unreadable');
  }

  const wanted = new Set();
  for (const name of readdirSync(join(src, '.claude-plugin'))) {
    if (name.endsWith('.json') && name !== 'marketplace.json') wanted.add(`.claude-plugin/${name}`);
  }
  for (const p of [...DIRS, ...FILES]) if (existsSync(join(src, p))) wanted.add(p);
  for (const p of [...declaredPaths(manifest), ...include]) {
    const rel = safeRel(p);
    if (!rel) return fail('path-outside-root', p);
    if (!existsSync(join(src, rel))) return fail('declared-path-missing', rel);
    wanted.add(rel);
  }

  try {
    for (const rel of wanted) assertNoSymlinks(join(src, rel), src);
  } catch (e) {
    if (e.symlink) return fail('symlink', e.message);
    throw e;
  }
  for (const rel of [...wanted].sort()) {
    mkdirSync(dirname(join(out, rel)), { recursive: true });
    cpSync(join(src, rel), join(out, rel), { recursive: true, filter: (s) => !NEVER.has(s.split(sep).pop()) });
  }

  if (!['LICENSE', 'LICENSE.md', 'LICENSE.txt'].some((f) => existsSync(join(out, f)))) return fail('license-missing');
  const broken = brokenReference(out);
  if (broken) return fail('reference-outside-copy', broken);
  const limits = checkUploadLimits(out);
  if (limits.errors.length) return fail('upload-limits', limits.errors.join('; '));
  return { ok: true, files: listFiles(out).map((f) => relative(out, f).split(sep).join('/')) };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  if (!args.repo || !args.ref || !args.out) {
    process.stderr.write("usage: build.mjs --repo <dir> --ref <tag> --out <dir> [--include-json '[...]']\n");
    return 2;
  }
  let include = [];
  try {
    include = args['include-json'] ? JSON.parse(args['include-json']) : [];
    if (!Array.isArray(include)) throw new Error();
  } catch {
    process.stderr.write('build.mjs: --include-json must be a JSON array of paths\n');
    return 2;
  }
  const work = mkdtempSync(join(tmpdir(), 'public-bundle-src-'));
  try {
    const tar = join(work, 'src.tar');
    const src = join(work, 'src');
    mkdirSync(src);
    const a = spawnSync('git', ['-C', args.repo, 'archive', '--format=tar', '-o', tar, args.ref], { encoding: 'utf8' });
    const x = a.status === 0 ? spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' }) : a;
    const r = x.status === 0 ? build(src, args.out, { include }) : fail('archive-failed');
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return r.ok ? 0 : 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
