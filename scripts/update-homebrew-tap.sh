#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/update-homebrew-tap.sh TAG FORMULA" >&2
  exit 2
fi

TAG="$1"
FORMULA_SOURCE="$2"
TAP_REPOSITORY="IvoryHeart/homebrew-tap"
TAP_TOKEN="${HOMEBREW_TAP_TOKEN:-}"

[[ -n "$TAP_TOKEN" ]] || {
  echo "HOMEBREW_TAP_TOKEN is required; create a fine-grained token limited to $TAP_REPOSITORY contents" >&2
  exit 1
}
FORMULA_SOURCE="$(cd "$(dirname "$FORMULA_SOURCE")" && pwd)/$(basename "$FORMULA_SOURCE")"
[[ -f "$FORMULA_SOURCE" ]] || { echo "missing generated Formula: $FORMULA_SOURCE" >&2; exit 1; }
[[ "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]] || {
  echo "invalid release tag: $TAG" >&2
  exit 1
}

formula_name="$(basename "$FORMULA_SOURCE" .rb)"
case "$formula_name" in
  herdr-world | herdr-world-rc) ;;
  *) echo "unexpected Formula name: $formula_name" >&2; exit 1 ;;
esac

temp_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/herdr-world-tap.XXXXXX")"
cleanup() { rm -rf -- "$temp_root"; }
trap cleanup EXIT
tap_root="$temp_root/homebrew-tap"
auth="$(printf 'x-access-token:%s' "$TAP_TOKEN" | base64 | tr -d '\n')"

git -c "http.extraheader=AUTHORIZATION: basic $auth" clone "https://github.com/$TAP_REPOSITORY.git" "$tap_root" >/dev/null
cd "$tap_root"
default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
default_branch="${default_branch#origin/}"
default_branch="${default_branch:-main}"
git checkout "$default_branch" >/dev/null 2>&1
git pull --ff-only origin "$default_branch" >/dev/null

mkdir -p Formula
target="Formula/$formula_name.rb"
if [[ -f "$target" ]]; then
  existing_version="$(sed -nE 's/^  version "([^"]+)"/\1/p' "$target" | head -n 1)"
  [[ -n "$existing_version" ]] || { echo "$target has no parseable version" >&2; exit 1; }
  node --input-type=module - "$TAG" "v$existing_version" "$ROOT/scripts/release-version.mjs" <<'NODE'
import { pathToFileURL } from "node:url";
const { compareReleaseTags, normalizeReleaseTag } = await import(pathToFileURL(process.argv[4]).href);
const candidate = normalizeReleaseTag(process.argv[2]);
const current = normalizeReleaseTag(process.argv[3]);
if (compareReleaseTags(candidate, current) < 0) {
  console.error(`candidate ${candidate} would regress Homebrew ${current}`);
  process.exit(1);
}
if (compareReleaseTags(candidate, current) === 0) process.exit(0);
NODE
  if cmp -s "$FORMULA_SOURCE" "$target"; then
    echo "Homebrew Formula $formula_name@$TAG is already complete"
    exit 0
  fi
  if [[ "$existing_version" == "${TAG#v}" ]]; then
    echo "Homebrew Formula $target has different content for ${TAG#v}; refusing replacement" >&2
    exit 1
  fi
fi

cp "$FORMULA_SOURCE" "$target"
git add "$target"
if git diff --cached --quiet; then
  echo "Homebrew Formula $formula_name@$TAG is already complete"
  exit 0
fi
git config user.name "Herdr World Release Bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -m "Update $formula_name to ${TAG#v}" >/dev/null
git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "$default_branch" >/dev/null
echo "Published Homebrew Formula $formula_name@$TAG"
