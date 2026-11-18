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
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tap_repo="IvoryHeart/homebrew-tap"
formula_name="herdr-world.rb"
if [[ "$version" == *-rc.* ]]; then formula_name="herdr-world-rc.rb"; fi
if [[ "$(basename "$formula_source")" != "$formula_name" ]]; then
  echo "Formula filename must be $formula_name for $version" >&2
  exit 2
fi
sources=("$formula_source" "$script_dir/check-homebrew-runtime.rb" "$script_dir/homebrew-tap-workflow.yml")
targets=("Formula/$formula_name" ".github/scripts/check-homebrew-runtime.rb" ".github/workflows/herdr-world.yml")
matches_candidate() {
  local index
  for index in "${!sources[@]}"; do
    cmp -s "${sources[$index]}" "${targets[$index]}" || return 1
  done
}
branch="release/herdr-world-v$version"
temp_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/herdr-world-tap.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT
gh auth setup-git
gh repo clone "$tap_repo" "$temp_root/tap" -- --quiet
cd "$temp_root/tap"

if matches_candidate; then
  echo "Homebrew Formula and runtime acceptance already match $version"
  exit 0
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git fetch origin "$branch":"refs/remotes/origin/$branch"
  git switch --track -c "$branch" "origin/$branch"
  matches_candidate || {
    echo "existing Homebrew PR branch has different Formula or runtime acceptance content" >&2
    exit 1
  }
else
  git switch -c "$branch"
  mkdir -p Formula .github/scripts .github/workflows
  for index in "${!sources[@]}"; do
    cp "${sources[$index]}" "${targets[$index]}"
  done
  git add "${targets[@]}"
  git config user.name "Herdr World Release Bot"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit -m "Update Herdr World to $version"
  git push -u origin "$branch"
fi

# A fork PR can use the same branch name. Only reuse a PR from this tap whose
# exact head commit was checked against all candidate files above.
existing_pr_sha="$(gh api "repos/$tap_repo/pulls?state=open&head=IvoryHeart:$branch&base=main" \
  --jq "map(select(.head.repo.full_name == \"$tap_repo\" and .head.ref == \"$branch\" and .base.repo.full_name == \"$tap_repo\" and .base.ref == \"main\")) | .[0].head.sha // \"\"")"
if [[ -n "$existing_pr_sha" ]]; then
  if [[ "$existing_pr_sha" != "$(git rev-parse HEAD)" ]]; then
    echo "existing Homebrew PR head changed while checking its Formula" >&2
    exit 1
  fi
  echo "Homebrew Formula pull request already open for $version"
  exit 0
fi

body_file="$temp_root/pr-body.md"
cat > "$body_file" <<EOF
Update the Herdr World Formula to v$version using the checksums of its published release archives, with the matching runtime acceptance script and workflow from that release.

Review the archive URLs and checksums, then merge this PR to update the stable Homebrew channel.
EOF
gh pr create --repo "$tap_repo" --base main --head "$branch" \
  --title "Update Herdr World to $version" --body-file "$body_file"
