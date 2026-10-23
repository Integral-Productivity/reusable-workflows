#!/usr/bin/env node
// Checks that a public catalog serves only content that passed the privacy
// check (marketplace ADR 0002, plan U5, KTD6, KTD7 and KTD12).
//
// audit       strict on every `./plugins/<name>` folder entry:
//   catalog-invalid   catalog.mjs cannot regenerate the catalog (bad folder)
//   catalog-stale     marketplace.json differs from what the folders produce,
//                     so a folder has no entry or an entry has no folder
//   receipt-missing / receipt-unreadable / receipt-incomplete
//   receipt-failed    the receipt's checkResult is not `pass`
//   receipt-version   the receipt names another version than plugin.json
//   digest-mismatch   a file changed after publish.mjs wrote the receipt
// Entries with another source (for example `github`) have no receipt. They
// produce one `other-source` warning each and never fail the check (Kraig's
// decision, 2026-10-23).
//
// reclassify  the weekly backstop for KTD12. For each folder, reads the source
// repo's `.github/plugin-distribution.yml` on its default branch and lists the
// folders to remove: the source is no longer public, or now names the other
// catalog. A source it cannot read is listed as unreadable and is never removed,
// so a lost token cannot empty a catalog.
//
// Reports name a plugin, a rule and a fixed detail. They never hold file
// contents.
//
// Usage:
//   node integrity.mjs audit <catalog-dir>
//   node integrity.mjs reclassify <catalog-dir> --catalog core|labs
//     (reads with `gh api`, so GH_TOKEN must be able to read the source repos)
// Prints the result as JSON. audit exits 1 when it found an error.
// reclassify exits 0 and lets the caller act on the JSON. Usage errors exit 2.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATALOG_PATH, FOLDER_ROOT, generate, isFolderEntry, render } from './catalog.mjs';
import { CATALOGS, evaluate, FILE_PATH } from './classification.mjs';
import { digest, RECEIPT } from './publish.mjs';

const RECEIPT_FIELDS = ['sourceRepo', 'version', 'commit', 'tagTime', 'checkVersion', 'checkResult', 'digest'];

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

function describeSource(source) {
  if (typeof source === 'string') return source;
  const kind = source?.source ?? 'unknown';
  const where = source?.repo ?? source?.url ?? '';
  return `${kind}${where ? ` ${where}` : ''}`;
}

function checkFolder(dir, name) {
  const folder = join(dir, FOLDER_ROOT, name);
  const err = (rule, detail) => ({ plugin: name, rule, ...(detail ? { detail } : {}) });
  const path = join(folder, RECEIPT);
  if (!existsSync(path)) return [err('receipt-missing')];
  const receipt = readJson(path);
  if (!receipt || typeof receipt !== 'object') return [err('receipt-unreadable')];
  const missing = RECEIPT_FIELDS.find((f) => !receipt[f]);
  if (missing) return [err('receipt-incomplete', missing)];
  const errors = [];
  if (receipt.checkResult !== 'pass') errors.push(err('receipt-failed'));
  const version = readJson(join(folder, '.claude-plugin', 'plugin.json'))?.version;
  if (receipt.version !== version) errors.push(err('receipt-version', `receipt ${receipt.version}, plugin.json ${version}`));
  if (receipt.digest !== digest(folder)) errors.push(err('digest-mismatch'));
  return errors;
}

export function audit(dir) {
  const errors = [];
  let generated;
  try {
    generated = generate(dir);
  } catch (e) {
    return { ok: false, errors: [{ rule: 'catalog-invalid', detail: e.message }], warnings: [], checked: [] };
  }
  if (readFileSync(join(dir, CATALOG_PATH), 'utf8') !== render(generated)) {
    errors.push({ rule: 'catalog-stale', detail: `${CATALOG_PATH} does not match the plugin folders` });
  }
  const checked = [];
  const warnings = [];
  for (const entry of generated.plugins) {
    if (!isFolderEntry(entry)) {
      warnings.push({ plugin: entry.name, rule: 'other-source', detail: `${describeSource(entry.source)}; no receipt to check` });
      continue;
    }
    checked.push(entry.name);
    errors.push(...checkFolder(dir, entry.name));
  }
  return { ok: errors.length === 0, errors, warnings, checked };
}

// read(repo) returns the file text, undefined when the repo has no such file,
// or null when the repo itself could not be read.
export function reclassify(dir, catalog, read) {
  const remove = [];
  const unreadable = [];
  const root = join(dir, FOLDER_ROOT);
  const names = existsSync(root) ? audit(dir).checked : [];
  for (const name of names) {
    const sourceRepo = readJson(join(root, name, RECEIPT))?.sourceRepo;
    if (!sourceRepo) continue;
    const text = read(sourceRepo);
    if (text === null) {
      unreadable.push({ plugin: name, sourceRepo });
      continue;
    }
    const c = evaluate(text);
    if (c.classification !== 'public') remove.push({ plugin: name, sourceRepo, reason: c.reason });
    else if (c.catalog !== catalog) remove.push({ plugin: name, sourceRepo, reason: `catalog-${c.catalog}` });
  }
  return { remove, unreadable };
}

// Reads with the GitHub CLI. The repo is read first: GitHub answers 404 both
// for a missing file and for a repo the token cannot see, and only the first
// may lead to a removal.
function ghRead(repo) {
  const gh = (path, ...extra) => spawnSync('gh', ['api', ...extra, path], { encoding: 'utf8' });
  if (gh(`repos/${repo}`).status !== 0) return null;
  const file = gh(`repos/${repo}/contents/${FILE_PATH}`, '-H', 'Accept: application/vnd.github.raw');
  if (file.status === 0) return file.stdout;
  return /HTTP 404/.test(file.stderr) ? undefined : null;
}

function main(argv) {
  const [cmd, dir, flag, value] = argv;
  let r;
  if (cmd === 'audit' && dir) {
    r = audit(dir);
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'reclassify' && dir && flag === '--catalog' && CATALOGS.includes(value)) {
    r = reclassify(dir, value, ghRead);
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return 0;
  }
  process.stderr.write('usage: integrity.mjs audit <catalog-dir> | reclassify <catalog-dir> --catalog core|labs\n');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
