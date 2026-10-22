#!/usr/bin/env node
// Privacy check for a public plugin copy, run on the built copy inside the
// private source repo's job, before anything is pushed (marketplace ADR 0002).
//
// Layers: L1 secrets (built-in patterns, plus gitleaks when --gitleaks is
// given), L2 personal emails and phone numbers, L3 Client names by hashed
// denylist over contents AND file paths, L4 internal locators and claude.ai
// connector IDs, L5 confidential markers.
//
// Fails closed. Any finding fails; so does a missing or unparseable denylist,
// an empty key, a denylist built more than 30 days ago, an unreadable file or
// directory, a symlink, and a gitleaks run that does not complete. A finding
// names file, line, layer and a fixed detail, never the matched text.
//
// Usage: node check.mjs <copy-dir> [--gitleaks <path-to-gitleaks>]
//   Reads PUBLIC_BUNDLE_DENYLIST and PUBLIC_BUNDLE_DENYLIST_KEY from the
//   environment. Exit 0 = pass, 1 = fail.

import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIDENTIAL_MARKERS, locatorsIn, personalEmailIn, phoneIn, SECRET_PATTERNS, windowHashes } from './patterns.mjs';

export const DENYLIST_MAX_AGE_DAYS = 30;

class InputUnavailable extends Error {}

function loadDenylist(raw, key, now) {
  if (!key) throw new InputUnavailable('PUBLIC_BUNDLE_DENYLIST_KEY is not set');
  if (!raw) throw new InputUnavailable('PUBLIC_BUNDLE_DENYLIST is not set');
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    throw new InputUnavailable('PUBLIC_BUNDLE_DENYLIST is not valid JSON');
  }
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.built) || !Array.isArray(d.entries) || !d.entries.every((e) => Array.isArray(e) && e.length === 2)) {
    throw new InputUnavailable('PUBLIC_BUNDLE_DENYLIST does not have the expected shape');
  }
  // Whole UTC days, so a list built 30 calendar days ago passes all day.
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const ageDays = (today - Date.parse(`${d.built}T00:00:00Z`)) / 86_400_000;
  if (!(ageDays <= DENYLIST_MAX_AGE_DAYS)) return { stale: true };
  const index = new Map();
  d.entries.forEach(([spaced, joined], i) => {
    index.set(spaced, i + 1);
    index.set(joined, i + 1);
  });
  return { index };
}

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw Object.assign(new Error(relative(root, full)), { symlink: true });
      if (st.isDirectory()) visit(full);
      else files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function denylistHits(text, key, index) {
  const hits = new Set();
  for (const h of windowHashes(text, key)) if (index.has(h)) hits.add(index.get(h));
  return [...hits].sort((a, b) => a - b);
}

function runGitleaks(bin, root) {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-report-'));
  const report = join(dir, 'report.json');
  try {
    const r = spawnSync(bin, ['dir', root, '--no-banner', '--redact', '--report-format', 'json', '--report-path', report, '--exit-code', '0'], {
      stdio: 'ignore',
    });
    if (r.error || r.status !== 0) throw new InputUnavailable('gitleaks did not complete');
    let items;
    try {
      items = JSON.parse(readFileSync(report, 'utf8'));
    } catch {
      throw new InputUnavailable('gitleaks report is unreadable');
    }
    if (!Array.isArray(items)) throw new InputUnavailable('gitleaks report is unreadable');
    return items.map((it) => ({
      file: (isAbsolute(it.File) ? relative(root, it.File) : it.File).split(sep).join('/'),
      line: Number(it.StartLine) || 0,
      layer: 'L1',
      detail: `gitleaks rule ${String(it.RuleID).replace(/[^\w.-]/g, '')}`,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function check(root, { denylist, key, now = new Date(), gitleaks } = {}) {
  try {
    const list = loadDenylist(denylist, key, now);
    if (list.stale) return { ok: false, reason: 'denylist-stale', findings: [] };
    let files;
    try {
      files = walk(root);
    } catch (e) {
      if (e.symlink) return { ok: false, reason: 'symlink', detail: e.message, findings: [] };
      throw new InputUnavailable('the copy directory is unreadable');
    }
    const findings = [];
    const seen = new Set();
    const add = (f) => {
      const k = `${f.file}\0${f.line}\0${f.layer}\0${f.detail}`;
      if (seen.has(k)) return;
      seen.add(k);
      findings.push(f);
    };
    for (const full of files) {
      const file = relative(root, full).split(sep).join('/');
      for (const n of denylistHits(file, key, list.index)) add({ file, line: 0, layer: 'L3', detail: `denylist entry #${n} (in path)` });
      let buf;
      try {
        buf = readFileSync(full);
      } catch {
        throw new InputUnavailable(`${file} is unreadable`);
      }
      const text = buf.includes(0) ? buf.toString('latin1') : buf.toString('utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        const at = { file, line: i + 1 };
        for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) add({ ...at, layer: 'L1', detail: `secret pattern ${name}` });
        if (personalEmailIn(line)) add({ ...at, layer: 'L2', detail: 'email address' });
        if (phoneIn(line)) add({ ...at, layer: 'L2', detail: 'phone number' });
        for (const n of denylistHits(line, key, list.index)) add({ ...at, layer: 'L3', detail: `denylist entry #${n}` });
        for (const name of locatorsIn(line)) add({ ...at, layer: 'L4', detail: name });
        if (CONFIDENTIAL_MARKERS.some((re) => re.test(line))) add({ ...at, layer: 'L5', detail: 'confidential marker' });
      });
    }
    if (gitleaks) for (const f of runGitleaks(gitleaks, root)) add(f);
    return findings.length ? { ok: false, reason: 'findings', findings } : { ok: true, findings };
  } catch (e) {
    if (e instanceof InputUnavailable) return { ok: false, reason: 'input-unavailable', detail: e.message, findings: [] };
    return { ok: false, reason: 'input-unavailable', detail: 'the check failed unexpectedly', findings: [] };
  }
}

function main(argv) {
  const root = argv[0];
  const gi = argv.indexOf('--gitleaks');
  if (!root || root.startsWith('--')) {
    process.stderr.write('usage: check.mjs <copy-dir> [--gitleaks <path>]\n');
    return 2;
  }
  const r = check(root, {
    denylist: process.env.PUBLIC_BUNDLE_DENYLIST,
    key: process.env.PUBLIC_BUNDLE_DENYLIST_KEY,
    gitleaks: gi === -1 ? undefined : argv[gi + 1],
  });
  for (const f of r.findings) process.stdout.write(`${f.file}:${f.line} ${f.layer} ${f.detail}\n`);
  process.stdout.write(r.ok ? 'PASS\n' : `FAIL ${r.reason}${r.detail ? `: ${r.detail}` : ''}\n`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
