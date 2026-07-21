# reusable-workflows

Public reusable GitHub Actions workflows for the **Integral-Productivity** org,
consumable by **public** repos (e.g. the `*-claude-plugin` repos and the plugin
`marketplace`).

## Why this repo exists

GitHub does **not** allow a public repository to call a reusable workflow stored
in a **private** or **internal** repository — the call fails at startup with a
"workflow file issue" and no jobs run. Our org's private
[`devops-excellence`](https://github.com/Integral-Productivity/devops-excellence)
repo hosts the reusable workflows that **private** repos consume, but public
repos cannot reach them. This repo is the **public** counterpart: the canonical
home for reusable workflows that public repos need.

See devops-excellence **ADR-038** for the decision and context.

## Available workflows

| Workflow | Purpose |
|---|---|
| [`validate-plugin-manifest.yml`](.github/workflows/validate-plugin-manifest.yml) | Run `claude plugin validate <manifest>` as a PR gate (auth-free, no secrets). |
| [`reusable-dependency-review.yml`](.github/workflows/reusable-dependency-review.yml) | Fail a PR if a dependency change adds a `moderate`+ vulnerability (auth-free, no secrets). |
| [`reusable-claude.yml`](.github/workflows/reusable-claude.yml) | The `@claude` on-demand bot. Needs the org secret `CLAUDE_CODE_OAUTH_TOKEN` (visibility:all). |
| [`reusable-auto-merge.yml`](.github/workflows/reusable-auto-merge.yml) | Queue `claude/*` + Dependabot (patch/minor) PRs for auto-merge. Needs the **scoped** org secret `OP_AUTOMERGE_PUBLIC_TOKEN` (read-only on the `ip-automerge` PEM only). |

### `validate-plugin-manifest.yml`

```yaml
name: Validate plugin manifest
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  validate:
    uses: Integral-Productivity/reusable-workflows/.github/workflows/validate-plugin-manifest.yml@main
    # with:
    #   manifest-path: .claude-plugin/marketplace.json   # default: .claude-plugin/plugin.json
```

| Input | Default | Description |
|---|---|---|
| `manifest-path` | `.claude-plugin/plugin.json` | Path to the manifest to validate. The marketplace repo passes `.claude-plugin/marketplace.json`. |

The caller must grant `permissions: contents: read` (reusable workflows can only
use permissions the caller grants). No secrets are needed — `claude plugin
validate` is a local, auth-free schema check.

### `reusable-dependency-review.yml`

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  dependency-review:
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: write
    uses: Integral-Productivity/reusable-workflows/.github/workflows/reusable-dependency-review.yml@main
```

Takes no secrets and references no private-repo actions, so it is fully
auth-safe for public callers. The caller grants `contents: read` +
`pull-requests: write` (the latter lets the action post its on-failure summary).

### `reusable-claude.yml`

The `@claude` on-demand bot. The caller declares the event triggers, the
`@claude` mention gate (`if:`), and a `permissions:` block mirroring the
reusable's — see the header comment in the workflow file for the verbatim
caller pattern.

```yaml
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]
jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    uses: Integral-Productivity/reusable-workflows/.github/workflows/reusable-claude.yml@main
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Needs the org secret `CLAUDE_CODE_OAUTH_TOKEN` (provisioned org-wide with
visibility:all, so it reaches public repos). References no private-repo
composite actions. `anthropics/claude-code-action@v1` gates execution on the
commenter's repo permission, so a `@claude` mention from a non-collaborator on
a public repo does not trigger a run.

### `reusable-auto-merge.yml`

Queues `claude/*` and Dependabot (patch/minor) PRs for auto-merge, minting a
GitHub App token (not `GITHUB_TOKEN`) so the merge re-triggers downstream CI.
The PEM read uses the public [`read-pem-from-1p`](.github/actions/read-pem-from-1p/action.yml)
composite action in this repo (referenced by full public path).

