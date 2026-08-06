# Triage Labels

## The vocabulary is defined once, and not here

The canonical, org-wide triage vocabulary lives in
[`devops-excellence/docs/agents/triage-labels.md`](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/agents/triage-labels.md).
Repos **consume** that vocabulary; they do not fork it. That file is authoritative for:

- the two **category** roles (`bug`, `enhancement`),
- the six **state** roles (`needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `deferred`, `wontfix`) and what each one means,
- the enrichment axes that layer on top (`priority:*`, `area:*`, `handling:route:*`),
- the lock axis `status:in-progress`, the escalation axis `needs-triage-decision`,
  and the retired label names that must not be reused.

Read it before triaging here. **This file deliberately does not restate the table** —
see [Why this file no longer carries the table](#why-this-file-no-longer-carries-the-table).

## Mapping in this repo: identity

Every canonical role name is the literal label string on
`Integral-Productivity/reusable-workflows`. When a skill names a role — "apply the
AFK-ready triage label" — use that name verbatim. No translation step.

State labels are **provisioned per repo on first use**; they are not in
`templates/org-labels.json` yet. So a role you need may not exist here. Create it with
the exact name, colour, and description from canonical rather than inventing one:
`deferred` was created here on 2026-08-06 that way, and the three repos that had
created it independently beforehand had already drifted to two different colours and
three different descriptions for the same state.
[devops-excellence#508](https://github.com/Integral-Productivity/devops-excellence/issues/508)
closes this gap by generating and syncing the full vocabulary.

## What is specific to this repo

Canonical says what each state *means*. The rest of this file says how to choose
between them **here**, which canonical cannot know.

The relevant fact: this repo hosts reusable workflows that consumer repos across the
org call, and `@v1` is a moving major alias advanced by `major-tag-mover.yml`. A change
here reaches every consumer at once. That pushes the line further toward caution than
it would sit elsewhere.

### `ready-for-agent` vs `ready-for-human`

Prefer `ready-for-human` when the work involves:

- An unresolved policy or design question, not just an implementation. A change to a
  shared reusable alters the contract for every consumer simultaneously.
- Publishing a release. Cutting a release here propagates to all consumers, so per
  devops-excellence ADR-046 a human picks *when*.
- Repository or org settings — rulesets, secrets, variables, App installations.

`ready-for-agent` fits a fully specified change with no open fork: a documented port, a
mechanical audit across repos, a comment or docs correction.

### `deferred` vs `ready-*`

`deferred` is load-bearing here, more so than in most repos. Work in this repo is
routinely blocked on something outside it — an upstream package publishing, a
devops-excellence ADR landing, a release being cut, an org setting changing. Those are
graduation conditions, not information gaps, so `needs-info` is the wrong reach for
them and `ready-*` is an outright misstatement.

**The failure mode is specific and costly:** an issue labelled `ready-for-agent` that is
actually blocked will be picked up by an AFK agent that cannot detect the blocker until
it is already mid-run, and then stalls with no one watching. Blast radius makes the
wasted run worse than the mislabel.

So: if the work cannot start today, and the reason is a condition rather than a missing
answer, it is `deferred` — even when the issue is otherwise fully specified and would
read as agent-ready. "Fully specified" is not the test; "can start now" is.

Record the graduation condition in a comment when you apply it. That comment is the
durable un-defer trigger — without it the issue is parked with no one able to tell when
it should come back. Move it to a `ready-*` state once the condition is met.

Worked examples: [#3](https://github.com/Integral-Productivity/reusable-workflows/issues/3)
and [#4](https://github.com/Integral-Productivity/reusable-workflows/issues/4), both blocked
on `@integral-productivity/ofpm` being published, both carrying `ready-for-agent` until
2026-08-06 despite each stating its blocker in its own body.

## Why this file no longer carries the table

It carried one until 2026-08-06, and the copy rotted — twice, in the same way.

An agent asked to triage here found only three of the five states then documented and
improvised silently. `92bf59c` added the mapping table to close that gap, and five states
was correct on 2026-07-27: canonical still carried five.

Canonical then moved to six on 2026-08-04
([devops-excellence c11b0f8](https://github.com/Integral-Productivity/devops-excellence/commit/c11b0f8)),
adding `deferred` and stating that repos consume the vocabulary rather than forking it.
This file did not move with it, so the original failure mode reproduced one state up: an
agent correctly judging an issue to be `deferred` would find no label and no row, and
would have to pick something else without saying so.
[#18](https://github.com/Integral-Productivity/reusable-workflows/issues/18) is that gap.

The table was the defect, not its contents. Canonical's own principle — *an enumeration
copied into prose is a copy that rots* — applies to this file, and a second hand-edit
would only reset the clock. Pointing at canonical means the next change propagates by
reference. What stays here is what canonical genuinely cannot supply: this repo's bias
between states, given its blast radius.

[`holacracy-claude-plugin`](https://github.com/Integral-Productivity/holacracy-claude-plugin/blob/main/docs/agents/triage-labels.md)
carries a file at this same path and had drifted the same way; it is being moved to this
shape under the same issue. If you find a third repo restating the table, that is the
defect — replace it with a pointer rather than adding the missing row.
