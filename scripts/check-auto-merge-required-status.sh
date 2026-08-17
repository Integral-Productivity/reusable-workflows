#!/usr/bin/env bash
#
# Scheduled fitness check for issue #24: fails loudly if any consumer of
# reusable-auto-merge.yml requires an auto-merge context as a REQUIRED status
# check — via a repository ruleset OR classic branch protection.
#
# Why this exists: reusable-auto-merge.yml ends a credential failure RED
# (issues #17/#23) rather than swallowing it. That is safe only because no
# consumer treats the job as a required check — a red run then never blocks a
# PR, it just gets noticed. A hand sweep during #17's triage found 0 of 51
# consumers did, checked across both enforcement mechanisms. This script turns
# that point-in-time reading into a recurring, enforced check. See RWF-003 for
# the enumeration-method decision and its documented blind spot.
#
# Usage:
#   GH_TOKEN=<token with administration:read on every consumer repo> \
#     scripts/check-auto-merge-required-status.sh
#
# Requires: gh (authenticated via GH_TOKEN), jq.
#
# Exit codes: 0 clean (every consumer checked, none require an auto-merge
# context). 1 either a confirmed violation, or a repo that could not be fully
# verified — incomplete coverage is reported as a failure rather than a false
# all-clear, since a repo this script cannot read is a repo it cannot vouch
# for.

set -euo pipefail

readonly ORG="Integral-Productivity"
readonly REUSABLE_FILE="reusable-auto-merge.yml"
# Case-insensitive; `.?` stands in for whatever separator a caller's job id
# uses, matching zero or one of any character between `auto` and `merge` —
# auto-merge, auto_merge, "auto merge", and automerge (zero separator) all
# match. Issue #24's scope names the match target as `auto.merge`; `.?`
# widens that by one character so a zero-separator id like `automerge`
# isn't mechanically unmatchable.
readonly CONTEXT_PATTERN='auto.?merge'

command -v gh >/dev/null 2>&1 || {
	echo "error: gh CLI not found" >&2
	exit 1
}
command -v jq >/dev/null 2>&1 || {
	echo "error: jq not found" >&2
	exit 1
}
if [ -z "${GH_TOKEN:-}" ]; then
	echo "error: GH_TOKEN must be set to a token with administration:read on every consumer repo — see this script's header" >&2
	exit 1
fi

offenders=() # "owner/repo|source|context"
gaps=()      # "owner/repo: what couldn't be verified"
scanned=0

# ---- 1. Enumerate consumers ------------------------------------------------
# Code search, not an org-wide walk of every repo's .github/workflows/*.yml.
# This is the "working logic" the original #17 sweep used and validated (it
# found all 51 known consumers, including one a manual pass had missed). Its
# documented blind spot: it depends on GitHub's code-search index being
# current, and it misses a caller that references reusable-auto-merge.yml only
# indirectly (e.g. through a shared template this repo doesn't itself
# reference by that filename). See RWF-003.
#
# The search runs to a temp file first, rather than straight into `mapfile`
# via process substitution, specifically to preserve its own exit status —
# `mapfile -t x < <(cmd)` never surfaces `cmd`'s exit code to the enclosing
# script, so a partial/truncated result (e.g. `gh` erroring out mid-pagination
# after returning some results) would otherwise be indistinguishable from a
# complete list and silently scanned as if it were the whole population.
search_out="$(mktemp)"
search_err="$(mktemp)"
if ! gh search code --owner "$ORG" "$REUSABLE_FILE" --limit 1000 --json repository \
	--jq '.[].repository.nameWithOwner' >"$search_out" 2>"$search_err"; then
	echo "::error::gh search code for '${REUSABLE_FILE}' under --owner ${ORG} failed: $(tr '\n' ' ' <"$search_err")"
	rm -f "$search_out" "$search_err"
	exit 1
fi
mapfile -t repos < <(sort -u "$search_out")
rm -f "$search_out" "$search_err"

# Second layer of defense: a genuinely empty-but-successful search (exit 0,
# zero repos) is still refused here, since reusable-auto-merge.yml is known
# to have dozens of callers.
if [ "${#repos[@]}" -eq 0 ]; then
	echo "::error::gh search code for '${REUSABLE_FILE}' under --owner ${ORG} returned zero repos. reusable-auto-merge.yml is known to have dozens of callers, so an empty result means the search itself failed (auth, rate limit, API outage) or the index is stale — not that zero consumers exist. Refusing to report a false all-clear."
	exit 1
fi

echo "Enumerated ${#repos[@]} candidate consumer repo(s) via code search (see RWF-003 for method + blind spots)."

