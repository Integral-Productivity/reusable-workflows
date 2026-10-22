#!/usr/bin/env node
// Rebuilds a public catalog's `.claude-plugin/marketplace.json` from its
// plugin folders (marketplace ADR 0002, plan KTD1 and KTD6).
//
// Each folder `plugins/<name>/` becomes one entry:
//   { name, source: "./plugins/<name>", description, version }
// read from that folder's `.claude-plugin/plugin.json`. Entries whose source is
// not a `./plugins/` folder (for example a `github` source) are kept as they
// are, in their order, before the folder entries. A folder entry whose folder
// is gone is dropped, which is how a removal reaches the catalog.
//
// Throws, so the caller fails, when a folder has no readable plugin.json, when
// the manifest's name differs from its folder or has no version, when a
// folder's name is already listed with another source, or when plugins/ holds
// a file.
//
// The publish job (publish.mjs) and the catalog integrity check (U5) share it.
//
// Usage: node catalog.mjs <catalog-dir> [--check]
//   Writes marketplace.json. With --check, writes nothing and exits 1 when the
//   committed file differs from the generated one.

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FOLDER_ROOT = 'plugins';
export const CATALOG_PATH = '.claude-plugin/marketplace.json';
export const NAME = /^[a-z0-9][a-z0-9-]*$/;

export const isFolderEntry = (entry) => typeof entry?.source === 'string' && entry.source.startsWith(`./${FOLDER_ROOT}/`);

function readJson(path, what) {
  if (!existsSync(path)) throw new Error(`${what} is missing`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

function folderEntry(dir, name) {
  const where = `${FOLDER_ROOT}/${name}`;
  if (!NAME.test(name)) throw new Error(`${where}: folder name is not a valid plugin name`);
  const m = readJson(join(dir, FOLDER_ROOT, name, '.claude-plugin', 'plugin.json'), `${where}: .claude-plugin/plugin.json`);
  if (m.name !== name) throw new Error(`${where}: name "${m.name}" does not match its folder`);
  if (typeof m.version !== 'string' || m.version === '') throw new Error(`${where}: version is missing`);
  const entry = { name, source: `./${where}` };
  if (typeof m.description === 'string') entry.description = m.description;
  entry.version = m.version;
  return entry;
}

export function generate(dir) {
  const current = readJson(join(dir, CATALOG_PATH), CATALOG_PATH);
  const kept = (Array.isArray(current.plugins) ? current.plugins : []).filter((e) => !isFolderEntry(e));
  const root = join(dir, FOLDER_ROOT);
  const names = existsSync(root) ? readdirSync(root).sort() : [];
  const folders = names.map((name) => {
    if (!lstatSync(join(root, name)).isDirectory()) throw new Error(`${FOLDER_ROOT}/${name} is not a folder`);
    if (kept.some((e) => e.name === name)) throw new Error(`"${name}" is already listed with another source`);
    return folderEntry(dir, name);
  });
  return { ...current, plugins: [...kept, ...folders] };
}

export const render = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

export function stale(dir) {
  return readFileSync(join(dir, CATALOG_PATH), 'utf8') !== render(generate(dir));
}

export function write(dir) {
  const manifest = generate(dir);
  writeFileSync(join(dir, CATALOG_PATH), render(manifest));
  return manifest;
}

function main(argv) {
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) {
    process.stderr.write('usage: catalog.mjs <catalog-dir> [--check]\n');
    return 2;
  }
  try {
    if (argv.includes('--check')) {
      if (!stale(dir)) return 0;
      process.stdout.write(`${CATALOG_PATH} does not match the plugin folders; run catalog.mjs to regenerate it\n`);
      return 1;
    }
    write(dir);
    return 0;
  } catch (e) {
    process.stdout.write(`catalog: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
