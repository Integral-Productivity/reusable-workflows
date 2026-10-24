# public-bundle

Scripts behind the `reusable-public-bundle.yml` workflow: copy a plugin
release classified `public` into a public catalog (`marketplace` or
`marketplace-labs-public`) as a folder, after a privacy check.
Design: `marketplace` ADR 0002 (public plugin copies live in catalog folders).

| Script | Status | Job |
|---|---|---|
| `classification.mjs` | done | Decide public or private from `.github/plugin-distribution.yml` |
| `build.mjs` | done | Build the allowlisted copy from `git archive`; fail closed on a symlink, a missing licence, a broken `${CLAUDE_PLUGIN_ROOT}` reference or an upload limit |
| `check.mjs`, `patterns.mjs` | done | Privacy check over the copy (L1 secrets, L2 email and phone, L3 hashed name denylist, L4 internal locators, L5 confidential markers); fail closed |
| `denylist-build.mjs` | done | Operator-only: turn a name list into the hashed denylist secret |
| `catalog.mjs` | done | Regenerate a catalog's `marketplace.json` from its `plugins/<name>/` folders, keeping entries with other sources |
| `publish.mjs` | done | Put a checked copy into a catalog checkout with its receipt, take one out, or find the folders a source repo published |
| `integrity.mjs` | done | Audit a public catalog: every folder has a passing receipt for its version, its digest matches, and `marketplace.json` matches the folders; other sources only warn. Weekly, list folders whose source is no longer public for this catalog |

## The classification file

Each plugin repo declares its classification in `.github/plugin-distribution.yml`.
A repo without the file is private.

```yaml
classification: public        # or: private
owner: Product Engineering    # role accountable for this classification
reviewed: 2026-10-22          # ISO date of the last review
catalog: labs                 # core = marketplace, labs = marketplace-labs-public
include:                      # optional: extra paths the plugin needs at run time
  - lib/
```

A release is copied only when the file says `public`, with all of `owner`,
`reviewed` and `catalog`, both at the tagged commit and on the default branch.
So a tag cut before a change to `private` cannot publish. Any other content,
including a typo in a key, reads as private with a reason.
`plugin-distribution.schema.json` gives editors completion for the same rules.

Run the tests with `node --test 'scripts/public-bundle/*.test.mjs'`.

## The privacy check

`check.mjs <copy-dir> [--gitleaks <bin>]` reads two secrets from the environment:

- `PUBLIC_BUNDLE_DENYLIST`: the JSON that `denylist-build.mjs` prints.
- `PUBLIC_BUNDLE_DENYLIST_KEY`: the HMAC key used to build it.

A report names file, line, layer and a fixed detail. It never prints the matched
text. The check fails when a secret is missing, when the denylist was built more
than 30 whole UTC days ago, or when any file cannot be read. Rebuild the denylist
at least monthly, on the operator's machine only:

```bash
PUBLIC_BUNDLE_DENYLIST_KEY=... node denylist-build.mjs < names.txt
```

## The publish workflow

`.github/workflows/reusable-public-bundle.yml` runs these scripts in order. A
plugin repo calls it from a thin caller; the workflow header holds the caller
and the rules for each job.

- A copy is built and checked inside the private repo's run. Only a copy that
  passed is pushed, because a branch in a public repo is public once pushed.
- A plugin's first publish opens a `publish/<name>-v<version>` pull request,
  which does not auto-merge: the owner reviews the first copy by hand. A later
  version uses `claude/publish-<name>-v<version>` and auto-merges.
- Each folder carries `.publish-receipt.json`: source repo, version, source
  commit, tag time, check version, check result and a SHA-256 digest of the
  folder. The catalog integrity check reads it.
- A held copy opens or updates one issue in the source repo, titled
  `Public copy held: <tag>`.
- Run it by hand with `dry-run: true` to see the planned catalog diff without
  pushing anything.

## The catalog integrity workflow

`.github/workflows/reusable-catalog-integrity.yml` runs `integrity.mjs` in each
catalog on every pull request, every push to `main` and weekly. The private
catalogs use `catalog: private`, which runs the audit only. On a public catalog the
weekly run also opens a removal pull request for reclassified plugins. A source repo it
cannot read is never removed; the run fails instead. The workflow header holds the
caller.
