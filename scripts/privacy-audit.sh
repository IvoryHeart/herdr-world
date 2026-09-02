#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

scan_paths=(
  .
  ':(exclude)scripts/privacy-audit.sh'
  ':(exclude)scripts/security-audit.sh'
  ':(exclude).github/workflows/release.yml'
)
failed=0

scan() {
  local label=$1
  local pattern=$2
  local matches
  matches=$(git grep -l -E "$pattern" -- "${scan_paths[@]}" || true)
  if [[ -n "$matches" ]]; then
    printf 'privacy audit: %s found in:\n%s\n' "$label" "$matches" >&2
    failed=1
  fi
}

scan 'private network identifiers' \
  '192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+|(^|[^[:alnum:]])f[cd][0-9a-f]{2}:|(^|[^0-9])169\.254\.'
scan 'environment-specific absolute paths' \
  '/(Users|home)/[^/[:space:]]+/|[A-Za-z]:[\\/]+Users[\\/]+[^\\/[:space:]]+'
scan 'credential-shaped values' \
  '(^|[^A-Za-z])(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|Bearer [A-Za-z0-9._-]{20,})'

if ((failed)); then
  exit 1
fi

printf '%s\n' 'privacy audit passed'
