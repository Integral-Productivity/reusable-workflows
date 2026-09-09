# RWF-005: Declare every divergence from the private twin in the file header

## Status

Accepted — 2026-09-09

Records the convention adopted while porting the five private-only tier-1
reusables to this host for
[Integral-Productivity/devops-excellence#611](https://github.com/Integral-Productivity/devops-excellence/issues/611)
(ADR-084 Stage B).

Extends [RWF-004](RWF-004-port-release-please-keeping-the-vault-wide-1password-token.md),
which recorded a single port's credential decision. This record generalizes the
*form* that decision took, so the next port does not have to reinvent it.

Expected to be retired by devops-excellence ADR-084 **Stage E**, which deletes
the private duplicates entirely. A convention for describing a delta has nothing
to describe once there is only one copy.

## Context

Five reusables — `reusable-ci-node`, `reusable-codeql`,
`reusable-claude-code-review`, `reusable-architecture-fitness`, `reusable-bdd` —
existed only on the private `devops-excellence` host, so no public or internal
repo could call them. Porting them here is not itself a decision; ADR-084 already
made it, and under RWF-001 clause 4 an application of an upstream decision earns
no record here.

What does need recording is what RWF-001 clause 4 places squarely in this repo:
**why a unit here diverges from its `devops-excellence` counterpart**, and how a
reader is meant to find that out.

Two facts make this pressing rather than tidy.

**The two hosts have no sync mechanism.** ADR-084 says so in as many words: this
host holds hand-maintained, deliberately divergent copies. Before this port there
were five duplicated pairs; there are now ten. devops-excellence#612 is building
a fitness check that compares each public copy against its private twin and fails
on divergence *outside a declared delta* — which means the check needs somewhere
to read the declaration from. Nothing said where that was.

**A verbatim port of `reusable-ci-node` does not pass this repo's CI.** Its three
npm-branch `::error::` messages wrote an example fallback as
`\${{ secrets.NODE_AUTH_TOKEN || secrets.DEPENDABOT_PACKAGES_TOKEN }}`. The
backslash escapes the `$` for bash, but GitHub expands `${{ }}` inside a `run:`
block *before* bash ever sees the text, so that is a live expression rather than
the literal it was meant to be. `NODE_AUTH_TOKEN` is declared and
`DEPENDABOT_PACKAGES_TOKEN` is not, so `a || b` evaluates to the real registry
token and splices it into the annotation. GitHub's log masking renders it `***`,
which is why the defect survived on the private host. This repo's `actionlint`
gate rejects it outright, as an undefined property on the `secrets` object.

The three *pnpm* branches in the same file already used the correct
`${{ '${{' }} … ${{ '}}' }}` form, and `reusable-claude-code-review` states the
underlying rule in its own precheck step. So the fix was neither novel nor
discretionary — but applying it meant the port could not be byte-identical, and
that had to be sayable.

## Decision

**1. The workflow body is byte-identical to the private twin unless a delta is
declared.** Everything from `name:` down is a verbatim copy by default. This is
the property the #612 drift check tests, and the default is what makes a diff
mean something.

**2. Every public copy's header carries two named sections.**

- **`Credential surface`** — the secrets the file declares, stated positively,
  and whether that surface differs from the private twin. It must say
  `IDENTICAL to the private copy` when it does not differ. An absent section and
  a section asserting no difference are not the same signal: the first may mean
  nobody looked.
- **`Declared delta from the private copy`** — either `THIS HEADER ONLY`, or an
  enumeration of each body delta with the reasoning that produced it.

  This follows the shape `reusable-auto-merge.yml` already used for its
  credential delta; this record generalizes it to every file and to deltas of
  any kind, not only credential ones.

**3. Prohibition prose is not a reference.** Each header states that
`OP_SERVICE_ACCOUNT_TOKEN` must never be forwarded to a public reusable — it is
read-only across the whole `ip-automation` vault, so a leak on a public runner
reads every App PEM there including the org-admin `ip-org-writer`. Any check
asserting "no `OP_SERVICE_ACCOUNT_TOKEN` in a public copy" must therefore match
the **expression** (`secrets.OP_SERVICE_ACCOUNT_TOKEN`), not the bare string.
`reusable-auto-merge.yml` set this precedent — it names the token twice in prose
while forwarding the scoped `OP_*_PUBLIC_TOKEN` form.

**4. When a verbatim port fails this repo's CI, fix it here and declare the
delta — do not weaken the gate.** The public host's CI is the stricter of the
two, and ADR-084 argues that is a feature: under Stage D this repo's CI becomes
the gate a reusable change must pass. A port that disabled a check to accommodate
an upstream defect would invert that.

The fix is not carried back to the private copy in the same change. Cross-repo
edits are how a port turns into an unbounded one, and #611 is scoped to this
host. The delta declaration is what keeps the omission visible rather than lost.

## Consequences

- devops-excellence#612 has a defined surface to read. `Declared delta from the
  private copy` is the allowlist that ADR-084 says the check needs, and it lives
  next to the code it describes rather than in a separate registry that can go
  stale independently.
- Four of the five ports are header-only deltas, so the check should see clean
  byte-identity on their bodies. `reusable-ci-node` is the one exception, and it
  says so.
- The private `reusable-ci-node.yml` still carries the unescaped-expression
  defect. Nothing here fixes it, and the two copies now genuinely differ in
  behavior rather than only in prose. Tracked in
  [devops-excellence#661](https://github.com/Integral-Productivity/devops-excellence/issues/661).
- The convention costs a long header on every file. The alternative — a separate
  delta registry — was rejected because a registry drifts from the file it
  describes exactly as the two hosts drifted from each other, which is the
  problem this is downstream of.
- Nothing here changes a caller. The five files are new to this host; no
  consumer pins them until a release moves `v1` onto this commit (RWF-002).
