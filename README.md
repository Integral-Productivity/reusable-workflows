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
