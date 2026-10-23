#!/usr/bin/env node
// Decides the next release of this repo from the commits merged since the
// last vX.Y.Z tag (RWF-006). release-on-merge.yml runs it on every push to
// main; nobody picks a version by hand.
//
// Rules, read from Conventional Commit subjects and bodies:
//   major  a `type!:` subject or a `BREAKING CHANGE:` footer. This makes a v2
//          tag, so callers pinned to @v1 do not receive it.
//   minor  any `feat` commit.
//   patch  anything else that changes a file other than Markdown. A `ci:` or
//          `chore:` change to a reusable workflow still changes what callers
//          run, so it still releases.
//   none   the merge changed only Markdown files, whatever its commit types.
//
// Usage: node next-release.mjs [--repo <dir>] [--ref <ref>]
// Prints {"release":bool,"version":"vX.Y.Z","previous":"vX.Y.Z","bump":"..."}
// and exits 0. Exits 1 when no vX.Y.Z tag is reachable from the ref.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function bumpFor({ messages, files }) {
  if (!files.some((f) => !/\.md$/i.test(f))) return 'none';
  let bump = 'patch';
  for (const message of messages) {
    const subject = message.split('\n', 1)[0];
    if (/^\w+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(message)) return 'major';
    if (/^feat(\([^)]*\))?:/.test(subject)) bump = 'minor';
  }
  return bump;
}

export function next(previous, bump) {
  const m = previous.match(TAG);
  if (!m) throw new Error(`${previous} is not a vX.Y.Z tag`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (bump === 'major') return `v${major + 1}.0.0`;
  if (bump === 'minor') return `v${major}.${minor + 1}.0`;
  if (bump === 'patch') return `v${major}.${minor}.${patch + 1}`;
  return previous;
}

export function decide({ previous, messages, files }) {
  const bump = bumpFor({ messages, files });
  return { release: bump !== 'none', version: next(previous, bump), previous, bump };
}

export const highest = (tags) =>
  tags
    .filter((t) => TAG.test(t))
    .sort((a, b) => {
      const [x, y] = [a, b].map((t) => t.match(TAG).slice(1).map(Number));
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];

function git(repo, ...args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout;
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  const repo = a.repo ?? '.';
  const ref = a.ref ?? 'HEAD';
  const previous = highest(git(repo, 'tag', '--merged', ref).split('\n'));
  if (!previous) {
    process.stderr.write(`no vX.Y.Z tag is reachable from ${ref}\n`);
    return 1;
  }
  const range = `${previous}..${ref}`;
  const messages = git(repo, 'log', '--format=%B%x00', range).split('\0').map((m) => m.trim()).filter(Boolean);
  const files = git(repo, 'diff', '--name-only', range).split('\n').filter(Boolean);
  process.stdout.write(`${JSON.stringify(decide({ previous, messages, files }))}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
