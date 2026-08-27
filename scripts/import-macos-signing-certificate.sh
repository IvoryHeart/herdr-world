#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Developer ID certificates can only be imported on macOS" >&2
  exit 2
fi

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${APPLE_DEVELOPER_ID_CERTIFICATE_BASE64:?APPLE_DEVELOPER_ID_CERTIFICATE_BASE64 is required}"
: "${APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD:?APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD is required}"

CERTIFICATE_PATH="$RUNNER_TEMP/herdr-world-developer-id.p12"
KEYCHAIN_PATH="$RUNNER_TEMP/herdr-world-signing.keychain-db"
KEYCHAIN_PASSWORD="$(/usr/bin/openssl rand -hex 32)"
imported=0

cleanup() {
  rm -f -- "$CERTIFICATE_PATH"
  if [[ "$imported" -ne 1 ]]; then
    /usr/bin/security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

printf '%s' "$APPLE_DEVELOPER_ID_CERTIFICATE_BASE64" |
  /usr/bin/openssl base64 -d -A -out "$CERTIFICATE_PATH"

/usr/bin/security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
/usr/bin/security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
/usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
/usr/bin/security import "$CERTIFICATE_PATH" \
  -P "$APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD" \
  -A \
  -t cert \
  -f pkcs12 \
  -k "$KEYCHAIN_PATH"
/usr/bin/security set-key-partition-list \
  -S apple-tool:,apple: \
  -k "$KEYCHAIN_PASSWORD" \
  "$KEYCHAIN_PATH" >/dev/null
/usr/bin/security list-keychains -d user -s "$KEYCHAIN_PATH"

mapfile_output="$(
  /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN_PATH" |
    /usr/bin/sed -n 's/^.*"\(Developer ID Application:.*\)".*$/\1/p'
)"
identity_count="$(printf '%s\n' "$mapfile_output" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')"
if [[ "$identity_count" -ne 1 ]]; then
  echo "expected exactly one Developer ID Application identity in the certificate; found $identity_count" >&2
  /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN_PATH" >&2 || true
  exit 1
fi

identity="$(printf '%s\n' "$mapfile_output" | /usr/bin/awk 'NF { print; exit }')"
printf 'identity=%s\n' "$identity" >> "$GITHUB_OUTPUT"
printf 'keychain_path=%s\n' "$KEYCHAIN_PATH" >> "$GITHUB_OUTPUT"
imported=1

echo "Imported $identity into an ephemeral CI keychain"
