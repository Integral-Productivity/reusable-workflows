#!/usr/bin/env bash
#
# Create a new RWF-NNN architecture decision record.
#
# Why this wrapper exists: this repo numbers ADRs `RWF-NNN` (RWF-001 clause 2)
# so that a bare number is unambiguous across sibling repos. adr-tools derives
# its next number from filenames that begin with a digit, so it cannot see
# `RWF-`-prefixed records and would restart at 0001 every time. This script
# computes the number itself by scanning `docs/adr/RWF-*.md`, runs the RWF-001
# clause 3 reservation checks against that number, then lets adr-tools generate
# the body and rewrites its header into the repo's house format.
#
# Usage:
#   scripts/new-adr.sh "Title of the decision"
#   scripts/new-adr.sh --dry-run "Title of the decision"
#
# Options:
#   --dry-run   Run the reservation checks and report the number that would be
#               claimed, without creating a file.
#   -h, --help  Show this help.
#
# Exit codes: 0 success, 1 usage or environment error, 2 a reservation check
# found the number already claimed or the human declined to proceed.

set -euo pipefail

readonly PREFIX="RWF"
readonly DEFAULT_REPO="Integral-Productivity/reusable-workflows"

die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

usage() {
	sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
}

# Lowercase, non-alphanumerics to single hyphens, trimmed.
slugify() {
	printf '%s' "$1" |
		tr '[:upper:]' '[:lower:]' |
		sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//'
}

# Highest RWF number across the working tree AND origin/main. Checking both
# matters: a record merged to main but not yet pulled into this worktree is
# invisible to a plain `ls`, and claiming its number is exactly the collision
# RWF-001 clause 3 exists to prevent.
highest_existing_number() {
	local max=0 n name
	{
		ls "$adr_dir" 2>/dev/null || true
		if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
			git ls-tree --name-only origin/main -- "$adr_rel/" 2>/dev/null || true
		fi
	} | while read -r name; do
		printf '%s\n' "${name##*/}"
	done | sed -n "s/^${PREFIX}-\([0-9]\{1,\}\)-.*\.md$/\1/p" | {
		while read -r n; do
			n=$((10#$n))
			if [ "$n" -gt "$max" ]; then
				max=$n
			fi
		done
		printf '%s' "$max"
	}
}

# RWF-001 clause 3. Two of the three surfaces can be checked automatically here;
# the third (in-flight PRs) needs `gh` authenticated. Whatever cannot be run is
# printed for the human with the number already filled in, and the script will
# not claim the number until they confirm.
reservation_checks() {
	local id="$1"
	local -a manual=()
	local collision=0

	printf '\nReservation checks for %s (RWF-001 clause 3)\n' "$id"
	printf -- '------------------------------------------------\n'

	# 1. On disk, working tree.
	if ls "$adr_dir"/"$id"-*.md >/dev/null 2>&1; then
		printf '  FAIL  working tree: %s already exists\n' "$id"
		collision=1
	else
		printf '  ok    working tree: no %s\n' "$id"
	fi

	# 2. On disk, origin/main — catches a record merged but not yet pulled.
	if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
		if git ls-tree --name-only origin/main -- "$adr_rel/" 2>/dev/null |
			grep -q "/${id}-"; then
			printf '  FAIL  origin/main: %s already exists\n' "$id"
			collision=1
		else
			printf '  ok    origin/main: no %s\n' "$id"
		fi
	else
		manual+=("git fetch origin main && git ls-tree --name-only origin/main -- $adr_rel/")
	fi

	# 3. In-flight PRs — the surface the on-disk checks structurally cannot see.
	if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
		local hits
		hits=$(gh search prs --repo "$repo_slug" "$id" --state open --json title \
			--jq 'length' 2>/dev/null || printf 'error')
		if [ "$hits" = "error" ]; then
			manual+=("gh search prs --repo $repo_slug \"$id\" --state open --json title")
		elif [ "$hits" != "0" ]; then
			printf '  FAIL  open PRs: %s referenced by %s open PR(s)\n' "$id" "$hits"
			collision=1
		else
			printf '  ok    open PRs: no reference to %s\n' "$id"
		fi
	else
		manual+=("gh search prs --repo $repo_slug \"$id\" --state open --json title")
	fi

	# 4. Project memory.
	if [ -d "$memory_dir" ]; then
		if grep -rq "$id" "$memory_dir" 2>/dev/null; then
			printf '  FAIL  project memory: %s referenced in %s\n' "$id" "$memory_dir"
			collision=1
		else
			printf '  ok    project memory: no reference to %s\n' "$id"
		fi
	else
		manual+=("grep -r \"$id\" <project memory dir>  # not found at $memory_dir")
	fi

	if [ "$collision" -eq 1 ]; then
		printf '\n%s is already claimed. Re-run to pick up the next free number,\n' "$id"
		printf 'or renumber deliberately if you know the colliding record is stale.\n'
		return 1
	fi

	if [ "${#manual[@]}" -gt 0 ]; then
		printf '\nCould not verify these automatically — run them yourself:\n'
		local cmd
		for cmd in "${manual[@]}"; do
			printf '    %s\n' "$cmd"
		done
		if [ ! -t 0 ]; then
			printf '\nNot a terminal, so cannot prompt. Re-run interactively, or run the\n'
			printf 'checks above and create the record by hand.\n' >&2
			return 1
		fi
		local answer
		printf '\nClaim %s anyway? [y/N] ' "$id"
		read -r answer
		case "$answer" in
		y | Y | yes | YES) ;;
		*)
			printf 'Aborted; nothing was created.\n'
			return 1
			;;
		esac
	fi

	return 0
}

