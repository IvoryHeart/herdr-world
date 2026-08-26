#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "usage: scripts/package-tarball.sh VERSION [PLATFORM] [--notices-verified]" >&2
  echo "example: scripts/package-tarball.sh v0.1.0 linux-x86_64" >&2
  exit 2
fi

VERSION="$1"
PLATFORM="${2:-}"
NOTICE_MODE="${3:-}"

if [[ -n "$NOTICE_MODE" && "$NOTICE_MODE" != "--notices-verified" ]]; then
  echo "unknown packaging option: $NOTICE_MODE" >&2
  exit 2
fi

if [[ ! "$VERSION" =~ ^v?[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
  echo "invalid VERSION: use only letters, numbers, dots, underscores, plus signs, and hyphens" >&2
  exit 2
fi

if [[ -z "$PLATFORM" ]]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os:$arch" in
    linux:x86_64) PLATFORM="linux-x86_64" ;;
    darwin:arm64) PLATFORM="macos-arm64" ;;
    darwin:x86_64) PLATFORM="macos-x86_64" ;;
    *)
      echo "cannot infer platform for $os/$arch; pass PLATFORM explicitly" >&2
      exit 2
      ;;
  esac
fi

if [[ ! "$PLATFORM" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
  echo "invalid PLATFORM: use only letters, numbers, dots, underscores, plus signs, and hyphens" >&2
  exit 2
fi

PKG_ROOT="$ROOT/dist-packages"
NAME="herdr-world-${VERSION}-${PLATFORM}"
STAGE="$PKG_ROOT/$NAME"
ARCHIVE="$PKG_ROOT/$NAME.tar.gz"
CARGO_BUILD_DIR="${CARGO_TARGET_DIR:-$ROOT/bridge/target}"
if [[ "$CARGO_BUILD_DIR" != /* ]]; then
  CARGO_BUILD_DIR="$ROOT/$CARGO_BUILD_DIR"
fi

if [[ "$NOTICE_MODE" != "--notices-verified" ]]; then
  npm --prefix "$ROOT" run notices:check
fi
npm --prefix "$ROOT" run build:web
cargo build \
  --release \
  --target-dir "$CARGO_BUILD_DIR" \
  --manifest-path "$ROOT/bridge/Cargo.toml" \
  --bin herdr-web-bridge

rm -rf "$STAGE" "$ARCHIVE" "$ARCHIVE.sha256"
mkdir -p \
  "$STAGE/bin" \
  "$STAGE/share/herdr-world/web" \
  "$STAGE/third_party/licenses" \
  "$STAGE/docs" \
  "$STAGE/vendor/herdr-compat"

cp "$CARGO_BUILD_DIR/release/herdr-web-bridge" "$STAGE/bin/herdr-world-bridge"
cp -R "$ROOT/web/dist/." "$STAGE/share/herdr-world/web/"
cp "$ROOT/docs/tarball-readme.md" "$STAGE/README.md"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
cp "$ROOT/UPSTREAM.md" "$STAGE/UPSTREAM.md"
cp -R "$ROOT/third_party/." "$STAGE/third_party/"
cp "$ROOT/docs/world-assets.md" "$STAGE/docs/world-assets.md"
cp "$ROOT/vendor/herdr-compat/VENDOR-MANIFEST.toml" "$STAGE/vendor/herdr-compat/VENDOR-MANIFEST.toml"
cp "$ROOT/scripts/herdr-world-launcher.sh" "$STAGE/bin/herdr-world"
chmod +x "$STAGE/bin/herdr-world" "$STAGE/bin/herdr-world-bridge"

(
  cd "$PKG_ROOT"
  COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" "$NAME"
  if command -v sha256sum >/dev/null; then
    sha256sum "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  elif command -v shasum >/dev/null; then
    shasum -a 256 "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  else
    echo "no SHA-256 tool found; refusing to produce an unverifiable archive" >&2
    exit 1
  fi
)

echo "$ARCHIVE"
