#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/verify-desktop-package.sh VERSION PLATFORM" >&2
  exit 2
fi

VERSION="$1"
PLATFORM="$2"
NAME="herdr-world-${VERSION}-${PLATFORM}"
ARCHIVE="$ROOT/dist-packages/$NAME.tar.gz"
CHECKSUM="$ARCHIVE.sha256"

[[ -f "$ARCHIVE" ]] || { echo "missing desktop archive: $ARCHIVE" >&2; exit 1; }
[[ -f "$CHECKSUM" ]] || { echo "missing desktop checksum: $CHECKSUM" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$ARCHIVE")" && sha256sum --check "$(basename "$CHECKSUM")")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$(dirname "$ARCHIVE")" && shasum -a 256 --check "$(basename "$CHECKSUM")")
else
  echo "no SHA-256 verification tool is available" >&2
  exit 1
fi

entries="$(tar -tzf "$ARCHIVE")"
while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  if [[ "$entry" == /* || "/$entry/" == *"/../"* ]]; then
    echo "unsafe archive member: $entry" >&2
    exit 1
  fi
  case "$entry" in
    "$NAME" | "$NAME"/*) ;;
    *)
      echo "archive member is outside the expected root $NAME: $entry" >&2
      exit 1
      ;;
  esac
done <<<"$entries"

VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/herdr-world-package.XXXXXX")"
cleanup() {
  rm -rf -- "$VERIFY_ROOT"
}
trap cleanup EXIT
tar -xzf "$ARCHIVE" -C "$VERIFY_ROOT"
BUNDLE="$VERIFY_ROOT/$NAME"

required=(
  "bin/herdr-world"
  "bin/herdr-world-bridge"
  "share/herdr-world/web/index.html"
  "share/herdr-world/web/legal/manifest.json"
  "LICENSE"
  "THIRD_PARTY_NOTICES.md"
  "UPSTREAM.md"
  "README.md"
  "third_party/licenses/Apache-2.0.txt"
  "third_party/licenses/PixiJS-MIT.txt"
  "third_party/dependencies/cargo-licenses.html"
  "third_party/dependencies/npm-licenses.txt"
  "docs/world-assets.md"
  "vendor/herdr-compat/VENDOR-MANIFEST.toml"
)
for relative_path in "${required[@]}"; do
  [[ -f "$BUNDLE/$relative_path" ]] || {
    echo "desktop archive is missing $relative_path" >&2
    exit 1
  }
done
[[ -x "$BUNDLE/bin/herdr-world" ]] || { echo "launcher is not executable" >&2; exit 1; }
[[ -x "$BUNDLE/bin/herdr-world-bridge" ]] || { echo "bridge is not executable" >&2; exit 1; }

binary_description="$(file "$BUNDLE/bin/herdr-world-bridge")"
case "$PLATFORM" in
  linux-x86_64)
    [[ "$binary_description" == *"ELF 64-bit"* && "$binary_description" == *"x86-64"* ]] || {
      echo "unexpected Linux bridge architecture: $binary_description" >&2
      exit 1
    }
    ;;
  macos-arm64)
    [[ "$binary_description" == *"Mach-O 64-bit"* \
      && "$binary_description" == *"arm64"* \
      && "$binary_description" == *"executable"* ]] || {
      echo "unexpected macOS ARM64 bridge architecture: $binary_description" >&2
      exit 1
    }
    ;;
  macos-x86_64)
    [[ "$binary_description" == *"Mach-O 64-bit"* \
      && "$binary_description" == *"x86_64"* \
      && "$binary_description" == *"executable"* ]] || {
      echo "unexpected macOS x86-64 bridge architecture: $binary_description" >&2
      exit 1
    }
    ;;
  *)
    echo "unsupported desktop platform: $PLATFORM" >&2
    exit 2
    ;;
esac

node - "$BUNDLE/share/herdr-world/web/legal" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const legalRoot = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(legalRoot, "manifest.json"), "utf8"));
if (manifest.schema_version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("invalid bundled legal manifest");
}
for (const entry of manifest.files) {
  if (typeof entry.path !== "string" || !fs.existsSync(path.join(legalRoot, entry.path))) {
    throw new Error(`missing bundled legal file: ${entry.path}`);
  }
}
NODE

host_os="$(uname -s)"
host_arch="$(uname -m)"
case "$PLATFORM:$host_os:$host_arch" in
  linux-x86_64:Linux:x86_64 | macos-arm64:Darwin:arm64 | macos-x86_64:Darwin:x86_64)
    "$BUNDLE/bin/herdr-world" --help >/dev/null
    ;;
esac
printf 'Verified %s (%s)\n' "$ARCHIVE" "$binary_description"
