---
title: Match hosts exactly in leak-detector patterns instead of anchoring or dismissing CodeQL alerts
date: 2026-10-22
category: design-patterns
module: public-bundle
problem_type: design_pattern
component: infrastructure
severity: medium
applies_when:
  - "Adding or changing an L4 internal-locator rule in scripts/public-bundle/patterns.mjs"
  - "CodeQL reports js/regex/missing-regexp-anchor (Missing regular expression anchor) on a regex that searches free text for a host name"
  - "Writing any detector that must find a URL or host in prose, with or without a scheme"
tags:
  - codeql
  - regex
  - missing-regexp-anchor
  - public-bundle
  - privacy-check
  - fail-closed
  - host-matching
related_components:
  - scripts/public-bundle/check.mjs
---

# Match hosts exactly in leak-detector patterns instead of anchoring or dismissing CodeQL alerts

## Context

The public-bundle privacy check (`scripts/public-bundle/check.mjs`) scans every line of a plugin copy for internal locators (layer L4), such as Google Docs and Drive links and HubSpot record links. The first version used one regex per locator with the host written inline, for example `/docs\.google\.com\/(?:document|…)\/d\//`.

On PR #63, CodeQL's default setup flagged three of those lines as "Missing regular expression anchor" (high severity). Two responses looked reasonable. Both were wrong:

- **Add `\b` before the host.** In this run the alerts stayed after the change. CodeQL did not treat `\b` as an anchor. `\b` also did not stop look-alikes: `evil-docs.google.com/…` still matched.
- **Call the alerts false positives and dismiss them.** The argument: these regexes are detectors, not URL validators, and they must match a host anywhere in a line. An anchor (`^`) or a required `https://` would let a link written in prose (`see docs.google.com/document/d/…`) pass the check. That argument was true, but it missed a real defect. A substring match on a host also matched look-alike hosts, such as `notdocs.google.com/document/d/…` before the `\b` change and `evil-docs.google.com/document/d/…` after it. The owner pushed back ("why not fix them?"), and the fix below cleared the alerts.

## Guidance

Do not put a host name literal inside a detection regex. Split the job in two:

1. Find every host-and-path token in the line with one generic pattern that names no host (`HOST_AND_PATH`, `scripts/public-bundle/patterns.mjs:69`). The lookbehind `(?<![\w.-])` keeps a match from starting in the middle of a longer host. The scheme is optional, so prose links are found.
2. Lower-case the host and compare it **exactly**, in code, against each rule (`HOST_RULES`, `scripts/public-bundle/patterns.mjs:70`). Check the path separately, without naming a host (for example a regex that starts with `^\/`).

```js
const HOST_AND_PATH = /(?<![\w.-])((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s"'`<>()\[\]{}]*)?/gi;
const HOST_RULES = [
  ['Google Docs link', (host, path) => host === 'docs.google.com' && /^\/(?:document|spreadsheets|presentation|forms|drawings)\/d\//.test(path)],
  // ...
];
```

To add a locator, add a `HOST_RULES` entry. Do not add a `LOCATOR_PATTERNS` regex that contains a host.

## Why This Matters

- **Anchoring weakens a detector.** A detector fails closed only when it finds the thing in any form. `^https://docs\.google\.com` passes a link written without a scheme or in the middle of a sentence, so the leak ships.
- **Dismissing hides a real gap.** The CodeQL rule describes a real property: an unanchored host literal matches inside other hosts. For a validator, that lets a bad host through. For a detector, it raises false alarms on look-alike hosts. A literal without the `i` flag also misses a host written in capitals, which can hide a real leak. Exact comparison of the lower-cased host fixes all of these.
- **The alert is not blocking, so it is easy to wave away.** On reusable-workflows, `actionlint` is the only required check, so a red `CodeQL` check does not stop a merge. The fix has to come from judgment, not from the gate.

## When to Apply

- A new L4 locator in `patterns.mjs`, or any scanner that searches free text for URLs.
- Any CodeQL `missing-regexp-anchor` alert on code whose job is detection rather than validation. Before you dismiss it, check whether exact host comparison is possible.

It does not apply to a rule whose host part is itself a pattern, such as the Supabase project rule (`/\b[a-z0-9]{20}\.supabase\.co\b/`, `scripts/public-bundle/patterns.mjs:63`). CodeQL did not flag that line in this run.

The Vercel rule shows that CodeQL does not find every case. Before this change, a separate `vercelProject()` function used `/vercel\.com\/([\w-]+)\/[\w-]+/g`, and CodeQL did not flag it. A grounding check found that it had no `i` flag, so `https://VERCEL.COM/<team>/<project>` passed the privacy check. The rule is now a `HOST_RULES` entry for `vercel.com` and `www.vercel.com` (`scripts/public-bundle/patterns.mjs:73`). Treat every fixed-host rule the same way, whether CodeQL flags it or not.

## Examples

The tests in `scripts/public-bundle/check.test.mjs` cover both cases:

- `a link written without a scheme, or in capitals, still fails L4` (line 92). Covers `see docs.google.com/document/d/…`, a Drive folder link without a scheme, `(app-eu1.hubspot.com/contacts/12345678/…)`, `https://DOCS.GOOGLE.COM/…`, `https://VERCEL.COM/…` and `www.vercel.com/…`.
- `look-alike hosts and public pages do not fail L4` (line 105). Covers `notdocs.google.com`, `docs.google.com.example.com`, a bare `https://docs.google.com/`, `www.hubspot.com/products/…`, `notvercel.com/…` and `vercel.com/docs/…`.

When you add a `HOST_RULES` entry, add its prose, capitals and look-alike cases to these two tests. The Vercel entry has all three.

## Related

- reusable-workflows PR #63 (squash-merged 2026-10-22): adds the public-bundle scripts with the Google and HubSpot fix. Its conversation records the "false positive" comment, later struck out. The Vercel fix and this doc land in the PR that follows it.
- `Integral-Productivity/marketplace` ADR 0002: the public-bundle design, including the fail-closed privacy check.
