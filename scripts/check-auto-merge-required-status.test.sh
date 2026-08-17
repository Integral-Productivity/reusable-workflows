#!/usr/bin/env bash
#
# Lightweight test harness for scripts/check-auto-merge-required-status.sh.
# No external framework: a fake `gh` executable is written to a temp
# directory and prepended to PATH so the script under test runs unmodified
# against scripted fixtures instead of the real GitHub API.
#
# This repo has no other shell test scaffolding to model — see this file's
# own conventions instead. Keep it self-contained and simple.
#
# Focus: the classic-branch-protection 404-vs-failure disambiguation (the
# exact bug class RWF-003 decision 3 says was already caught once by hand,
# and the highest-severity new logic in that change). Each fixture below
# drives one branch of that three-way split — offender / clean-404 /
# coverage-gap — through the real script, unmodified.
#
# Usage: bash scripts/check-auto-merge-required-status.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly SCRIPT_UNDER_TEST="${SCRIPT_DIR}/check-auto-merge-required-status.sh"

fail_count=0
pass_count=0

pass() {
	printf 'PASS: %s\n' "$1"
	pass_count=$((pass_count + 1))
}

fail() {
	printf 'FAIL: %s\n' "$1"
	fail_count=$((fail_count + 1))
}

# Sets up a fresh fake-gh directory + PATH for one fixture run and echoes
# nothing; caller reads $FAKE_BIN_DIR afterward for cleanup.
setup_fake_gh() {
	FAKE_BIN_DIR="$(mktemp -d)"
	cat >"${FAKE_BIN_DIR}/gh" <<'FAKE_GH_EOF'
#!/usr/bin/env bash
# Fake `gh` for testing check-auto-merge-required-status.sh in isolation.
# Understands only the exact calls the script under test makes; anything
# else fails loudly (exit 99) rather than being silently ignored, so a
# fixture gap shows up as a test failure instead of a false pass.
#
# Controlled via env vars set by the test harness:
#   FAKE_GH_REPO             single repo (owner/repo) enumerated by search
#   FAKE_GH_DEFAULT_BRANCH   default branch name reported for that repo
#   FAKE_GH_HAS_ADMIN        "true" or "false" — permissions.admin reported
#   FAKE_GH_PROTECTION_MODE  "404" | "403" | "offender" — controls the
#                             classic branch protection response
set -euo pipefail

cmd="${1:-}"
shift || true

case "$cmd" in
search)
	sub="${1:-}"
	shift || true
	if [ "$sub" != "code" ]; then
		echo "fake gh: unhandled 'gh search $sub'" >&2
		exit 99
	fi
	printf '%s\n' "$FAKE_GH_REPO"
	exit 0
	;;
api)
	path="${1:-}"
	shift || true

	# repos/{owner}/{repo} — repo metadata (default branch + admin permission)
	if [[ "$path" =~ ^repos/[^/]+/[^/]+$ ]]; then
		printf '%s\t%s\n' "$FAKE_GH_DEFAULT_BRANCH" "$FAKE_GH_HAS_ADMIN"
		exit 0
	fi

	# repos/{owner}/{repo}/rulesets — list rulesets (always empty in this harness)
	if [[ "$path" =~ ^repos/[^/]+/[^/]+/rulesets$ ]]; then
		exit 0
	fi

	# repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks
	if [[ "$path" =~ /protection/required_status_checks$ ]]; then
		case "$FAKE_GH_PROTECTION_MODE" in
		404)
			echo "gh: Branch not protected (HTTP 404)" >&2
			exit 1
			;;
		403)
			echo "gh: API rate limit exceeded for installation (HTTP 403)" >&2
			exit 1
			;;
		offender)
			printf '{"contexts":["auto-merge"]}\n'
			exit 0
			;;
		*)
			echo "fake gh: unset/unknown FAKE_GH_PROTECTION_MODE='${FAKE_GH_PROTECTION_MODE:-}'" >&2
			exit 99
			;;
		esac
	fi

	echo "fake gh: unhandled 'gh api $path'" >&2
	exit 99
	;;
