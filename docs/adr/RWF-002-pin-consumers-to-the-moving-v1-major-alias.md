# RWF-002: Pin consumers to the moving `@v1` major alias, not `@main`

## Status

Accepted — 2026-07-20 (backfilled as an ADR 2026-08-06)

Implements the org-wide convention decided in devops-excellence
[**ADR-046**](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-046-semver-tags-for-reusables.md)
(semver tags for reusables), whose Scope section explicitly deferred this public
sibling to "a separate record for that repo." **This ADR is that record.**
ADR-046 remains the org-wide standard; this document covers only what is local
to hosting these reusables.

Shipped in [#9](https://github.com/Integral-Productivity/reusable-workflows/issues/9)
/ [#10](https://github.com/Integral-Productivity/reusable-workflows/pull/10)
(merge `3566b22`, 2026-07-20). Backfilled from README prose into an ADR by
[#22](https://github.com/Integral-Productivity/reusable-workflows/issues/22),
per [RWF-001](RWF-001-record-architecture-decisions-with-the-rwf-prefix.md)
clause 4 (versioning and release of this repo's units is local scope).

## Context

Consumers of this repo — the `*-claude-plugin` repos, the plugin `marketplace`,
and others — reference its workflows by a cross-repo ref:

```yaml
uses: Integral-Productivity/reusable-workflows/.github/workflows/<name>.yml@<ref>
```

Callers originally pinned `@main`. That ref is *moving* and *cross-repo*, which
is a bad combination for this repo specifically:

- A rename, removal, or incompatible input/secret change to any unit here breaks
  **every** caller the instant it merges — no PR in the consumer repo, no review,
  no staged rollout.
- Many of these callers are **scheduled or post-merge** jobs. There is often no
  human watching when they break, so the breakage is discovered late.
- The blast radius is wide and growing: this is the *public host*, so it is the
  only reachable copy for public repos (see devops-excellence
  [ADR-038](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-038-validate-plugin-manifests-in-ci.md)),
  which concentrates consumers rather than spreading them.

`@main` does have one genuinely good property: non-breaking fixes reach callers
automatically, with no consumer-side bump. Pinning every caller to an immutable
`@vX.Y.Z` would retire the fragility but also retire that property, converting
each security or reliability fix into an N-repo update campaign.

## Decision

**Consumers pin the moving major alias `@v1`.**

```yaml
uses: Integral-Productivity/reusable-workflows/.github/workflows/<name>.yml@v1
```

`@v1` keeps the good property of `@main` — non-breaking fixes flow automatically
— without the fragility, because a breaking change ships as `v2` and leaves `@v1`
callers on the last `v1.x` behaviour until they adopt it deliberately.

**The major is repo-wide, not per-unit.** One major tag covers all reusable
workflows *and* the `read-pem-from-1p` composite action — the `actions/checkout@v4`
mental model: one tag to keep moving, not one per unit.

- A breaking change to **any** unit — rename, removal, or incompatible
  input/secret change — is a **major** bump (`v2`).
- A backward-compatible fix or addition is a **minor/patch** bump, auto-inherited
  by `@v1` callers.

**Which ref a caller pins is a deliberate choice**, with `@v1` as the default:

| Pin | Behaviour | Use when |
|---|---|---|
| `@v1` | Moving major — always the latest `v1.x.y`. **Default.** | Almost always. |
| `@v1.2.3` | Immutable exact release. | Reproducibility-critical callers that bump deliberately. |
| `@<full-sha>` | Immutable commit; ignores all tag movement. | Supply-chain-hardened callers. |

`@main` is not an option for new callers — it is the fragility this decision
exists to retire.

**Release is human-triggered; alias movement is automated.** A human publishes a
GitHub Release tagged `vX.Y.Z` from `main`;
[`major-tag-mover.yml`](../../.github/workflows/major-tag-mover.yml) fires on
`release: published` and fast-forwards the moving major (`vX`) to that commit,
using `git` + `GITHUB_TOKEN` only — no marketplace action, per devops-excellence
[ADR-012](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-012-actions-allow-list-policy.md).
The human chooses *when* to cut a release; the drift-prone step (moving the
alias) is the automated one.

### Rejected alternatives

- **Keep `@main`.** Rejected: unreviewed instant breakage across every consumer,
  with unwatched scheduled jobs as the discovery mechanism.
- **Immutable `@vX.Y.Z` everywhere, no moving alias.** Rejected: turns every
  non-breaking fix into an N-repo bump campaign, which in practice means fixes do
  not propagate. Still available per-caller for reproducibility-critical
  consumers (see the table).
- **A major tag per unit** (`validate-plugin-manifest-v1`, …). Rejected: more
  tags to maintain than the repo's change rate justifies, and it diverges from
  the `actions/checkout@v4` model consumers already understand.

## Consequences

- Callers inherit non-breaking fixes with no action, and are insulated from
  breaking ones until they move to `@v2`.
- **The moving major is a mutable ref** — an inherent `@vN` supply-chain
  consideration, the same one `actions/checkout@v4` carries. Callers needing
  immutability pin `@v1.2.3` or a full SHA.
- Repo-wide majors mean a breaking change to **one** unit bumps the major for
  **all** of them. Callers of untouched units see a `v2` that is a no-op for
  them. This is accepted as the cost of a single tag.
- Cutting a release is a deliberate human act. A fix merged to `main` does not
  reach `@v1` callers until someone publishes a release.
- `v1.0.0` and the moving `v1` alias were cut at `3566b22` (2026-07-20).
  Migrating existing `@main` callers is tracked in
  [#11](https://github.com/Integral-Productivity/reusable-workflows/issues/11);
  pinning the tier-3 caller templates so new plugin repos default to `@v1` is
  tracked in
  [devops-excellence#433](https://github.com/Integral-Productivity/devops-excellence/issues/433).