main() {
	local dry_run=0
	local -a titles=()

	while [ "$#" -gt 0 ]; do
		case "$1" in
		-h | --help)
			usage
			exit 0
			;;
		--dry-run)
			dry_run=1
			shift
			;;
		--)
			shift
			titles+=("$@")
			break
			;;
		-*)
			die "unknown option: $1 (try --help)"
			;;
		*)
			titles+=("$1")
			shift
			;;
		esac
	done

	[ "${#titles[@]}" -gt 0 ] || {
		usage >&2
		exit 1
	}

	local title="${titles[*]}"

	git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
		die "not inside a git work tree"
	local repo_root
	repo_root=$(git rev-parse --show-toplevel)
	cd "$repo_root"

	[ -f .adr-dir ] || die "no .adr-dir at $repo_root — run 'adr init docs/adr' first"
	adr_rel=$(tr -d '[:space:]' <.adr-dir)
	adr_dir="$repo_root/$adr_rel"
	[ -d "$adr_dir" ] || die "ADR directory $adr_rel does not exist"

	command -v adr >/dev/null 2>&1 ||
		die "adr-tools not on PATH (brew install adr-tools)"

	repo_slug=$(git remote get-url origin 2>/dev/null |
		sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##' ||
		true)
	[ -n "$repo_slug" ] || repo_slug="$DEFAULT_REPO"

	# Claude Code slugs a project directory by replacing "/" with "-". Use the
	# MAIN worktree's path: sessions often run from .claude/worktrees/*, which
	# slugs to a different (empty) project directory.
	local main_root
	main_root=$(git worktree list | head -n 1 | awk '{print $1}')
	memory_dir="$HOME/.claude/projects/${main_root//\//-}/memory"

	local next id
	next=$(($(highest_existing_number) + 1))
	id=$(printf '%s-%03d' "$PREFIX" "$next")

	reservation_checks "$id" || exit 2

	local slug target
	slug=$(slugify "$title")
	target="$adr_dir/$id-$slug.md"

	if [ "$dry_run" -eq 1 ]; then
		printf '\n--dry-run: would create %s\n' "${target#"$repo_root"/}"
		exit 0
	fi

	# adr-tools opens $VISUAL/$EDITOR on the file it generates. Suppress that —
	# the generated path is not the final one, and editing it before the rename
	# would be confusing. The final path is printed at the end instead.
	local generated
	generated=$(VISUAL=true EDITOR=true adr new "$title") ||
		die "adr new failed"
	[ -n "$generated" ] && [ -f "$generated" ] ||
		die "adr new did not report a created file"

	mv "$generated" "$target"

	# Rewrite adr-tools' header into the house format used by RWF-001/002:
	#   "# 1. Title" + "Date: YYYY-MM-DD" + "Accepted"
	#     ->  "# RWF-NNN: Title" + "Accepted — YYYY-MM-DD"
	local today
	today=$(date +%Y-%m-%d)
	local tmp
	tmp=$(mktemp)
	# The `N;d` on the Date line takes the following blank line with it, so the
	# H1 is not left with two blank lines under it.
	sed \
		-e "1s|^# .*|# $id: $title|" \
		-e '/^Date: [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}$/{N;d;}' \
		-e "s|^Accepted$|Accepted — $today|" \
		"$target" >"$tmp"
	mv "$tmp" "$target"

	printf '\nCreated %s\n' "${target#"$repo_root"/}"
	printf 'Next: fill in Context / Decision / Consequences, and add a row to the\n'
	printf 'README "## Architecture decisions" table.\n'
}

# Set by main(), read by the helpers above.
adr_rel=""
adr_dir=""
repo_slug=""
memory_dir=""

main "$@"
