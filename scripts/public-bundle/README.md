# public-bundle

Scripts behind the planned `reusable-public-bundle.yml` workflow: copy a plugin
release classified `public` into a public catalog (`marketplace` or
`marketplace-labs-public`) as a folder, after a privacy check.
Design: `marketplace` ADR 0002 (public plugin copies live in catalog folders).

| Script | Status | Job |
|---|---|---|
| `classification.mjs` | done | Decide public or private from `.github/plugin-distribution.yml` |
| `build.mjs`, `check.mjs` | planned | Build the allowlisted copy; fail closed on any leak |
| `publish.mjs`, `catalog.mjs` | planned | Open the catalog PR; regenerate `marketplace.json` |

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