```yaml
name: Auto-Merge
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: write
  pull-requests: write
jobs:
  auto-merge:
    uses: Integral-Productivity/reusable-workflows/.github/workflows/reusable-auto-merge.yml@main
    secrets:
      OP_AUTOMERGE_PUBLIC_TOKEN: ${{ secrets.OP_AUTOMERGE_PUBLIC_TOKEN }}
```

**Security surface (read [devops-excellence ADR-045](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-045-route-1p-token-through-public-actions-for-auto-merge.md)).**
Unlike the auth-free reusables above, this one forwards a 1Password token to a
public runner. To keep the blast radius minimal, it forwards a **scoped**
service-account token — `OP_AUTOMERGE_PUBLIC_TOKEN`, read-only on
`op://ip-automation/ip-automerge/private_key` **alone**, not the whole vault.
A leak mints only `ip-automerge` (contents/pull_requests:write). The broad
`OP_SERVICE_ACCOUNT_TOKEN` is **never** forwarded here.

The scoped token is provisioned by
[ip-bots#207](https://github.com/Integral-Productivity/ip-bots/issues/207) (the
**precondition**). Until it lands, the secret resolves empty and the workflow
fails closed (the PEM read errors and the merge is skipped) — it never blocks a
PR. The caller also needs the `ip-automerge` App installed on its repo and the
`vars.IP_AUTOMERGE_APP_{ID,CLIENT_ID}` org variables (visibility:all). Fork PRs
receive no secrets and fall through to manual review.

Why a public copy at all: GitHub blocks a public repo from calling a private
reusable **or** a private composite action, so both the workflow and its
`read-pem-from-1p` dependency live here. Tracked in
[devops-excellence#192](https://github.com/Integral-Productivity/devops-excellence/issues/192)
(umbrella #189).

### `reusable-promote-stable.yml`

Advances a plugin repo's `stable` branch to a tagged release commit by a
**fast-forward push authenticating as the `ip-releaser` App**. The internal
marketplace tracks `stable`, so pushing a `vX.Y.Z` tag is what publishes a
release to users. The PEM read uses the same public
[`read-pem-from-1p`](.github/actions/read-pem-from-1p/action.yml) composite
action as auto-merge.

```yaml
name: Promote to stable
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']   # pre-release suffixes excluded
jobs:
  promote:
    uses: Integral-Productivity/reusable-workflows/.github/workflows/reusable-promote-stable.yml@main
    secrets:
      OP_RELEASER_PUBLIC_TOKEN: ${{ secrets.OP_RELEASER_PUBLIC_TOKEN }}
```

**Security surface (read [devops-excellence ADR-064](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-064-protected-but-app-bypassable-stable-for-plugin-repos.md)).**
`stable` is protected by an org ruleset (require-PR + non-fast-forward) that
lists `ip-releaser` as a bypass actor, so the push must be made **as that App** —
the default `GITHUB_TOKEN` is declined (`GH006`). Like auto-merge, this forwards
a **scoped** service-account token — `OP_RELEASER_PUBLIC_TOKEN`, read-only on
`op://ip-automation-public/ip-releaser/private_key` **alone**, not the whole
vault. A leak mints only `ip-releaser` (contents:write); `OP_SERVICE_ACCOUNT_TOKEN`
is **never** forwarded here (the scoping rationale mirrors
[ADR-045](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-045-route-1p-token-through-public-actions-for-auto-merge.md)).

**Unlike auto-merge, promote-stable hard-fails.** A missing token, unreadable
PEM, or tag-↔-manifest version mismatch fails the job loudly and leaves `stable`
untouched — a silent no-op would ship a stale release to marketplace users. The
push is fast-forward only (no `--force`); `stable` is never rewound.

Preconditions: the `OP_RELEASER_PUBLIC_TOKEN` scoped token (provisioned), the
`vars.IP_RELEASER_APP_{ID,CLIENT_ID}` org variables (visibility:all), and
`ip-releaser` installed on the target repo with `contents:write`. Standardization
tracked in
[devops-excellence#415](https://github.com/Integral-Productivity/devops-excellence/issues/415).
