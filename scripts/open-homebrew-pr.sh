#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
formula_source="${2:-}"
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$ ]] || [[ ! -f "$formula_source" ]]; then
  echo "usage: scripts/open-homebrew-pr.sh X.Y.Z[-rc.N] FORMULA" >&2
  exit 2
fi
[[ -n "${GH_TOKEN:-}" ]] || {
  echo "HOMEBREW_TAP_TOKEN is required" >&2
  exit 1
}

formula_source="$(cd "$(dirname "$formula_source")" && pwd)/$(basename "$formula_source")"
tap_repo="IvoryHeart/homebrew-tap"
formula_name="herdr-world.rb"
if [[ "$version" == *-rc.* ]]; then formula_name="herdr-world-rc.rb"; fi
if [[ "$(basename "$formula_source")" != "$formula_name" ]]; then
  echo "Formula filename must be $formula_name for $version" >&2
  exit 2
fi
branch="release/herdr-world-v$version"
temp_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/herdr-world-tap.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT
gh auth setup-git
gh repo clone "$tap_repo" "$temp_root/tap" -- --quiet
cd "$temp_root/tap"

if [[ -L "Formula/$formula_name" ]]; then
  echo "Homebrew Formula on main must not be a symlink" >&2
  exit 1
fi
if [[ -f "Formula/$formula_name" ]] && cmp -s "$formula_source" "Formula/$formula_name"; then
  echo "Homebrew Formula already matches $version"
  exit 0
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git fetch origin "$branch":"refs/remotes/origin/$branch"
  git switch --track -c "$branch" "origin/$branch"
  cmp -s "$formula_source" "Formula/$formula_name" || {
    echo "existing Homebrew PR branch has different Formula content" >&2
    exit 1
  }
else
  git switch -c "$branch"
  mkdir -p Formula
  cp "$formula_source" "Formula/$formula_name"
  git add "Formula/$formula_name"
  git config user.name "Herdr World Release Bot"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit -m "Update Herdr World to $version"
  git push -u origin "$branch"
fi

# Only the generated Formula may enter the automatic merge.
expected_head="$(git rev-parse HEAD)"
if [[ "$(git ls-tree HEAD -- "Formula/$formula_name")" != "100644 blob "* ]]; then
  echo "Homebrew Formula must be a regular non-executable file" >&2
  exit 1
fi
if [[ "$(git diff --name-only origin/main...HEAD)" != "Formula/$formula_name" ]]; then
  echo "Homebrew branch changes more than the generated Formula" >&2
  exit 1
fi

pull_number="$(gh api "repos/$tap_repo/pulls?state=open&head=IvoryHeart:$branch&base=main" \
  --jq "map(select(.head.repo.full_name == \"$tap_repo\" and .head.ref == \"$branch\" and .base.repo.full_name == \"$tap_repo\" and .base.ref == \"main\")) | .[0].number // empty")"
if [[ -z "$pull_number" ]]; then
  body_file="$temp_root/pr-body.md"
  cat > "$body_file" <<EOF
Update the Herdr World Formula to v$version using the checksums of its published release archives.

All release packages and published archives were verified, npm publication passed,
and both macOS Homebrew installation tests passed before this job. The release
workflow automatically merges this generated-Formula-only PR at its checked head.
EOF
  pull_url="$(gh pr create --repo "$tap_repo" --base main --head "$branch" \
    --title "Update Herdr World to $version" --body-file "$body_file")"
  pull_number="${pull_url##*/}"
  if [[ "$pull_url" != "https://github.com/$tap_repo/pull/$pull_number" ]]; then
    echo "Unexpected Homebrew pull request URL" >&2
    exit 1
  fi
fi
[[ "$pull_number" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid Homebrew pull request number" >&2
  exit 1
}

# Search results are not authority: inspect either a new or reused PR itself.
record="$(gh api "repos/$tap_repo/pulls/$pull_number" \
  --jq '[.state, .head.repo.full_name, .head.ref, .base.repo.full_name, .base.ref, .head.sha, .changed_files] | @tsv')"
IFS=$'\t' read -r pull_state head_repo head_ref base_repo base_ref head_sha changed_files <<< "$record"
if [[ "$pull_state" != open || "$head_repo" != "$tap_repo" || "$head_ref" != "$branch" ||
  "$base_repo" != "$tap_repo" || "$base_ref" != main || "$head_sha" != "$expected_head" || "$changed_files" != 1 ]]; then
  echo "Homebrew PR identity, checked head or Formula-only scope changed" >&2
  exit 1
fi

# Normal merge respects tap protections. The head guard catches concurrent edits;
# never bypass reviews/checks or leave a queued merge reported as publication.
gh pr merge "$pull_number" --repo "$tap_repo" --merge --match-head-commit "$expected_head"
merged_record="$(gh api "repos/$tap_repo/pulls/$pull_number" \
  --jq '[.merged, .head.sha, .merge_commit_sha] | @tsv')"
IFS=$'\t' read -r merged merged_head merge_sha <<< "$merged_record"
if [[ "$merged" != true || "$merged_head" != "$expected_head" || ! "$merge_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Homebrew PR has not merged at the checked head" >&2
  exit 1
fi
gh api "repos/$tap_repo/contents/Formula/$formula_name?ref=$merge_sha" --jq .content \
  | base64 -d > "$temp_root/merged-formula"
if ! cmp -s "$formula_source" "$temp_root/merged-formula"; then
  echo "Merged Homebrew Formula differs from the verified release Formula" >&2
  exit 1
fi
echo "Published Homebrew Formula v$version through https://github.com/$tap_repo/pull/$pull_number"
