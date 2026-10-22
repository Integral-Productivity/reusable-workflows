# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Auto-Merge

### Auto-merge path
One of several independently gated automation lanes that arm GitHub's native auto-merge for a specific category of pull request, identified by actor identity or branch-name prefix rather than by content inspection. Each path shares the same underlying shape: verify prerequisites are configured, mint a scoped credential, arm auto-merge, then re-verify it actually armed rather than trusting a success exit code. A pull request that matches no path's condition receives no automation at all and stays an ordinary PR requiring a human to merge it — this silent-fallthrough behavior, not an error, is the failure mode when a new category of automated PR has no matching path.

### Hold-for-review label
A pull request label that is the human escape hatch for opting a specific PR out of an otherwise-automatic auto-merge path, regardless of CI status. It is read fresh on every trigger the automation responds to — including the label being added or removed on an already-open PR — so applying or removing it takes effect without requiring a new push. Its presence disarms auto-merge if it was already armed from an earlier trigger; its absence is the default, unheld state.

## Public bundles

### Public bundle
The allowlisted copy of one tagged release of a private plugin repo, holding only the files Claude needs to install and run the plugin, which is what a public catalog receives in place of the private source. It is built from the release's tree with no history, and it exists only when the plugin's classification is public both at the tag and on the default branch.

### Privacy check
The fail-closed scan that a public bundle must pass before it leaves the private repo, looking for secrets, personal data, Client names, internal locators and confidential markers. It reports where a finding is and which kind it is, never the matched text, and it fails when any input it needs is missing or out of date rather than passing on partial evidence.

### Internal locator
A link or path that points at one private place, such as a specific document, folder, CRM record, hosted project or person's home directory, and so must not appear in a public bundle. It is detected wherever it appears in text, with or without a scheme, and, where the host is a fixed name, matched on the exact host in any case, so that a look-alike host does not count.
