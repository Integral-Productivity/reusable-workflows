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

## Auto-merge is intentionally not here yet

`reusable-auto-merge.yml` is **not** migrated to this public host. It reads a
managed-identity App PEM from 1Password via the private `read-pem-from-1p`
composite action and routes `OP_SERVICE_ACCOUNT_TOKEN` through Actions —
migrating it to a public host is a security-surface change that needs its own
decision (host the composite action publicly + an ADR). Tracked separately;
see devops-excellence #189.
