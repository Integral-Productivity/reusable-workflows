# RWF-003: Enforce the no-required-auto-merge-check invariant with a scheduled sweep

## Status

Accepted — 2026-08-17

Records the decision for
[#24](https://github.com/Integral-Productivity/reusable-workflows/issues/24),
unblocked by
[#17](https://github.com/Integral-Productivity/reusable-workflows/issues/17) /
[#35](https://github.com/Integral-Productivity/reusable-workflows/pull/35).

## Context

`reusable-auto-merge.yml`'s failure contract (issues #17 / #23, see that
file's header comment) ends a credential failure **RED** rather than
swallowing it. That is safe only because of one fact: this workflow is never
a **required** status check on any consumer. A red run then never blocks a
PR — it just gets noticed.

That fact was checked once, by hand, during #17's triage: 0 of 51 consuming
repos required an auto-merge context, verified across both enforcement
mechanisms GitHub offers —

- **Repository rulesets** — `rules[].parameters.required_status_checks[].context`
  on every `target: branch` ruleset.
- **Classic branch protection** — `/branches/{default}/protection/required_status_checks`.

Two repos (`glassfrog-mcp-server`, `omnifocus-plugin-manager`) use classic
protection at all; checking only rulesets would have produced a false
all-clear for both.

A hand sweep is a point-in-time reading. Nothing stops a consumer from adding
the auto-merge job to a ruleset next week, at which point a missing
1Password token starts **blocking** every PR in that repo — the exact
outcome the "never blocks" contract exists to prevent, arriving as a latent
misconfiguration with no signal here in the repo that owns the contract.

## Decision

**A scheduled workflow (`check-auto-merge-required-status.yml`, weekly +
`workflow_dispatch`) re-runs the sweep and fails loudly on a violation.**
The check logic lives in
[`scripts/check-auto-merge-required-status.sh`](../../scripts/check-auto-merge-required-status.sh)
so it is testable and readable independent of the workflow YAML around it.

**1. Enumeration: `gh search code --owner Integral-Productivity
'reusable-auto-merge.yml'`**, not an org-wide walk of every repo's
`.github/workflows/*.yml`. This is the method the original #17 sweep used and
validated — it found all 51 known consumers, including one
(`rules-omnifocus-plugin`) a manual pass had missed.

*Known blind spot, accepted deliberately:* code search depends on GitHub's
search index being current, and it only finds a caller that references
`reusable-auto-merge.yml` **directly and by that filename** — a caller that
reaches it indirectly (for example through a local wrapper workflow this repo
doesn't itself reference) would be invisible to this method. An org-wide walk
would close that gap but at meaningfully higher cost (one API call per repo
in the org to list and fetch `.github/workflows/*`, versus one search query),
for a caller shape that does not exist today. If a consumer is ever
discovered that reaches the auto-merge job indirectly, that is the trigger to
revisit this decision — not a hypothetical to design against now.

**2. Both enforcement mechanisms are checked for every enumerated repo,
every run** — rulesets and classic branch protection. Checking only one
would have produced exactly the false all-clear the #17 sweep's hand check
avoided. An access failure on either source (as opposed to a clean "zero
rulesets" / 404-not-protected result) is recorded as a **coverage gap**, and
a coverage gap fails the run the same as a confirmed violation — a repo this
script cannot read is a repo it cannot vouch for, and reporting it as clean
would be worse than not checking it at all.

**3. The classic-protection 404 is distinguished by exit code, never by
counting `gh`'s stdout.** `gh api` writes a 404's error body to stdout on
failure; a line-count check would misread "Branch not protected" (the common,
benign case) as a required check. This was a real bug in the original hand
sweep's first pass — caught before publishing, but worth carrying forward as
an explicit design constraint rather than rediscovering it.

**4. The match is `auto.merge`, case-insensitive** (issue #24's literal
scope) — the `.` standing in for whichever separator a caller's job id uses
(`auto-merge`, `auto_merge`, `auto merge`).

**5. Cross-repo reads use the `ip-org-auditor` App**, minted the same way
`reusable-auto-merge.yml`'s `close-linked-issues` job already does (PEM at
`op://ip-org-auditor-public/ip-org-auditor/private_key`, org variable
`IP_ORG_AUDITOR_APP_CLIENT_ID`) — reusing an existing identity rather than
provisioning a new one. Both the rulesets and classic-branch-protection read
endpoints require `administration: read` on the target repo, a scope this
App is not yet confirmed to hold in every consumer beyond what its existing
`pull-requests:read` / `issues:read` usage proves. **This is an open
precondition, not a design gap**: until confirmed, the workflow fails loudly
at token mint or at the script's own gap reporting, with an actionable
message either way — consistent with how `OP_AUTOMERGE_PUBLIC_TOKEN`
(ADR-045 / ip-bots#207) shipped ahead of its own provisioning.

**6. Weekly, not daily.** The fact being checked — a human editing a
consumer's ruleset or branch protection — changes rarely. Daily would be
mostly noise; `workflow_dispatch` covers on-demand re-checks after a fix.

### Rejected alternatives

- **Only check rulesets.** Rejected: known to produce a false all-clear for
  the two classic-protection repos (context above).
- **Treat every API failure as "no required checks."** Rejected: silently
  converts an access problem into a false all-clear, which is the failure
  mode this whole check exists to prevent, just moved one level down.
- **Org-wide workflow walk instead of code search.** Rejected for now on
  cost/benefit — see the blind-spot note under decision 1. Revisit if an
  indirect caller is ever found.
- **A brand-new App scoped only to this check.** Rejected: `ip-org-auditor`
  already exists for exactly this kind of read-only, cross-repo audit
  (see its use in `reusable-auto-merge.yml`'s `close-linked-issues` job);
  minting a second identity for the same purpose adds provisioning
  surface without a corresponding safety benefit.

## Consequences

- The "never blocks a PR" contract in `reusable-auto-merge.yml`'s header
  now has an enforced check behind it, not only an assertion. That header
  comment already points here.
- A consumer that later adds the auto-merge context to a required-check list
  produces a loud, actionable failure — naming the repo and the exact
  context — within a week (or immediately via `workflow_dispatch`), rather
  than surfacing only when someone notices their PRs stopped merging.
- The check's own reliability now depends on `gh search code`'s index and on
  `ip-org-auditor` holding `administration: read` broadly enough. Both are
  named explicitly (here and in the workflow's header) rather than
  implicitly assumed, so a failure of either is diagnosable from the run's
  own output.
- Until the `administration:read` precondition is confirmed, this workflow
  is expected to fail — that failure is itself the correct signal that
  provisioning is still outstanding, not evidence the check is broken.
