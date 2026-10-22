#!/usr/bin/env node
// Turns a list of Client names into the hashed denylist that check.mjs reads
// from the PUBLIC_BUNDLE_DENYLIST secret. Run it on the operator's machine
// only; the plain list never goes to a repo, a log or CI.
//
//   PUBLIC_BUNDLE_DENYLIST_KEY=... node denylist-build.mjs < names.txt
//
// Input: one name per line; blank lines and lines starting with # are skipped.
// Output (stdout): {"built":"YYYY-MM-DD","entries":[[spaced,joined],...]}.
// Store the output as PUBLIC_BUNDLE_DENYLIST and the key as
// PUBLIC_BUNDLE_DENYLIST_KEY. check.mjs fails a list older than 30 days, so
// rebuild it at least monthly. Errors name an entry by its number, never by
// its text.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hmac, MAX_WORDS, tokens } from './patterns.mjs';

export function buildDenylist(names, key, built) {
  if (!key) throw new Error('the denylist key is empty');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(built)) throw new Error('built must be an ISO date');
  const entries = names.map((name, i) => {
    const t = tokens(name);
    if (t.length === 0) throw new Error(`entry ${i + 1} has no words`);
    if (t.length > MAX_WORDS) throw new Error(`entry ${i + 1} has ${t.length} words; the check matches at most ${MAX_WORDS}`);
    return [hmac(key, t.join(' ')), hmac(key, t.join(''))];
  });
  return { built, entries };
}

function main() {
  const names = readFileSync(0, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  try {
    const out = buildDenylist(names, process.env.PUBLIC_BUNDLE_DENYLIST_KEY ?? '', new Date().toISOString().slice(0, 10));
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`denylist-build: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
