---
title: Policy Checklist for Adding a New Auto-Merge Path to reusable-auto-merge.yml
date: 2026-08-17
category: conventions
module: auto-merge
problem_type: convention
component: infrastructure
severity: high
applies_when:
  - "Extending reusable-auto-merge.yml with a new auto-merge path for a new bot/branch pattern"
  - "Deciding whether a new automation path should auto-merge on green, warn, or require an opt-in"
  - "A code-review persona re-raises a policy tradeoff the repo owner already explicitly decided"
symptoms:
  - "A PR class (e.g. release-please) matches none of the existing auto-merge job conditions and sits unmerged indefinitely"
  - "An adversarial/security review flags a branch-prefix-only match as insufficient identity verification"
  - "A diff-scoped security bot cites a line number for a finding that may predate the PR"
root_cause: "reusable-auto-merge.yml's auto-merge jobs are matched by explicit branch-prefix/actor conditions with no catch-all; a new PR-producing bot (release-please) had no matching job, so its PRs never entered the auto-merge path despite being routine, low-risk release PRs -- this went unnoticed for 30+ days because the failure mode is silent (PR just sits open) rather than erroring."
resolution_type: workflow_improvement
tags:
  - auto-merge
  - release-please
  - github-actions
  - reusable-workflow
  - policy-decision
  - settled-conflict
  - code-review
  - branch-prefix-gate
related_components:
  - reusable-auto-merge.yml
---

# Policy Checklist for Adding a New Auto-Merge Path to reusable-auto-merge.yml

## Context

`reusable-auto-merge.yml` is a public reusable workflow in `Integral-Productivity/reusable-workflows`, consumed by roughly 51 downstream repos org-wide (mostly `*-claude-plugin` repos). Before PR #41, the file had exactly two paths that could arm auto-merge: `dependabot[bot]` PRs (job `dependabot`, `.github/workflows/reusable-auto-merge.yml:154`) and Claude-authored branches (job `claude-branches`, gated on `startsWith(github.head_ref, 'claude/')` at `.github/workflows/reusable-auto-merge.yml:297`). Release-please PRs — the automated release/version-bump PRs that publish a new version to the internal marketplace — matched neither path and so sat as ordinary PRs requiring a human to notice and merge them.

GitHub Issue #12 reported this gap with a concrete, already-realized cost: a release-please PR in the sibling repo `holacracy-claude-plugin` sat open for over 30 days. During that window, 5 shipped features never reached any consumer, because the published `stable` version never advanced. The stall got bad enough that downstream engineers started hand-bumping a version file directly as a workaround — creating a second source of truth that the eventually-merged release PR would then have silently reverted, a real regression tracked in its own separate issue with its own ADR.

The issue's author explicitly labeled it `ready-for-human` rather than just filing it as ready-to-implement. The reason wasn't implementation difficulty — mirroring an existing job is straightforward — it was that closing the gap required three real policy decisions with consequences beyond this one file:

1. Should release-please PRs auto-merge unattended at all, given that merging one publishes to an internal marketplace with zero human review in the loop?
2. This is a shared reusable workflow used by ~51 repos. Should the new behavior roll out to all of them at once, or be opt-in per consumer via a new `workflow_call` input?
3. Should the new job add a defense-in-depth check on the PR author's identity — mirroring how the `dependabot` job checks `github.event.pull_request.user.login == 'dependabot[bot]'` at `.github/workflows/reusable-auto-merge.yml:154` — or rely on branch-prefix matching alone?

## Guidance

**The reusable pattern: run a three-question policy checklist before adding any new auto-merge path to a shared reusable workflow, and get the answers from the human, not by guessing.**

| # | Question | Answer (owner's decision) | Reasoning |
|---|---|---|---|
| 1 | Should this path auto-merge unattended? | Yes, on green — consistent with the existing paths | Matches the repo's existing trunk-based-release posture; `dependabot` and `claude-branches` already do this |
| 2 | Blanket rollout across all ~51 consumers, or opt-in via a new `workflow_call` input? | Blanket rollout, no opt-in input | No per-consumer toggle exists for `dependabot` or `claude-branches` today, so adding one only for the third path is an inconsistent design — and an opt-in nobody actually flips doesn't close the gap issue #12 describes |
| 3 | Add a PR-author identity check (mirroring `dependabot[bot]`) as defense-in-depth? | No — branch-prefix match only | The repo cannot verify which bot/App identity actually opens release-please PRs across all ~51 consumer repos; release-please's committer varies by configuration. A wrong hard-coded login check is a silent, permanent false-negative — worse than the accepted risk of trusting the branch prefix alone |

