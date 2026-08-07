# RWF-001: Record architecture decisions here, numbered `RWF-NNN`, scoped to hosting concerns

## Status

Accepted — 2026-08-06

Establishes the ADR practice for this repo and the boundary against
[`devops-excellence`](https://github.com/Integral-Productivity/devops-excellence),
whose ADRs this repo's workflows already cite as their upstream authority.

Records the decision for
[#22](https://github.com/Integral-Productivity/reusable-workflows/issues/22).

## Context

This repo had no ADR infrastructure — no `.adr-dir`, no `docs/adr/`. Its
architectural decisions lived in three places instead:

| Decision | Where it lived |
|---|---|
| `@v1` moving-alias versioning | README `## Versioning` prose, citing devops-excellence ADR-046 |
| The public-host pattern (a public repo cannot call a private reusable) | Header comment in `reusable-auto-merge.yml`, citing ADR-038 |
| Scoped 1P token rather than whole-vault | Header comment, citing ADR-045 |
| `required: false` on the secret to avoid `startup_failure` | Header comment |
| "This workflow NEVER blocks a PR" | Header comment |
| `promote-stable` deliberately omits `continue-on-error` | A single comment line in `reusable-promote-stable.yml` |

Those header comments are good documentation. What they cannot do is record a
decision *not* to do something, carry a `Superseded by` link, or survive a
refactor of the code they sit above. The `promote-stable` line is the sharpest
case: that it hard-fails, unlike auto-merge, is a real decision with a real
rationale, held by one comment line a future cleanup could delete without
anyone noticing.

Two live questions have no durable home either:
[#17](https://github.com/Integral-Productivity/reusable-workflows/issues/17)
(a proposed change to the never-blocks contract, affecting every consumer) and
[#18](https://github.com/Integral-Productivity/reusable-workflows/issues/18)
(whether the 5-state triage vocabulary is deliberate). Both would otherwise
resolve inside an issue thread.

Numbering also needed a decision. Sibling repos use *scoped* prefixes so that a
bare number is never ambiguous across repos: `ADR-NNN` in `devops-excellence`,
`SAE-NNN` in `software-architecture-excellence`. Reusing `ADR-NNN` here would
make "ADR-045" mean two different documents depending on which repo the reader
is standing in — and this repo's workflow comments cite devops-excellence ADR
numbers constantly, so the collision would be routine rather than theoretical.

## Decision

**1. This repo keeps ADRs in `docs/adr/`,** initialized with
[adr-tools](https://github.com/npryce/adr-tools) (`adr init docs/adr`),
following the format
[described by Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

**2. The numbering prefix is `RWF-NNN`** (for *reusable-workflows*). Files are
named `docs/adr/RWF-NNN-kebab-slug.md`, matching the sibling-repo file-naming
shape. A cross-repo reference is therefore always unambiguous: `RWF-002` is this
repo, `ADR-046` is devops-excellence, `SAE-006` is
software-architecture-excellence.

adr-tools derives its next number from filenames beginning with a digit, so
`adr new` cannot see `RWF-`-prefixed records and restarts at `0001` every time.
The prefix is deliberate and the auto-numbering is not load-bearing, so the
tooling is wrapped rather than the convention bent:
[`scripts/new-adr.sh`](../../scripts/new-adr.sh) is the supported way to create
a record. It computes the next number by scanning `docs/adr/RWF-*.md`, runs the
clause 3 reservation checks against that number, then invokes `adr new` for the
body and rewrites the generated header into this repo's format. Creating a
record by hand still works; the wrapper is what makes the number trustworthy.

**3. Before claiming a number, check every reservation surface** — not just the
directory listing:

| Surface | Why it is not redundant |
|---|---|
| `docs/adr/` in the working tree | The obvious one. |
| `docs/adr/` on `origin/main` | A record merged but not yet pulled is invisible to a plain `ls`. |
| Open PRs (`gh search prs --repo Integral-Productivity/reusable-workflows "RWF-NNN"`) | Work in progress does not appear on GitHub until a PR exists, and two open PRs claiming one number both look mergeable until the first merges. The on-disk surfaces structurally cannot see this. |
| Project memory | A number can be reserved in a session's notes before any file or PR exists. |

`scripts/new-adr.sh` runs all four and refuses to claim a number that any of
them reports as taken. When a surface cannot be checked automatically — `gh`
missing or unauthenticated, no `origin/main` ref — it prints the exact command
with the number filled in and requires explicit confirmation before proceeding,
rather than claiming the next on-disk number silently. A wrapper that skipped
the in-flight-PR surface would reintroduce precisely the collision this protocol
exists to prevent.

Duplicate-numbered ADRs have happened in this org and required renumber PRs to
fix; see devops-excellence
[ADR-070](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-070-adr-number-collision-pr-check.md)
for the worked failure mode and the automated CI checks that back the protocol
there. This repo has no such CI check yet — the wrapper is a local guard, not an
enforced gate.

**4. Scope boundary — what belongs here versus in `devops-excellence`.**

An ADR belongs in **this repo** when the decision is specific to *hosting these
reusables for public consumers*:

- The **contract** a reusable offers its callers — inputs, secrets, required
  permissions, and failure semantics (does it block a PR, or degrade quietly?).
- **Versioning and release** of this repo's units: which ref consumers pin, what
  constitutes a major bump, how the moving alias moves.
- Why a unit here **diverges** from its `devops-excellence` counterpart — for
  example forwarding a scoped 1Password token instead of the vault-wide one,
  because the runner is public.
- Decisions this repo makes that have **no upstream authority at all**.

An ADR belongs in **`devops-excellence`** when the decision is org-wide policy
that merely happens to be implemented here: the actions allow-list, the
per-capability App-token model, GHAS configuration, ruleset design, the
public-host pattern itself. This repo's records **cite** those; they do not
restate them. When an upstream ADR governs, the record here should say so in one
line and link out, then document only the part that is local.

**5. Workflow header comments stay where they are.** They are load-bearing at
the point of edit — someone changing a `run:` block needs the script-injection
warning three lines above it, not a pointer to `docs/adr/`. ADRs *supplement*
those comments; a comment may link to an ADR for the fuller rationale, but the
operative warning stays inline.

## Consequences

- Decisions that were previously prose-only now have a superseding path, a
  status field, and a stable citation target. RWF-002 backfills the first of
  them (the `@v1` versioning contract).
- #17 and #18 have somewhere to land when they resolve: #17 changes a caller
  contract, which clause 4 places squarely in this repo; #18 concerns the
  org-wide triage vocabulary, which — being org-wide — belongs upstream, with at
  most a pointer here.
- `adr new` is not usable directly (clause 2), so the repo carries a shell
  script it would not otherwise need. In exchange, the reservation protocol runs
  by default instead of depending on whoever creates the record remembering four
  checks.
- The wrapper is a *local* guard. It cannot stop a collision created by someone
  who bypasses it, and there is no CI check here to catch that — unlike
  devops-excellence, which has both an on-disk and a cross-PR check.
- A reader who sees a bare number in this repo can tell which repo owns it from
  the prefix alone. The cost is that `RWF-` is a fourth prefix to remember
  alongside `ADR-`, `SAE-`, and the product-repo conventions.
- Nothing in this decision migrates existing header comments. The workflow files
  are untouched by it.
