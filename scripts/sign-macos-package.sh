#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/sign-macos-package.sh VERSION PLATFORM" >&2
  exit 2
fi

VERSION="$1"
PLATFORM="$2"
: "${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY is required}"

if [[ ! "$VERSION" =~ ^v?[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
  echo "invalid VERSION" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packages can only be signed on macOS" >&2
  exit 2
fi
case "$PLATFORM" in
  macos-arm64 | macos-x86_64) ;;
  *)
    echo "unsupported signing platform: $PLATFORM" >&2
    exit 2
    ;;
esac

NAME="herdr-world-${VERSION}-${PLATFORM}"
PKG_ROOT="$ROOT/dist-packages"
STAGE="$PKG_ROOT/$NAME"
BRIDGE="$STAGE/bin/herdr-world-bridge"
ARCHIVE="$PKG_ROOT/$NAME.tar.gz"

[[ -f "$BRIDGE" && -x "$BRIDGE" ]] || {
  echo "missing packaged bridge to sign: $BRIDGE" >&2
  exit 1
}

codesign_args=(
  --force
  --identifier dev.herdr.world.bridge
  --options runtime
  --sign "$MACOS_SIGNING_IDENTITY"
)
if [[ "$MACOS_SIGNING_IDENTITY" != "-" ]]; then
  codesign_args+=(--timestamp)
fi

/usr/bin/codesign "${codesign_args[@]}" "$BRIDGE"
/usr/bin/codesign --verify --strict --verbose=2 "$BRIDGE"

signature_details="$(/usr/bin/codesign --display --verbose=4 "$BRIDGE" 2>&1)"
if [[ "$signature_details" != *"flags="*"runtime"* ]]; then
  echo "signed bridge is missing hardened runtime" >&2
  printf '%s\n' "$signature_details" >&2
  exit 1
fi

if [[ "${HERDR_WORLD_REQUIRE_DEVELOPER_ID:-0}" == "1" ]]; then
  if [[ "$MACOS_SIGNING_IDENTITY" == "-" \
    || "$signature_details" == *"Signature=adhoc"* \
    || "$signature_details" != *"Authority=Developer ID Application:"* \
    || "$signature_details" != *"Timestamp="* ]]; then
    echo "release package does not have a timestamped Developer ID Application signature" >&2
    printf '%s\n' "$signature_details" >&2
    exit 1
  fi
fi

rm -f -- "$ARCHIVE" "$ARCHIVE.sha256"
(
  cd "$PKG_ROOT"
  COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" "$NAME"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  else
    shasum -a 256 "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  fi
)

echo "Signed and repacked $ARCHIVE"
