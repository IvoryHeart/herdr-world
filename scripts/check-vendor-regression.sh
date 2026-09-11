#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERDR_SOURCE="${HERDR_SRC:-}"

if [[ -z "$HERDR_SOURCE" ]]; then
  echo "HERDR_SRC must point at a clean Herdr v0.9.0 checkout" >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/herdr-vendor-regression.XXXXXX")"

copy_test_tree() {
  local target="$1"
  mkdir -p "$target/scripts" "$target/bridge" "$target/vendor"
  cp "$ROOT/scripts/check-vendor.sh" "$target/scripts/check-vendor.sh"
  cp "$ROOT/bridge/Cargo.toml" "$target/bridge/Cargo.toml"
  rsync -a --exclude target "$ROOT/vendor/herdr-compat/" "$target/vendor/herdr-compat/"
}

copy_test_tree "$TEST_ROOT"

manifest="$TEST_ROOT/vendor/herdr-compat/VENDOR-MANIFEST.toml"
sed -i \
  '/source = "src\/api\/client.rs"/,/destination_sha256 =/ {
    s/source_sha256 = "[0-9a-f]\{64\}"/source_sha256 = "0000000000000000000000000000000000000000000000000000000000000000"/
  }' \
  "$manifest"

evidence="$TEST_ROOT/check.log"
if HERDR_SRC="$HERDR_SOURCE" "$TEST_ROOT/scripts/check-vendor.sh" >"$evidence" 2>&1; then
  echo "vendor provenance regression failed: bad adapted source hash was accepted" >&2
  cat "$evidence" >&2
  exit 1
fi
if ! rg -q 'manifest source hash mismatch for src/api/client.rs' "$evidence"; then
  echo "vendor provenance regression failed: checker rejected for an unexpected reason" >&2
  cat "$evidence" >&2
  exit 1
fi

copy_test_tree "$TEST_ROOT/metadata"
metadata_manifest="$TEST_ROOT/metadata/vendor/herdr-compat/VENDOR-MANIFEST.toml"
sed -i 's/^release_tag = "v0\.9\.0"$/release_tag = "v0.8.2"/' "$metadata_manifest"
metadata_evidence="$TEST_ROOT/metadata/check.log"
if HERDR_SRC="$HERDR_SOURCE" "$TEST_ROOT/metadata/scripts/check-vendor.sh" >"$metadata_evidence" 2>&1; then
  echo "vendor provenance regression failed: bad release metadata was accepted" >&2
  cat "$metadata_evidence" >&2
  exit 1
fi
if ! rg -q 'vendor manifest must contain exactly one release_tag = "v0.9.0"' "$metadata_evidence"; then
  echo "vendor provenance regression failed: bad release metadata rejected for an unexpected reason" >&2
  cat "$metadata_evidence" >&2
  exit 1
fi

MISSING_ENTRY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/herdr-vendor-regression-missing.XXXXXX")"
copy_test_tree "$MISSING_ENTRY_ROOT"
missing_manifest="$MISSING_ENTRY_ROOT/vendor/herdr-compat/VENDOR-MANIFEST.toml"
missing_manifest_tmp="$missing_manifest.tmp"
awk '
  function flush_block() {
    if (block ~ /source = "src\/api\/client\.rs"/) {
      block = ""
    } else if (block != "") {
      printf "%s", block
    }
  }

  /^\[\[files\]\]$/ {
    flush_block()
    block = $0 "\n"
    in_entry = 1
    next
  }

  in_entry {
    block = block $0 "\n"
    next
  }

  { print }

  END {
    flush_block()
  }
' "$missing_manifest" >"$missing_manifest_tmp"
mv "$missing_manifest_tmp" "$missing_manifest"

missing_evidence="$MISSING_ENTRY_ROOT/check.log"
if HERDR_SRC="$HERDR_SOURCE" "$MISSING_ENTRY_ROOT/scripts/check-vendor.sh" >"$missing_evidence" 2>&1; then
  echo "vendor provenance regression failed: removed adapted manifest entry was accepted" >&2
  cat "$missing_evidence" >&2
  exit 1
fi
if ! rg -q 'vendor manifest entry count mismatch: expected 26, found 25' "$missing_evidence"; then
  echo "vendor provenance regression failed: missing adapted entry rejected for an unexpected reason" >&2
  cat "$missing_evidence" >&2
  exit 1
fi

echo "vendor provenance regression passed: incorrect adapted source hash was rejected"
echo "evidence: $evidence"
echo "vendor manifest metadata regression passed: incorrect release metadata was rejected"
echo "evidence: $metadata_evidence"
echo "vendor manifest completeness regression passed: removed adapted entry was rejected"
echo "evidence: $missing_evidence"
