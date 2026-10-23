import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpFor, decide, highest, next } from './next-release.mjs';

const YML = ['.github/workflows/reusable-demo.yml'];

test('a feat commit is a minor release', () => {
  assert.equal(bumpFor({ messages: ['fix: a', 'feat(demo): b'], files: YML }), 'minor');
});

test('a fix, ci or chore commit that changes a workflow is a patch release', () => {
  for (const m of ['fix: a', 'ci: a', 'chore(deps): a', 'not conventional at all']) {
    assert.equal(bumpFor({ messages: [m], files: YML }), 'patch', m);
  }
});

test('a bang subject or a BREAKING CHANGE footer is a major release', () => {
  assert.equal(bumpFor({ messages: ['feat(demo)!: drop an input'], files: YML }), 'major');
  assert.equal(bumpFor({ messages: ['fix: a\n\nBREAKING CHANGE: input renamed'], files: YML }), 'major');
});

test('the words breaking change in a body line that is not a footer do not count', () => {
  assert.equal(bumpFor({ messages: ['fix: a\n\nThis is not a BREAKING CHANGE: just prose'], files: YML }), 'patch');
});

test('a merge that changes only Markdown is no release, even when it is a feat', () => {
  assert.equal(bumpFor({ messages: ['docs: a'], files: ['README.md', 'docs/adr/RWF-009.md'] }), 'none');
  assert.equal(bumpFor({ messages: ['feat!: a'], files: ['README.md'] }), 'none');
});

test('next computes the version and resets lower parts', () => {
  assert.equal(next('v1.4.0', 'minor'), 'v1.5.0');
  assert.equal(next('v1.4.2', 'patch'), 'v1.4.3');
  assert.equal(next('v1.4.2', 'major'), 'v2.0.0');
  assert.equal(next('v1.4.2', 'none'), 'v1.4.2');
  assert.throws(() => next('v1', 'patch'), /not a vX.Y.Z tag/);
});

test('highest ignores the moving major tag and sorts by number, not text', () => {
  assert.equal(highest(['v1', 'v1.9.0', 'v1.10.0', 'v1.2.3', 'stable', '']), 'v1.10.0');
  assert.equal(highest(['v1']), undefined);
});

test('decide reports the release that the merges since v1.4.0 need', () => {
  const messages = ['fix(public-bundle): match Vercel links by exact host', 'feat(public-bundle): add the reusable publish workflow'];
  assert.deepEqual(decide({ previous: 'v1.4.0', messages, files: YML }), { release: true, version: 'v1.5.0', previous: 'v1.4.0', bump: 'minor' });
  assert.deepEqual(decide({ previous: 'v1.5.0', messages: ['docs: a'], files: ['README.md'] }), { release: false, version: 'v1.5.0', previous: 'v1.5.0', bump: 'none' });
});
