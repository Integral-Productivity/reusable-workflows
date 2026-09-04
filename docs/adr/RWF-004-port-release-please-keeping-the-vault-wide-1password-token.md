# RWF-004: Port `reusable-release-please` keeping the vault-wide 1Password token, for now

## Status

Accepted — 2026-09-03

Records the credential-surface decision made while porting
`reusable-release-please.yml` to this host for
[#44](https://github.com/Integral-Productivity/reusable-workflows/issues/44).

Supersedes nothing. **Expected to be superseded** once
`OP_RELEASER_PUBLIC_TOKEN` replaces `OP_SERVICE_ACCOUNT_TOKEN` here — see
Consequences.

## Context

`reusable-release-please.yml` existed only on the private `devops-excellence`
host. A PUBLIC or INTERNAL caller cannot reach a reusable workflow — or a
composite action — in a PRIVATE repo; the run ends in `startup_failure` with
zero jobs and no logs, and `access_level: organization` does not lift it (it
admits private same-org callers only). Issue #44 carries the three-row run table
that establishes host visibility as the sole variable.

Porting it here is not itself a decision — devops-excellence ADR-065
(uniform public host for tier-3 repos) and ADR-038 (the public-host pattern)
already settled that, and the four reusables already here were ported under
them. `reusable-release-please.yml` was simply authored after that sweep and
missed. Under RWF-001 clause 4, an application of an upstream decision does not
earn a record here.

What does earn one is the credential surface, because this port lands **against**
the convention its two App-mediated neighbours in this repo already follow.

Both of them deliberately refuse the whole-vault token on this public host:

| Workflow | Secret it takes | Vault it reads |
|---|---|---|
| `reusable-auto-merge.yml` | `OP_AUTOMERGE_PUBLIC_TOKEN` | `ip-automation-public` |
| `reusable-promote-stable.yml` | `OP_RELEASER_PUBLIC_TOKEN` | `ip-automation-public` |
| `reusable-release-please.yml` (this port) | `OP_SERVICE_ACCOUNT_TOKEN` | `ip-automation` |

The reasoning behind the first two rows is devops-excellence ADR-045 and
ADR-064: `OP_SERVICE_ACCOUNT_TOKEN` is read-only on the *whole* `ip-automation`
vault, so forwarding it to a public runner means a leak reads every App PEM in
that vault — including the org-admin `ip-org-writer`. 1Password service accounts
are vault-scoped rather than item-scoped (ip-bots ADR-003), so the mitigation is
a dedicated per-capability vault plus a token scoped to it.

The sharpest form of the tension: `reusable-promote-stable.yml` already reads the
**same App's** PEM — `ip-releaser` — from `op://ip-automation-public/ip-releaser/private_key`
using `OP_RELEASER_PUBLIC_TOKEN`. The scoped vault, the scoped token and the
copied PEM for this exact identity all already exist in this repo's other
workflow. Adopting them here would have cost one line.

Against that, issue #44's first acceptance criterion is that this file carry
"the same `workflow_call` input/secret surface as the devops-excellence
original". That criterion is not incidental. The point of the port is that the
private callers already running against devops-excellence — praxis, orgops,
ip-bots, software-architecture-excellence — migrate with a one-line `uses:`
edit. Renaming the secret makes the migration a two-repo change requiring a new
secret to be provisioned on every consumer before the `uses:` can move, and
turns a mechanical port into a coordinated rollout.

## Decision

**1. The ported workflow keeps `secrets.OP_SERVICE_ACCOUNT_TOKEN` and reads
`op://ip-automation/ip-releaser/private_key`,** unchanged from the
devops-excellence original at `18de53b`. Callers migrate by editing the `uses:`
line and nothing else.

**2. No PUBLIC consumer repo may be wired to this reusable until clause 1 is
superseded.** The blast radius ADR-045 describes is real and unmitigated on a
public runner. INTERNAL and PRIVATE callers are in scope now; those are the
callers #44 exists to unblock, and they are what forced
`human-agent-collaboration-claude-plugin` to inline this body by hand. The
constraint is stated in the workflow header, where someone wiring a caller will
actually meet it, not only here.

**3. Adopting the scoped token is a separate change with its own record.** It
is a caller-visible break in a contract this repo publishes at `@v1`; RWF-001
clause 4 puts caller contracts in this repo, and RWF-002 governs what a break
costs. Smuggling it into a port would have shipped an unannounced contract
change inside a change advertised as mechanical.

**4. Two departures from the original body are made anyway, because neither is
caller-visible:**

- The `read-pem-from-1p` reference points at the PUBLIC copy in this repo
  (`Integral-Productivity/reusable-workflows/.github/actions/read-pem-from-1p@main`),
  matching `reusable-promote-stable.yml`. This is forced, not chosen: the
  private-host restriction applies to composite actions identically, so keeping
  the devops-excellence reference would reproduce the `startup_failure` the port
  exists to fix.
- `OP_SERVICE_ACCOUNT_TOKEN` becomes `required: false`. GitHub's `workflow_call`
  validator rejects an empty `required: true` secret at startup, producing the
  opaque 0-second `startup_failure` `reusable-claude.yml` hit when its caller
  landed before the secret existed. That failure mode breaks this workflow's
  never-blocks contract at the only moment it matters. A caller that forwards
  the secret sees no difference; a caller that does not gets a legible
  annotation instead of an unexplained abort.

**5. `googleapis/release-please-action@v5` is carried over as-is,** matching the
devops-excellence original. Note the known-green rendering used to cross-check
this port — the inlined copy in `human-agent-collaboration-claude-plugin`, which
cut tag v0.2.0 — pins `@v4`. v5.0.0 still exposes `token`, `config-file` and
`manifest-file` with the same shapes, so the port is sound on inspection, but
the *executed* evidence available at the time of writing is for v4.

## Consequences

- The four private consumers on the devops-excellence host can move with a
  one-line edit, and `human-agent-collaboration-claude-plugin` can drop its
  hand-inlined copy (that repo's issue #99, which #44 blocks).
- This repo now hosts one App-mediated reusable whose credential posture is
  weaker than its two neighbours', and the three sit in the same directory. That
  is precisely the kind of divergence a reader would otherwise have to
  reverse-engineer from a diff, which is why it is written down rather than left
  to the header comment alone (RWF-001 clause 5).
- Clause 2 is a *documented* constraint, not an enforced one. Nothing prevents
  someone wiring a public caller to this reusable and forwarding the vault-wide
  token. Making it enforceable — a fitness check asserting that no public-host
  reusable accepts `OP_SERVICE_ACCOUNT_TOKEN` — is the natural follow-up, and
  would cover `reusable-auto-merge.yml` and `reusable-promote-stable.yml` as
  regression guards at the same time.
- Two copies of this workflow now exist, and nothing detects them drifting. The
  same gap already applies to the other four reusables here and to
  `read-pem-from-1p`; #44's fourth acceptance criterion (mark the
  devops-excellence copy superseded or private-only) addresses it, and cannot be
  satisfied from this repo.
- Superseding this record means renaming a secret in a contract published at
  `@v1`. Under RWF-002 that is a caller-visible break, so it needs the
  consumers provisioned with `OP_RELEASER_PUBLIC_TOKEN` first, then a
  transition window where both secrets are accepted, rather than a flip.
