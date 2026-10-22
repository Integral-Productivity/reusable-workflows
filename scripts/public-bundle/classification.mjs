#!/usr/bin/env node
// Reads a plugin repo's distribution classification, `.github/plugin-distribution.yml`,
// and decides whether a tagged release may be copied to a public catalog.
//
// Fails closed: the answer is `public` only when the file at the tagged commit
// AND the file at the default branch's HEAD both parse and both declare
// `classification: public` with an owner, an ISO review date and a catalog.
// Every other case is `private`, with one reason:
//
//   missing           no file at the tagged commit
//   unreadable        the file is not the YAML subset below
//   incomplete        public, but owner, reviewed or catalog is absent
//   invalid           a value is outside the vocabulary, or a key is unknown
//   declared-private  the file says private
//   reclassified      public at the tag, but not public at the default branch
//
// The file sits under .github/, which the bundle never copies, so it cannot ship.
//
// Supported YAML: `key: value` scalars (plain, single- or double-quoted, with
// optional trailing `# comment`), and one block list, `include:` followed by
// `  - item` lines. Anything else is `unreadable`, on purpose: a hand-rolled
// subset avoids a YAML dependency, and refusing what it cannot read is safer
// than guessing.
//
// Usage: node classification.mjs --repo <dir> --tag <ref> --head <ref>
//   Prints the result as JSON and exits 0, so a caller branches on the JSON,
//   not on the exit code. Exits 2 on a usage error.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FILE_PATH = '.github/plugin-distribution.yml';
export const CATALOGS = ['core', 'labs'];
const KEYS = ['classification', 'owner', 'reviewed', 'catalog', 'include'];

function scalar(raw) {
  const v = raw.trim();
  const quoted = v.match(/^(["'])(.*)\1\s*(#.*)?$/);
  if (quoted) return quoted[2];
  if (/^["'\[{|>&*!]/.test(v)) return undefined;
  return v.replace(/\s+#.*$/, '').trim();
}

export function parse(text) {
  const data = {};
  let list = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = line.match(/^\s+-\s+(.*)$/) ?? line.match(/^\s+-()$/);
    if (item) {
      if (!list) return { ok: false };
      const v = scalar(item[1]);
      if (v === undefined) return { ok: false };
      list.push(v);
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!kv) return { ok: false };
    const [, key, rest = ''] = kv;
    if (Object.hasOwn(data, key)) return { ok: false };
    if (rest.trim() === '' || /^#/.test(rest.trim())) {
      list = data[key] = [];
      continue;
    }
    list = null;
    const v = scalar(rest);
    if (v === undefined) return { ok: false };
    data[key] = v;
  }
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && k !== 'include' && v.length === 0) data[k] = '';
    else if (Array.isArray(v) && k !== 'include') return { ok: false };
  }
  return { ok: true, data };
}

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isSafeInclude(p) {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || p.includes('\\')) return false;
  const parts = p.split('/').filter((s) => s !== '');
  if (parts.some((s) => s === '..' || s === '.')) return false;
  return !['.github', '.git'].includes(parts[0]);
}

const priv = (reason) => ({ classification: 'private', reason });

export function evaluate(text) {
  if (text === null || text === undefined) return priv('missing');
  const parsed = parse(text);
  if (!parsed.ok) return priv('unreadable');
  const d = parsed.data;
  if (Object.keys(d).some((k) => !KEYS.includes(k))) return priv('invalid');
  if (d.classification === 'private') return priv('declared-private');
  if (d.classification === undefined || d.classification === '') return priv('incomplete');
  if (d.classification !== 'public') return priv('invalid');
  if (!d.owner || !d.reviewed || !d.catalog) return priv('incomplete');
  if (!isIsoDate(d.reviewed) || !CATALOGS.includes(d.catalog)) return priv('invalid');
  const include = d.include ?? [];
  if (!Array.isArray(include) || !include.every(isSafeInclude)) return priv('invalid');
  return { classification: 'public', reason: 'public', owner: d.owner, reviewed: d.reviewed, catalog: d.catalog, include };
}

export function classify({ atTag, atHead }) {
  const tag = evaluate(atTag);
  if (tag.classification !== 'public') return tag;
  const head = evaluate(atHead);
  if (head.classification !== 'public') return priv('reclassified');
  return tag;
}

function readAt(repo, ref) {
  const r = spawnSync('git', ['-C', repo, 'show', `${ref}:${FILE_PATH}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  if (!args.tag || !args.head) {
    process.stderr.write('usage: classification.mjs [--repo <dir>] --tag <ref> --head <ref>\n');
    return 2;
  }
  const repo = args.repo ?? '.';
  process.stdout.write(`${JSON.stringify(classify({ atTag: readAt(repo, args.tag), atHead: readAt(repo, args.head) }))}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
