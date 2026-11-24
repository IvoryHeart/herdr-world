#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
formula_source="${2:-}"
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$ ]] || [[ ! -f "$formula_source" ]]; then
  echo "usage: scripts/open-homebrew-pr.sh X.Y.Z[-rc.N] FORMULA" >&2
  exit 2
fi
mode="${3:-}"
prepared="${4:-}"
if [[ -n "$mode" && "$mode" != --dry-run && "$mode" != --prepared ]] || [[ -n "$mode" && -z "$prepared" ]]; then
  echo "usage: scripts/open-homebrew-pr.sh VERSION FORMULA [--dry-run OUTPUT | --prepared INPUT]" >&2
  exit 2
fi
if [[ "$mode" != --dry-run && -z "${GH_TOKEN:-}" ]]; then
  echo "HOMEBREW_TAP_TOKEN is required" >&2
  exit 1
fi

formula_source="$(cd "$(dirname "$formula_source")" && pwd)/$(basename "$formula_source")"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tap_repo="IvoryHeart/homebrew-tap"
formula_name="herdr-world.rb"
if [[ "$version" == *-rc.* ]]; then formula_name="herdr-world-rc.rb"; fi
if [[ "$(basename "$formula_source")" != "$formula_name" ]]; then
  echo "Formula filename must be $formula_name for $version" >&2
  exit 2
fi
if [[ "$mode" == --prepared ]]; then
  prepared="$(cd "$prepared" && pwd)"
  sources=("$formula_source" "$prepared/.github/scripts/check-homebrew-runtime.rb" "$prepared/.github/workflows/herdr-world.yml")
else
  sources=("$formula_source" "$script_dir/check-homebrew-runtime.rb" "$script_dir/homebrew-tap-workflow.yml")
fi
targets=("Formula/$formula_name" ".github/scripts/check-homebrew-runtime.rb" ".github/workflows/herdr-world.yml")
matches_candidate() {
  local index
  for index in "${!sources[@]}"; do
    cmp -s "${sources[$index]}" "${targets[$index]}" || return 1
    git show "HEAD:${targets[$index]}" | cmp -s "${sources[$index]}" - || return 1
  done
}
branch="release/herdr-world-v$version"
if [[ "$mode" == --dry-run ]]; then
  mkdir -p "$prepared"
  prepared="$(cd "$prepared" && pwd)"
fi
temp_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/herdr-world-tap.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT
if [[ "$mode" != --dry-run ]]; then gh auth setup-git; fi
gh repo clone "$tap_repo" "$temp_root/tap" -- --quiet --branch main --single-branch
cd "$temp_root/tap"

body_file="$temp_root/pr-body.md"
if [[ "$mode" == --prepared ]]; then
  cp "$prepared/pr-body.md" "$body_file"
  title="$(< "$prepared/pr-title.txt")"
else
  title="Update Herdr World to $version"
  cat > "$body_file" <<EOF
Update the Herdr World Formula to v$version using the checksums of its verified release archives, with the matching runtime acceptance script and workflow from that release.

Review the archive URLs and checksums, then merge this PR to update the Homebrew channel.
EOF
fi

if [[ "$mode" == --dry-run ]]; then
  mkdir -p "$prepared"
  prepared="$(cd "$prepared" && pwd)"
  for index in "${!sources[@]}"; do
    mkdir -p "$prepared/$(dirname "${targets[$index]}")" "$(dirname "${targets[$index]}")"
    cp "${sources[$index]}" "$prepared/${targets[$index]}"
    cp "${sources[$index]}" "${targets[$index]}"
  done
  if [[ "$version" == *-rc.* ]]; then
    sed 's/HERDR_WORLD_PACKAGE: herdr-world$/HERDR_WORLD_PACKAGE: herdr-world-rc/' \
      "$prepared/.github/workflows/herdr-world.yml" > "$temp_root/rc-workflow.yml"
    cp "$temp_root/rc-workflow.yml" "$prepared/.github/workflows/herdr-world.yml"
    cp "$temp_root/rc-workflow.yml" .github/workflows/herdr-world.yml
  fi
  cp "$body_file" "$prepared/pr-body.md"
  printf '%s\n' "$title" > "$prepared/pr-title.txt"
  # Include new acceptance files in the patch without creating a commit or ref.
  git add -N "${targets[@]}"
  git diff --binary HEAD -- "${targets[@]}" > "$prepared/pr.patch"
  ruby -c "$prepared/.github/scripts/check-homebrew-runtime.rb"
  echo "Prepared tap pull request for $version; no commit, push or PR created"
  exit 0
fi

if matches_candidate; then
  echo "Homebrew Formula and runtime acceptance already match $version"
  exit 0
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git fetch origin "$branch":"refs/remotes/origin/$branch"
  git switch --track -c "$branch" "origin/$branch"
  if ! matches_candidate; then
    for index in "${!sources[@]}"; do
      mkdir -p "$(dirname "${targets[$index]}")"
      cp "${sources[$index]}" "${targets[$index]}"
    done
    git add "${targets[@]}"
    git -c user.name="Herdr World Release Bot" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -m "Refresh verified Herdr World $version"
    matches_candidate || exit 1
    git push origin "$branch"
  fi
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
  matches_candidate || {
    echo "committed tap files differ from verified input; refusing to push" >&2
    exit 1
  }
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
  gh pr edit --repo "$tap_repo" "$branch" --title "$title" --body-file "$body_file"
  echo "Homebrew Formula pull request updated for $version"
  exit 0
fi

gh pr create --repo "$tap_repo" --base main --head "$branch" \
  --title "$title" --body-file "$body_file"