The load-bearing principle is #3: **a wrong hard-coded check is worse than no check.** When you cannot verify from the repo in front of you that an identity check will actually match real traffic across every consumer, adding that check doesn't add defense in depth — it silently and permanently disables the feature the moment the guessed identity turns out to be wrong, and that failure mode never announces itself.

**Implementation pattern: mirror the existing job structurally; change only the gate.** The new `release-please-branches` job (`.github/workflows/reusable-auto-merge.yml:433-561`) is a close structural copy of `claude-branches` (`.github/workflows/reusable-auto-merge.yml:290-431`):

- Same `hold_check` step reading the `hold-for-review` label as a human escape hatch (`release-please-branches` at `:442-456`; `claude-branches` at `:299-318`)
- Same `app_id_check` -> PEM-read -> App-token-mint chain, minting the `ip-automerge` GitHub App token via a 1Password-sourced PEM (`:458-514`, mirroring `:320-376`), with `continue-on-error: true` on the PEM/token steps plus explicit `!cancelled()`-gated assert steps (e.g. `:491-496`) so a silently skipped step can't slip through as a green run — the failure mode the file's header comment (`.github/workflows/reusable-auto-merge.yml:85-117`) says was fixed by issues #17 and #23
- Same squash-merge-then-re-verify pattern: `gh pr merge --auto --squash` followed by re-reading the PR via `gh pr view --json state,autoMergeRequest` to confirm auto-merge actually armed (`:532-551`, mirroring `:396-415`), because `gh pr merge --auto` can report success while arming nothing (documented at `:100-101` and `:272-274`)
- Same `Disarm auto-merge for a held PR` step (`:553-561`, mirroring `:417-431`)

