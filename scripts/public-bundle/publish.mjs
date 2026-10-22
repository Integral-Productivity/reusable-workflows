#!/usr/bin/env node
// Places a checked public copy into a catalog checkout, or takes one out
// (marketplace ADR 0002, plan KTD5, KTD6, KTD7 and KTD12). It only changes
// files; the workflow commits, pushes and opens the pull request.
//
// apply   replaces plugins/<name>/ with the copy, writes the receipt, and
//         regenerates marketplace.json with catalog.mjs. The copy must already
//         have passed build.mjs and check.mjs: this script does not re-check it.
// remove  deletes plugins/<name>/ and regenerates marketplace.json.
// find    lists the folders whose receipt names a source repo, so a plugin
//         that is no longer public can be found in any catalog.
//
// The receipt, plugins/<name>/.publish-receipt.json, holds the source repo,
// version, source commit, tag time, check version, check result and a SHA-256
// digest of the folder without the receipt. It holds no finding and no file
// content. Merge time is not in it: the lag report reads that from the merge
// commit that last changed the folder.
//
// Fails, changing nothing, on:
//   metadata-missing  a receipt field was not given
//   manifest-missing / manifest-unreadable  the copy has no readable plugin.json
//   name-invalid      plugin.json's name is not a safe folder name
//   version-mismatch  the tag is not v<plugin.json version>
//   catalog-invalid   catalog.mjs cannot regenerate the catalog with this folder
//
// Usage:
//   node publish.mjs apply --catalog <dir> --copy <dir> --source-repo <owner/name>
//        --tag <vX.Y.Z> --commit <sha> --tag-time <iso> --check-version <sha>
//   node publish.mjs remove --catalog <dir> --name <plugin>
//   node publish.mjs find --catalog <dir> --source-repo <owner/name>
// Prints the result as JSON. Exit 0 = done, 1 = failed, 2 = usage.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_PATH, FOLDER_ROOT, NAME, write as writeCatalog } from './catalog.mjs';

export const RECEIPT = '.publish-receipt.json';
const FIELDS = ['sourceRepo', 'tag', 'commit', 'tagTime', 'checkVersion'];

const fail = (reason, detail) => ({ ok: false, reason, ...(detail ? { detail } : {}) });

function listFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (lstatSync(full).isDirectory()) visit(full);
      else files.push(relative(root, full).split(sep).join('/'));
    }
  };
  visit(root);
  return files.sort();
}

// Each file contributes its path, its length and its bytes, so renaming a file
// or moving bytes between files changes the digest.
export function digest(dir) {
  const h = createHash('sha256');
  for (const rel of listFiles(dir)) {
    if (rel === RECEIPT) continue;
    const bytes = readFileSync(join(dir, rel));
    h.update(`${rel}\0${bytes.length}\0`);
    h.update(bytes);
  }
  return `sha256:${h.digest('hex')}`;
}

function readManifest(copy) {
  const path = join(copy, '.claude-plugin', 'plugin.json');
  if (!existsSync(path)) return fail('manifest-missing');
  try {
    return { ok: true, manifest: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return fail('manifest-unreadable');
  }
}

// Regenerates the catalog; on failure, puts back the files it was given.
function regenerate(catalog, restore) {
  try {
    writeCatalog(catalog);
    return null;
  } catch (e) {
    restore();
    return fail('catalog-invalid', e.message);
  }
}

export function apply(catalog, copy, meta) {
  const missing = FIELDS.find((f) => !meta[f]);
  if (missing) return fail('metadata-missing', missing);
  const m = readManifest(copy);
  if (!m.ok) return m;
  const { name, version } = m.manifest;
  if (typeof name !== 'string' || !NAME.test(name)) return fail('name-invalid');
  if (meta.tag !== `v${version}`) return fail('version-mismatch', `tag ${meta.tag}, plugin.json ${version}`);

  const folder = join(catalog, FOLDER_ROOT, name);
  const firstPublish = !existsSync(folder);
  const hadRoot = existsSync(join(catalog, FOLDER_ROOT));
  const catalogBefore = readFileSync(join(catalog, CATALOG_PATH), 'utf8');
  const backup = firstPublish ? null : join(mkdtempSync(join(tmpdir(), 'publish-backup-')), name);
  if (backup) renameSync(folder, backup);
  cpSync(copy, folder, { recursive: true });
  const receipt = {
    sourceRepo: meta.sourceRepo,
    version,
    commit: meta.commit,
    tagTime: meta.tagTime,
    checkVersion: meta.checkVersion,
    checkResult: 'pass',
    digest: digest(folder),
  };
  writeFileSync(join(folder, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  const failed = regenerate(catalog, () => {
    rmSync(folder, { recursive: true, force: true });
    if (backup) renameSync(backup, folder);
    if (!hadRoot) rmSync(join(catalog, FOLDER_ROOT), { recursive: true, force: true });
    writeFileSync(join(catalog, CATALOG_PATH), catalogBefore);
  });
  if (backup) rmSync(backup, { recursive: true, force: true });
  if (failed) return failed;
  return { ok: true, name, version, firstPublish };
}

export function remove(catalog, name) {
  if (typeof name !== 'string' || !NAME.test(name)) return fail('name-invalid');
  const folder = join(catalog, FOLDER_ROOT, name);
  if (!existsSync(folder)) return { ok: true, name, removed: false };
  rmSync(folder, { recursive: true, force: true });
  try {
    writeCatalog(catalog);
  } catch (e) {
    return fail('catalog-invalid', e.message);
  }
  return { ok: true, name, removed: true };
}

export function foldersFromSource(catalog, sourceRepo) {
  const root = join(catalog, FOLDER_ROOT);
  if (!existsSync(root)) return [];
  const want = sourceRepo.toLowerCase();
  return readdirSync(root)
    .sort()
    .filter((name) => {
      try {
        return JSON.parse(readFileSync(join(root, name, RECEIPT), 'utf8')).sourceRepo?.toLowerCase() === want;
      } catch {
        return false;
      }
    });
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const a = {};
  for (let i = 0; i < rest.length; i += 2) a[rest[i]?.replace(/^--/, '')] = rest[i + 1];
  let r;
  if (cmd === 'apply' && a.catalog && a.copy) {
    r = apply(a.catalog, a.copy, {
      sourceRepo: a['source-repo'],
      tag: a.tag,
      commit: a.commit,
      tagTime: a['tag-time'],
      checkVersion: a['check-version'],
    });
  } else if (cmd === 'remove' && a.catalog && a.name) {
    r = remove(a.catalog, a.name);
  } else if (cmd === 'find' && a.catalog && a['source-repo']) {
    r = { ok: true, folders: foldersFromSource(a.catalog, a['source-repo']) };
  } else {
    process.stderr.write('usage: publish.mjs apply|remove|find --catalog <dir> ... (see the header)\n');
    return 2;
  }
  process.stdout.write(`${JSON.stringify(r)}\n`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