*)
	echo "fake gh: unhandled command 'gh $cmd'" >&2
	exit 99
	;;
esac
FAKE_GH_EOF
	chmod +x "${FAKE_BIN_DIR}/gh"
}

teardown_fake_gh() {
	rm -rf "$FAKE_BIN_DIR"
}

# run_fixture NAME PROTECTION_MODE
# Runs the script under test with PATH shadowed by the fake gh, fixed to a
# single repo with admin access (so the classic-protection call under test
# actually happens rather than being short-circuited by the finding #2 gap
# path). Prints the script's combined stdout+stderr and its exit code as
# "EXIT:<n>" on the final line, for the caller to assert against.
run_fixture() {
	local mode="$1"
	setup_fake_gh
	(
		export PATH="${FAKE_BIN_DIR}:${PATH}"
		export GH_TOKEN="fake-token-for-test"
		export FAKE_GH_REPO="TestOrg/test-repo"
		export FAKE_GH_DEFAULT_BRANCH="main"
		export FAKE_GH_HAS_ADMIN="true"
		export FAKE_GH_PROTECTION_MODE="$mode"
		set +e
		out="$(bash "$SCRIPT_UNDER_TEST" 2>&1)"
		code=$?
		set -e
		printf '%s\n' "$out"
		printf 'EXIT:%d\n' "$code"
	)
	teardown_fake_gh
}

# ---- Fixture 1: 404 (not protected) — must be clean, exit 0 ---------------
out="$(run_fixture 404)"
exit_code="$(printf '%s\n' "$out" | grep -o 'EXIT:[0-9]*' | tail -1 | cut -d: -f2)"
if [ "$exit_code" = "0" ]; then
	pass "fixture 404: script exits 0"
else
	fail "fixture 404: expected exit 0, got ${exit_code}. Output:
${out}"
fi
if printf '%s\n' "$out" | grep -q '::error::'; then
	fail "fixture 404: expected zero gaps/offenders (no ::error:: lines), but found some. Output:
${out}"
else
	pass "fixture 404: zero gaps and zero offenders recorded"
fi

# ---- Fixture 2: non-404 failure (e.g. 403) — must be a gap, exit 1 --------
out="$(run_fixture 403)"
exit_code="$(printf '%s\n' "$out" | grep -o 'EXIT:[0-9]*' | tail -1 | cut -d: -f2)"
if [ "$exit_code" = "1" ]; then
	pass "fixture 403: script exits 1"
else
	fail "fixture 403: expected exit 1, got ${exit_code}. Output:
${out}"
fi
if printf '%s\n' "$out" | grep -q 'could not read classic branch protection'; then
	pass "fixture 403: recorded as a coverage gap"
else
	fail "fixture 403: expected a 'could not read classic branch protection' gap message. Output:
${out}"
fi

# ---- Fixture 3: matched context — must be an offender, exit 1 -------------
out="$(run_fixture offender)"
exit_code="$(printf '%s\n' "$out" | grep -o 'EXIT:[0-9]*' | tail -1 | cut -d: -f2)"
if [ "$exit_code" = "1" ]; then
	pass "fixture offender: script exits 1"
else
	fail "fixture offender: expected exit 1, got ${exit_code}. Output:
${out}"
fi
if printf '%s\n' "$out" | grep -q "classic branch protection requires context matching 'auto-merge'"; then
	pass "fixture offender: recorded as an offender"
else
	fail "fixture offender: expected an offender line naming 'classic branch protection' and 'auto-merge'. Output:
${out}"
fi

echo
echo "----------------------------------------"
echo "${pass_count} passed, ${fail_count} failed"

if [ "$fail_count" -gt 0 ]; then
	exit 1
fi
exit 0