for repo in "${repos[@]}"; do
	scanned=$((scanned + 1))
	err="$(mktemp)"

	# Pulled together: default_branch (for the classic-protection URL below)
	# and permissions.admin (the caller's own access level on this repo, per
	# GitHub's authenticated repo-read response) — the latter is needed to
	# tell a genuine "not protected" 404 apart from a permission-denied 404
	# on the classic-protection endpoint below.
	if ! repo_meta="$(gh api "repos/${repo}" --jq '[.default_branch, ((.permissions.admin // false) | tostring)] | @tsv' 2>"$err")"; then
		gaps+=("${repo}: could not resolve default branch — $(tr '\n' ' ' <"$err")")
		rm -f "$err"
		continue
	fi
	IFS=$'\t' read -r default_branch has_admin <<<"$repo_meta"

	# -- Repository rulesets (target: branch, enforcement: active only).
	# `evaluate` is GitHub's own dry-run mode for staging a rule before
	# turning it on, and `disabled` enforces nothing — neither actually
	# blocks a PR, so scanning them would flag a safe, intentional dry-run
	# as a full-severity offender. A 200 with `[]` (after this filter) is a
	# real "no actively-enforced rulesets" answer; any non-zero exit here is
	# an access/API problem, not evidence of zero rulesets, and is recorded
	# as a coverage gap rather than silently treated as clean.
	if ruleset_ids="$(gh api "repos/${repo}/rulesets" --paginate --jq '.[] | select(.target=="branch" and .enforcement=="active") | .id' 2>"$err")"; then
		for id in $ruleset_ids; do
			rerr="$(mktemp)"
			if ctxs="$(gh api "repos/${repo}/rulesets/${id}" --jq \
				'.rules[]? | select(.type=="required_status_checks") | .parameters.required_status_checks[]?.context' \
				2>"$rerr")"; then
				while IFS= read -r ctx; do
					[ -z "$ctx" ] && continue
					if printf '%s' "$ctx" | grep -Eiq "$CONTEXT_PATTERN"; then
						offenders+=("${repo}|ruleset ${id}|${ctx}")
					fi
				done <<<"$ctxs"
			else
				gaps+=("${repo}: could not read ruleset ${id} — $(tr '\n' ' ' <"$rerr")")
			fi
			rm -f "$rerr"
		done
	else
		gaps+=("${repo}: could not list rulesets — $(tr '\n' ' ' <"$err")")
	fi

	# -- Classic branch protection. A 404 here means "not protected" — the
	# common case. But this endpoint requires admin access on the repo, and
	# GitHub returns that SAME 404 when the caller lacks that access — there
	# is no way to tell "not protected" apart from "protected but this token
	# can't read it" from the response alone. So admin access is checked
	# first, via `has_admin` from the repo-metadata call above; only when it
	# is true is a 404 trusted as "not protected". Without it, the repo is
	# recorded as a coverage gap for this check specifically rather than
	# risking a false "clean". `gh` also writes a 404's error BODY to
	# stdout, so a naive line count would misread "Branch not protected" as
	# a required check (issue #24's stated trap); this gates on the exit
	# code alone and never parses stdout from a failed call. Any other
	# failure is a coverage gap.
	if [ "$has_admin" != "true" ]; then
		gaps+=("${repo}: ip-org-auditor lacks admin access — cannot distinguish 'not protected' from 'protected but unreadable' for classic branch protection")
	else
		cerr="$(mktemp)"
		if classic_json="$(gh api "repos/${repo}/branches/${default_branch}/protection/required_status_checks" 2>"$cerr")"; then
			ctxs="$(printf '%s' "$classic_json" | jq -r '.contexts[]?' 2>/dev/null || true)"
			while IFS= read -r ctx; do
				[ -z "$ctx" ] && continue
				if printf '%s' "$ctx" | grep -Eiq "$CONTEXT_PATTERN"; then
					offenders+=("${repo}|classic branch protection|${ctx}")
				fi
			done <<<"$ctxs"
		elif ! grep -q "HTTP 404" "$cerr"; then
			gaps+=("${repo}: could not read classic branch protection — $(tr '\n' ' ' <"$cerr")")
		fi
		rm -f "$cerr"
	fi
	rm -f "$err"
done

echo "Scanned ${scanned} repo(s)."

status=0

if [ "${#gaps[@]}" -gt 0 ]; then
	echo "::error::${#gaps[@]} repo(s) could not be fully verified — treating incomplete coverage as a failure rather than a false all-clear:"
	for g in "${gaps[@]}"; do
		echo "::error::  ${g}"
	done
	status=1
fi

if [ "${#offenders[@]}" -gt 0 ]; then
	echo "::error::${#offenders[@]} consumer(s) require an auto-merge status check — this breaks the 'never blocks a PR' contract in reusable-auto-merge.yml (issues #17 / #23 / #24):"
	for o in "${offenders[@]}"; do
		IFS='|' read -r off_repo off_source off_ctx <<<"$o"
		echo "::error::  ${off_repo}: ${off_source} requires context matching '${off_ctx}'"
	done
	status=1
fi

if [ "$status" -eq 0 ]; then
	echo "Clean: 0 of ${scanned} consumer(s) require an auto-merge status check."
fi

exit "$status"
