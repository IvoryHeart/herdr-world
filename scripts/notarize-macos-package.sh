#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/notarize-macos-package.sh VERSION PLATFORM" >&2
  exit 2
fi

VERSION="$1"
PLATFORM="$2"
: "${APPLE_NOTARY_KEY_ID:?APPLE_NOTARY_KEY_ID is required}"
: "${APPLE_NOTARY_ISSUER_ID:?APPLE_NOTARY_ISSUER_ID is required}"
: "${APPLE_NOTARY_PRIVATE_KEY_BASE64:?APPLE_NOTARY_PRIVATE_KEY_BASE64 is required}"

if [[ ! "$VERSION" =~ ^v?[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
  echo "invalid VERSION" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packages can only be notarized on macOS" >&2
  exit 2
fi
case "$PLATFORM" in
  macos-arm64 | macos-x86_64) ;;
  *)
    echo "unsupported notarization platform: $PLATFORM" >&2
    exit 2
    ;;
esac
if [[ ! "$APPLE_NOTARY_KEY_ID" =~ ^[A-Za-z0-9]+$ ]]; then
  echo "APPLE_NOTARY_KEY_ID has an invalid format" >&2
  exit 1
fi
if [[ ! "$APPLE_NOTARY_ISSUER_ID" =~ ^[A-Fa-f0-9-]+$ ]]; then
  echo "APPLE_NOTARY_ISSUER_ID has an invalid format" >&2
  exit 1
fi

NAME="herdr-world-${VERSION}-${PLATFORM}"
STAGE="$ROOT/dist-packages/$NAME"
BRIDGE="$STAGE/bin/herdr-world-bridge"
[[ -f "$BRIDGE" ]] || {
  echo "missing packaged bridge to notarize: $BRIDGE" >&2
  exit 1
}
/usr/bin/codesign --verify --strict --verbose=2 "$BRIDGE"

NOTARY_ROOT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/herdr-world-notary.XXXXXX")"
KEY_PATH="$NOTARY_ROOT/AuthKey_${APPLE_NOTARY_KEY_ID}.p8"
ZIP_PATH="$NOTARY_ROOT/$NAME.zip"
RESULT_PATH="$NOTARY_ROOT/result.json"
cleanup() {
  rm -rf -- "$NOTARY_ROOT"
}
trap cleanup EXIT

printf '%s' "$APPLE_NOTARY_PRIVATE_KEY_BASE64" |
  /usr/bin/openssl base64 -d -A -out "$KEY_PATH"
chmod 600 "$KEY_PATH"
/usr/bin/ditto -c -k --keepParent "$STAGE" "$ZIP_PATH"

if ! /usr/bin/xcrun notarytool submit "$ZIP_PATH" \
  --key "$KEY_PATH" \
  --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER_ID" \
  --wait \
  --output-format json > "$RESULT_PATH"; then
  cat "$RESULT_PATH" >&2 || true
  exit 1
fi

status="$(node -e 'const fs = require("node:fs"); const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(r.status || ""));' "$RESULT_PATH")"
submission_id="$(node -e 'const fs = require("node:fs"); const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(r.id || ""));' "$RESULT_PATH")"
if [[ "$status" != "Accepted" || -z "$submission_id" ]]; then
  cat "$RESULT_PATH" >&2
  if [[ -n "$submission_id" ]]; then
    /usr/bin/xcrun notarytool log "$submission_id" \
      --key "$KEY_PATH" \
      --key-id "$APPLE_NOTARY_KEY_ID" \
      --issuer "$APPLE_NOTARY_ISSUER_ID" >&2 || true
  fi
  echo "Apple notarization was not accepted" >&2
  exit 1
fi

echo "Apple notarization accepted for $NAME (submission $submission_id)"
