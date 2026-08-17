# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Auto-Merge

### Auto-merge path
One of several independently gated automation lanes that arm GitHub's native auto-merge for a specific category of pull request, identified by actor identity or branch-name prefix rather than by content inspection. Each path shares the same underlying shape: verify prerequisites are configured, mint a scoped credential, arm auto-merge, then re-verify it actually armed rather than trusting a success exit code. A pull request that matches no path's condition receives no automation at all and stays an ordinary PR requiring a human to merge it — this silent-fallthrough behavior, not an error, is the failure mode when a new category of automated PR has no matching path.

### Hold-for-review label
A pull request label that is the human escape hatch for opting a specific PR out of an otherwise-automatic auto-merge path, regardless of CI status. It is read fresh on every trigger the automation responds to — including the label being added or removed on an already-open PR — so applying or removing it takes effect without requiring a new push. Its presence disarms auto-merge if it was already armed from an earlier trigger; its absence is the default, unheld state.
