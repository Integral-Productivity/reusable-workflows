# RWF-006: Release on every merge to `main`

## Status

Accepted — 2026-10-23. Amends the release clause of
[RWF-002](RWF-002-pin-consumers-to-the-moving-v1-major-alias.md) ("Release is
human-triggered; alias movement is automated"). The `@v1` pin, and the rest of
RWF-002, stay as they are.

The owner chose "Release on every merge" over a release PR (release-please) on
2026-10-23.

## Context

RWF-002 made a release a deliberate human act: someone publishes a GitHub
Release `vX.Y.Z`, and `major-tag-mover.yml` moves `v1`. In practice that human
step became a chore that only the owner can do, and it was forgotten. On
2026-10-23, #65 and #66 were merged but `v1` still pointed at `v1.4.0`, so the
merged code could not run in any caller.

Every PR in this repo already has two gates before it merges: the required
`actionlint` CI job (which also runs the script tests) and the owner's review.
The release step adds a third click, and no new information, because it
releases what was already reviewed.

A release made with `GITHUB_TOKEN` starts no other workflow, so automation
must publish with a GitHub App token for `major-tag-mover.yml` to run.

## Decision

1. `release-on-merge.yml` runs on every push to `main` (and by hand). It runs
   the script tests again, computes the next version with
   `scripts/next-release.mjs`, and publishes the GitHub Release with an
   `ip-releaser` App token. `major-tag-mover.yml` then moves the major tag, as
   before.
2. The version comes from Conventional Commits since the last `vX.Y.Z` tag:
   - a `type!:` subject or a `BREAKING CHANGE:` footer: major;
   - any `feat`: minor;
   - anything else that changes a non-Markdown file: patch, because a `ci:` or
     `chore:` change to a reusable workflow still changes what callers run;
   - Markdown only: no release.
3. The merge is the release gate. Nobody picks a version or a time by hand.

## Consequences

- A merged fix reaches every `@v1` caller within minutes, with no human step.
  The cost is the one RWF-002 named: an unsafe merge also reaches every caller
  within minutes. The PR review and CI remain the only protection, so they
  must stay required.
- A breaking change makes `v2.0.0`. `major-tag-mover.yml` then creates `v2`,
  and no `@v1` caller receives it. Callers move to `@v2` on purpose.
- Releases can no longer be batched. Callers that want to adopt changes on
  their own schedule pin `@v1.2.3` or a SHA, as RWF-002's table already says.
- A wrong commit type gives a wrong bump. The commit subject is the PR title
  (squash merge), so the title is now part of the release contract.
- The workflow needs `OP_RELEASER_PUBLIC_TOKEN` (scoped to the
  `ip-automation-public` vault) and the org variable
  `IP_RELEASER_APP_CLIENT_ID`. If either is missing, the release step fails
  loudly; it never falls back to `GITHUB_TOKEN`.

## Rejected

- **Keep releasing by hand (RWF-002 as written).** It failed in practice:
  merged code sat unreleased.
- **A release PR (release-please).** It batches changes and writes a
  changelog, but it brings the extra click back. It stays the better choice if
  the owner wants to choose when callers get a change.
