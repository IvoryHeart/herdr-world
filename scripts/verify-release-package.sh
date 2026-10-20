#!/usr/bin/env bash
# Verifies one packaged platform under ./dist: checksums, update manifest,
# archive contents and the native executable format. Release runs it before
# publication and labeled release-preview PRs run it before a tag exists.
set -euo pipefail

version="$1"
platform="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

package_dir="herdr-world-$platform"
versioned_archive="herdr-world-v$version-$platform.tar.xz"
latest_archive="herdr-world-$platform.tar.xz"

for archive in "$versioned_archive" "$latest_archive"; do
  test -f "dist/$archive"
  test -f "dist/$archive.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd dist && sha256sum -c "$archive.sha256")
  else
    (cd dist && shasum -a 256 -c "$archive.sha256")
  fi
done

manifest="dist/herdr-world-$platform.update.json"
test -f "$manifest"
if command -v sha256sum >/dev/null 2>&1; then
  archive_digest="$(sha256sum "dist/$latest_archive" | awk '{ print $1 }')"
else
  archive_digest="$(shasum -a 256 "dist/$latest_archive" | awk '{ print $1 }')"
fi
expected_manifest="{\"schema\":1,\"name\":\"herdr-world\",\"version\":\"$version\",\"platform\":\"$platform\",\"archive\":\"$latest_archive\",\"sha256\":\"$archive_digest\"}"
grep -Fx "$expected_manifest" "$manifest"

extract_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/herdr-world-release.XXXXXX")"
trap 'rm -rf "$extract_dir"' EXIT
tar -xJf "dist/$versioned_archive" -C "$extract_dir"
grep -Fx "herdr-world $version $platform" "$extract_dir/$package_dir/VERSION"
for legal in LICENSE THIRD_PARTY_NOTICES.md DEPENDENCY_NOTICES.md DEPENDENCY_LICENSES.md UPSTREAM.md; do
  test -f "$extract_dir/$package_dir/$legal"
done
test -f "$extract_dir/$package_dir/LICENSES/CLAW-EMPIRE-APACHE-2.0.txt"
binary_name="herdr-world"
case "$platform" in
  windows-*) binary_name="herdr-world.exe" ;;
esac
binary="$extract_dir/$package_dir/$binary_name"

# file(1) output is diagnostic only; its wording varies between versions.
file "$binary" || true
bun "$script_dir/check-binary-format.ts" "$platform" "$binary"
if [[ "$platform" == linux-x64 ]]; then
  test "$("$binary" --version)" = "herdr-world $version"
fi
