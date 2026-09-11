#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT="$ROOT/vendor/herdr-compat"
EXPECTED_COMMIT="b99002ac99b09e00b4ca692436cb15a6b0d676f1"

if [[ -z "${HERDR_SRC:-}" ]]; then
  echo "HERDR_SRC must point at a clean Herdr v0.9.0 checkout" >&2
  exit 1
fi
if [[ "$(git -C "$HERDR_SRC" rev-parse HEAD)" != "$EXPECTED_COMMIT" ]]; then
  echo "HERDR_SRC must be checked out at Herdr v0.9.0 commit $EXPECTED_COMMIT" >&2
  exit 1
fi
if [[ -n "$(git -C "$HERDR_SRC" status --short)" ]]; then
  echo "HERDR_SRC must be clean; local edits would make the refresh irreproducible" >&2
  exit 1
fi

copy_exact() {
  local source="$1"
  local destination="$2"
  mkdir -p "$(dirname "$COMPAT/$destination")"
  cp "$HERDR_SRC/$source" "$COMPAT/$destination"
}

copy_exact src/api/schema.rs src/api/schema.rs
for file in agents.rs common.rs commands.rs events.rs integrations.rs panes.rs plugins.rs response.rs server.rs session.rs worktrees.rs; do
  copy_exact "src/api/schema/$file" "src/api/schema/$file"
done
# These are the remaining byte-for-byte source copies. The protocol wire and
# terminal theme are intentionally adapted for the standalone compatibility
# crate, and are preserved for the manifest hash check below.
copy_exact src/input/model.rs src/input.rs

echo "Refreshed exact bridge-required Herdr v0.9.0 sources at $EXPECTED_COMMIT."
echo "Locally adapted files were preserved; review them against VENDOR-MANIFEST.toml."
HERDR_SRC="$HERDR_SRC" "$ROOT/scripts/check-vendor.sh"
