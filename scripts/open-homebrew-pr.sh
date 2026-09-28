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
if [[ "$(gh pr list --repo "$tap_repo" --head "$branch" --state open --json number --jq 'length')" != "0" ]]; then
  echo "Homebrew Formula pull request already open for $version"
  exit 0
fi

temp_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/herdr-world-tap.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT
gh auth setup-git
gh repo clone "$tap_repo" "$temp_root/tap" -- --quiet
cd "$temp_root/tap"

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

body_file="$temp_root/pr-body.md"
cat > "$body_file" <<EOF
Update the Herdr World Formula to v$version using the checksums of its published release archives.

Review the archive URLs and checksums, then merge this PR to update the stable Homebrew channel.
EOF
gh pr create --repo "$tap_repo" --base main --head "$branch" \
  --title "Update Herdr World to $version" --body-file "$body_file"
