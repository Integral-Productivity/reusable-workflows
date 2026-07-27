# Triage Labels

Agents and skills speak in terms of five canonical triage roles. This file maps
those roles to the actual label strings used in this repo's issue tracker, so an
agent triaging an issue here uses the same vocabulary it would in any other
Integral-Productivity repo instead of improvising from whatever labels happen to
exist.

All five labels exist on `Integral-Productivity/reusable-workflows`, so the
mapping is an identity — applying one creates no new label.

| Canonical role    | Label in our tracker | Meaning                                                                    |
| ----------------- | -------------------- | -------------------------------------------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue                                    |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information                                   |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent                                    |
| `ready-for-human` | `ready-for-human`    | Fully specified, but needs human implementation (judgment, design, access)  |
| `wontfix`         | `wontfix`            | Will not be actioned                                                       |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

## Choosing between `ready-for-agent` and `ready-for-human`

This repo hosts reusable workflows that **every** consumer repo runs, so the line
sits further toward `ready-for-human` than it would elsewhere. Prefer
`ready-for-human` when the work involves:

- An unresolved policy or design question, not just an implementation. A change
  to a shared reusable alters the contract for every consumer at once.
- Publishing a release. `@v1` is a moving major alias advanced by
  `major-tag-mover.yml`, so cutting a release here propagates to all consumers.
  Per devops-excellence ADR-046, a human picks *when* to cut.
- Repository or org settings — rulesets, secrets, variables, App installations.

`ready-for-agent` fits a fully specified change with no open fork: a documented
port, a mechanical audit across repos, a comment or docs correction.

## Why this file exists

An agent asked to triage issues here found only `ready-for-agent`,
`ready-for-human`, and `wontfix` — three of the five — and had to improvise,
silently. Sibling repos (`holacracy-claude-plugin`, `devops-excellence`) carry
this same identity mapping at this same path; this file closes the gap so
triage is consistent across the org. See devops-excellence ADR-018 for the label
manifest those labels come from.
