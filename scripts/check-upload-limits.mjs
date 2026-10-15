#!/usr/bin/env node
// Checks the limits that Claude's plugin upload validator enforces
// (Customize > Plugins). A plugin that breaks one is rejected at upload even
// when `claude plugin validate` passes, so validate-plugin-manifest.yml runs
// this beside it. See devops-excellence#777 and ADR-038 decision 6.
//
// Ported from integral-productivity-coaching-claude-plugin#69. The limits come
// from the upload validator's error text, not from a published spec.
//
//   plugin.json  description  <= 500 characters
//   SKILL.md     name          present
//   SKILL.md     description   present, <= 1024 characters
//
// Usage: node scripts/check-upload-limits.mjs [--warn] [plugin-root]
//
//   --warn  report violations as warnings and exit 0

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DESCRIPTION_MAX = 500;
export const SKILL_DESCRIPTION_MAX = 1024;

// Reads one scalar field from YAML frontmatter: plain, quoted, or a
// folded (>) / literal (|) block. Enough for SKILL.md frontmatter, without
// adding a YAML dependency.
export function frontmatterField(text, field) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${field}:`));
  if (i === -1) return undefined;
  const rest = lines[i].slice(field.length + 1).trim();
  if (/^[>|][+-]?$/.test(rest)) {
    const block = [];
    for (const l of lines.slice(i + 1)) {
      if (l.trim() !== '' && !/^\s/.test(l)) break;
      block.push(l.trim());
    }
    const joiner = rest.startsWith('>') ? ' ' : '\n';
    return block.join(joiner).trim();
  }
  return rest.replace(/^(['"])(.*)\1$/, '$2');
}

export function check(root) {
  const errors = [];
  const manifestPath = join(root, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    errors.push('.claude-plugin/plugin.json is missing');
  } else {
    const desc = JSON.parse(readFileSync(manifestPath, 'utf8')).description ?? '';
    if (desc.length > PLUGIN_DESCRIPTION_MAX) {
      errors.push(`.claude-plugin/plugin.json: description is ${desc.length} characters (max ${PLUGIN_DESCRIPTION_MAX})`);
    }
  }
  const skillsDir = join(root, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md')))
    : [];
  for (const dir of skills) {
    const rel = `skills/${dir}/SKILL.md`;
    const text = readFileSync(join(skillsDir, dir, 'SKILL.md'), 'utf8');
    if (!frontmatterField(text, 'name')) errors.push(`${rel}: name is missing`);
    const desc = frontmatterField(text, 'description');
    if (!desc) errors.push(`${rel}: description is missing`);
    else if (desc.length > SKILL_DESCRIPTION_MAX) {
      errors.push(`${rel}: description is ${desc.length} characters (max ${SKILL_DESCRIPTION_MAX})`);
    }
  }
  return { errors, skillCount: skills.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const warn = args.includes('--warn');
  const root = args.find((a) => a !== '--warn') ?? '.';
  const { errors, skillCount } = check(root);
  if (errors.length) {
    const level = warn ? 'warning' : 'error';
    for (const e of errors) console.error(`::${level}::${e}`);
    console.error(`${errors.length} upload-limit violation(s).`);
    process.exit(warn ? 0 : 1);
  }
  console.log(`Upload limits OK: plugin.json and ${skillCount} skills.`);
}