The only substantive difference is the job-level `if:` gate. Where `claude-branches` uses `startsWith(github.head_ref, 'claude/')` (`:297`), `release-please-branches` uses `startsWith(github.head_ref, 'release-please--')` (`:440`, double-dash) — a prefix match, not an exact one, because release-please derives its branch name from its own `branch` + `package-name` config and so it varies per repo (documented in the file's header comment at `:15-21`). No PR-author check and no new `workflow_call` input were added, per the owner's answers to questions 2 and 3 above.

## Why This Matters

**The stakes are real, not hypothetical.** Merging a release-please PR publishes to an internal marketplace with no human review in the loop — that's the thing question #1 was actually asking. And because this is a *reusable* workflow, whatever gets shipped here applies at once across ~51 consumer repos — a mistake in the gate condition, or a wrong identity check, has that same blast radius. Issue #12's own cited cost (a 30+ day stall, 5 features stuck unpublished, and a version-file workaround that the eventual merge silently reverted) is what happens when this gap is left open; it is also a preview of what a *wrong* fix could cause at scale if it silently failed to fire.

**Review-triage principle: a reviewer re-deriving a settled decision from first principles is evidence to preserve, not automatically a blocker.** After implementation, a multi-persona code review (correctness, testing, reliability, security, adversarial, plus an independent validator subagent) ran blind to the policy discussion above. Four of five reviewers came back clean. The adversarial reviewer, reasoning only from the shipped code, independently re-derived policy decision #3 and flagged it P0: any PR whose branch merely starts with `release-please--` arms zero-review auto-merge, with nothing verifying it actually came from release-please. A follow-up validator subagent confirmed this was factually accurate against the code — not a false positive. But accuracy about the code is not the same question as whether it's news: this finding restated a tradeoff the human owner had already explicitly considered and chosen, with the specific reasoning already given (a wrong hard-coded identity check is worse than no check). The resolution was to document it as an accepted, visible residual risk in the PR description — neither silently dropped (the evidence stays visible) nor treated as a blocker that would silently reverse a decision that wasn't the reviewer's to make. An automated reviewer with no visibility into a session's prior decisions will sometimes re-derive a question that was already asked and answered; the right response preserves the finding as documented evidence without treating it as new information requiring action.

**A related but separate lesson: a security bot's line-numbered PR comment needs base-branch verification before you assume it's new.** GitHub's CodeQL/Advanced-Security bot posted a comment on the PR flagging `read-pem-from-1p@main` — referenced by moving branch name rather than a pinned SHA — as an "Unpinned tag for a non-immutable Action," citing a specific line. Because the comment arrived as a comment *on* the PR, the natural first read is that the PR introduced the problem. The correct verification step instead was `git show main:<path> | grep -n <pattern>` — diffing the exact flagged line against the pre-PR `main`. That confirmed the unpinned `@main` reference already existed on `main`, at the same pre-shift content, before this PR touched the file; the PR only moved its position by inserting roughly 140 new lines above it. The same unpinned-`@main` pattern exists at the `read-pem-from-1p` call sites in all three auto-merge jobs (`.github/workflows/reusable-auto-merge.yml:188`, `:348`, `:486`) plus the one in `close-linked-issues` (`:608`, `:803`) — all pre-existing, not introduced by PR #41. A diff-scoped bot's comment can cite a line number without implying the flagged code is new.

## When to Apply

- Whenever extending `reusable-auto-merge.yml` — or any other shared reusable workflow — with a new branch-gated (or otherwise conditionally-gated) auto-merge path: run the three-question policy checklist (unattended-merge risk, blanket-vs-opt-in rollout, identity-check feasibility) with the human before writing the job, and prefer mirroring the nearest existing job's structure over inventing new failure-handling logic.
- Whenever an automated code reviewer (adversarial persona, security scanner, or otherwise) flags something that contradicts or restates a decision already made explicitly earlier in the same session: check whether the finding is factually accurate (it may well be) before deciding whether it's actionable — if the tradeoff was already chosen with reasoning, document the finding as an accepted risk rather than reopening or silently dropping it.
- Whenever a security-scanning bot (CodeQL, Advanced Security, or similar) comments on a PR with a specific file/line citation: verify against the base branch (`git show <base>:<path>`) before treating the flagged code as newly introduced — either to fix it in scope or to dismiss it as pre-existing noise with a factual reply.

## Examples

**The new job's gate, verbatim, contrasted with the job it mirrors:**

```yaml
# claude-branches (.github/workflows/reusable-auto-merge.yml:290-297)
claude-branches:
    name: Auto-merge claude/* branches
    runs-on: ubuntu-latest
    if: startsWith(github.head_ref, 'claude/') && github.event.action != 'closed'

# release-please-branches (.github/workflows/reusable-auto-merge.yml:433-440)
release-please-branches:
    name: Auto-merge release-please branches
    runs-on: ubuntu-latest
    # Prefix match (not exact) — see the header comment for why. Otherwise
    # identical structure to claude-branches, including the same
    # `github.event.action != 'closed'` exclusion (see the Dependabot job's
    # comment for why that guard is needed).
    if: startsWith(github.head_ref, 'release-please--') && github.event.action != 'closed'
```

Contrasted with the `dependabot` job's actor-identity gate — the pattern issue #12 raised and the owner declined to replicate for `release-please-branches`:

```yaml
# dependabot (.github/workflows/reusable-auto-merge.yml:154)
if: github.event.pull_request.user.login == 'dependabot[bot]' && github.event.action != 'closed'
```

**The three-question / three-answer policy checklist** (repeated from Guidance for reference):

| # | Question | Answer | Why |
|---|---|---|---|
| 1 | Auto-merge unattended? | Yes, on green | Consistent with existing `dependabot` / `claude-branches` posture |
| 2 | Blanket rollout or opt-in input? | Blanket, no opt-in | No existing path has a toggle; an unused opt-in doesn't close the gap |
| 3 | Add PR-author identity check? | No — branch prefix only | Can't verify the real committer identity across ~51 consumers; a wrong hard-coded check is a silent, permanent false-negative, worse than no check |

**The CodeQL base-branch verification command** that resolved the false-attribution concern (confirming `read-pem-from-1p@main` at `.github/workflows/reusable-auto-merge.yml:188`/`:348`/`:486`/`:608`/`:803` was pre-existing, not introduced by PR #41):

```bash
git show main:.github/workflows/reusable-auto-merge.yml | grep -n 'read-pem-from-1p@main'
```

Comparing that output against the flagged line in the PR diff showed the same unpinned `@main` reference at the same underlying content, merely shifted down by the ~140 lines PR #41 inserted above it — evidence the finding was correct about the *code* but not about the *PR*.

## Related

- Issue #12 — origin issue this doc addresses (closed by PR #41): reports the release-please auto-merge gap and raises the three policy questions this checklist is built from.
- PR #41 — the merged fix. Primary source for this doc: its description names the three confirmed policy calls, the adversarial P0 finding and its resolution, and the mirror-the-existing-job implementation pattern.
- PR #40 — prior art for the `hold-for-review` label escape hatch that `release-please-branches` reuses verbatim from `claude-branches`.
- Issue #29 (open) — proposes recording the auto-merge "never blocks" contract as a durable ADR under the `RWF-NNN` prefix. Same underlying theme as this doc (an undocumented policy decision gets re-derived from scratch later) at a broader, file-level scope rather than this doc's narrower "adding a new path" scope.
