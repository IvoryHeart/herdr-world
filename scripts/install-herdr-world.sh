#!/bin/sh
set -eu

github_repository="IvoryHeart/herdr-world"
# VERSION= intentionally means latest.
custom_release_base="${HERDR_WORLD_RELEASE_BASE_URL-}"
install_dir="${HERDR_WORLD_INSTALL_DIR-$HOME/.local/bin}"
requested_version="${HERDR_WORLD_VERSION-}"
# Set to 1 to install only herdr-world, leaving Herdr and its integrations alone.
skip_herdr="${HERDR_WORLD_SKIP_HERDR-}"

fail() {
  printf 'Herdr World installer: %s\n' "$*" >&2
  exit 1
}

[ -n "$install_dir" ] || fail "install directory must not be empty"

for command in curl tar install uname awk cat mktemp readlink; do
  command -v "$command" >/dev/null 2>&1 ||
    fail "required command not found: $command"
done
if command -v shasum >/dev/null 2>&1; then
  checksum_tool="shasum"
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_tool="sha256sum"
else
  fail "required command not found: shasum or sha256sum"
fi

case "$(uname -s):$(uname -m)" in
Darwin:arm64 | Darwin:aarch64)
  platform="darwin-arm64"
  ;;
Darwin:x86_64 | Darwin:amd64)
  platform="darwin-x64"
  ;;
Linux:x86_64 | Linux:amd64)
  platform="linux-x64"
  ;;
Linux:arm64 | Linux:aarch64)
  platform="linux-arm64"
  ;;
*)
  fail "unsupported platform: $(uname -s) $(uname -m)"
  ;;
esac

if [ -n "$requested_version" ]; then
  case "$requested_version" in
  *[!0-9A-Za-z._-]*)
    fail "invalid HERDR_WORLD_VERSION: $requested_version"
    ;;
  esac
  archive_name="herdr-world-v${requested_version}-${platform}.tar.xz"
else
  archive_name="herdr-world-${platform}.tar.xz"
fi

# GitHub uses a different asset directory for latest and versioned releases.
# Custom mirrors keep the existing flat-directory contract.
if [ -n "$custom_release_base" ]; then
  release_base="$custom_release_base"
elif [ -n "$requested_version" ]; then
  release_base="https://github.com/$github_repository/releases/download/v${requested_version}"
else
  release_base="https://github.com/$github_repository/releases/latest/download"
fi
while [ "${release_base%/}" != "$release_base" ]; do
  release_base="${release_base%/}"
done
case "$release_base" in
*\?* | *\#*)
  fail "release base URL must not contain a query or fragment"
  ;;
esac
release_authority="${release_base#*://}"
release_authority="${release_authority%%/*}"
[ -n "$release_authority" ] || fail "invalid release base URL"
case "$release_authority" in
*@*) fail "release base URL must not contain credentials" ;;
esac
case "$release_base" in
https://*)
  curl_protocol="=https"
  ;;
http://*)
  case "$release_authority" in
  localhost | localhost:* | 127.0.0.1 | 127.0.0.1:* | "[::1]" | "[::1]":*) ;;
  *) fail "release base URL must use HTTPS unless the mirror is loopback" ;;
  esac
  curl_protocol="=http"
  ;;
*) fail "release base URL must be an HTTP(S) URL" ;;
esac
package_dir="herdr-world-${platform}"
mkdir -p "$install_dir"
target="$install_dir/herdr-world"
legacy_install_base="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-world"
legacy_launcher_target=""
if [ -L "$target" ]; then
  candidate_launcher_target="$(readlink "$target")" ||
    fail "unable to inspect existing install target"
  case "$candidate_launcher_target" in
  "$legacy_install_base"/v[0-9]*.[0-9]*.[0-9]*/bin/herdr-world)
    legacy_launcher_target="$candidate_launcher_target"
    ;;
  *) fail "install target exists but is not a regular file" ;;
  esac
elif [ -e "$target" ] && [ ! -f "$target" ]; then
  fail "install target exists but is not a regular file"
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/herdr-world-install.XXXXXX")"
target_tmp=""
backup_tmp=""

cleanup() {
  rm -rf "$tmp"
  if [ -n "${target_tmp:-}" ]; then
    rm -f "$target_tmp"
  fi
  if [ -n "${backup_tmp:-}" ]; then
    rm -f "$backup_tmp"
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

archive="$tmp/$archive_name"
checksum="$archive.sha256"
printf 'Downloading herdr-world for %s...\n' "$platform"
curl --proto "$curl_protocol" --proto-redir "$curl_protocol" \
  -fsSL "$release_base/$archive_name" -o "$archive"
curl --proto "$curl_protocol" --proto-redir "$curl_protocol" \
  --max-filesize 4096 -fsSL \
  "$release_base/$archive_name.sha256" -o "$checksum"
checksum_line="$(cat "$checksum")" || fail "unable to read package checksum"
set -f
set -- $checksum_line
set +f
[ "$#" -eq 2 ] || fail "invalid package checksum file"
expected_checksum="$1"
checksum_name="$2"
[ "${#expected_checksum}" -eq 64 ] || fail "invalid package checksum file"
case "$expected_checksum" in
*[!0-9A-Fa-f]*) fail "invalid package checksum file" ;;
esac
expected_checksum="$(printf '%s\n' "$expected_checksum" | awk '{ print tolower($0) }')"
[ "$checksum_name" = "$archive_name" ] || fail "invalid package checksum file"
if [ "$checksum_tool" = "shasum" ]; then
  actual_checksum="$(shasum -a 256 "$archive" | awk 'NR == 1 { print $1 }')"
else
  actual_checksum="$(sha256sum "$archive" | awk 'NR == 1 { print $1 }')"
fi
[ "$actual_checksum" = "$expected_checksum" ] || fail "package checksum mismatch"

tar -xJf "$archive" -C "$tmp" \
  "$package_dir/VERSION" \
  "$package_dir/herdr-world"

extracted_package_dir="$tmp/$package_dir"
version_file="$extracted_package_dir/VERSION"
binary="$extracted_package_dir/herdr-world"
[ -d "$extracted_package_dir" ] && [ ! -L "$extracted_package_dir" ] ||
  fail "package directory is invalid"
[ -f "$version_file" ] && [ ! -L "$version_file" ] ||
  fail "package VERSION file is missing or invalid"
[ -f "$binary" ] && [ ! -L "$binary" ] && [ -x "$binary" ] ||
  fail "package binary is missing, invalid, or not executable"

package_name=""
package_version=""
package_platform=""
extra_version_field=""
read -r package_name package_version package_platform extra_version_field \
  <"$version_file" || fail "invalid package VERSION file"
[ "$package_name" = "herdr-world" ] || fail "invalid package VERSION file"
[ -z "$extra_version_field" ] || fail "invalid package VERSION file"
[ -n "$package_version" ] || fail "package version is missing"
[ "$package_platform" = "$platform" ] ||
  fail "package platform is $package_platform, expected $platform"
[ -z "$requested_version" ] || [ "$package_version" = "$requested_version" ] ||
  fail "package version is $package_version, expected $requested_version"

binary_version="$("$binary" --version)"
[ "$binary_version" = "herdr-world $package_version" ] ||
  fail "binary version does not match package VERSION"

if [ -L "$target" ]; then
  [ -n "$legacy_launcher_target" ] &&
    [ "$(readlink "$target")" = "$legacy_launcher_target" ] ||
    fail "install target changed during installation"
elif [ -e "$target" ] && [ ! -f "$target" ]; then
  fail "install target changed during installation"
fi
target_tmp="$(mktemp "$install_dir/.herdr-world.new.XXXXXX")"
install -m 0755 "$binary" "$target_tmp"
backup=""
if [ -L "$target" ]; then
  rm -f "$target"
  printf 'Replacing pre-foundation launcher; legacy bundle remains at %s\n' \
    "$legacy_launcher_target"
elif [ -f "$target" ]; then
  backup="$target.previous"
  backup_tmp="$(mktemp "$install_dir/.herdr-world.previous.XXXXXX")"
  install -m 0755 "$target" "$backup_tmp"
  mv -f "$backup_tmp" "$backup"
  backup_tmp=""
fi
mv -f "$target_tmp" "$target"
target_tmp=""

printf 'Installed herdr-world %s to %s\n' "$package_version" "$target"
if [ -n "$backup" ]; then
  printf 'Previous binary saved to %s\n' "$backup"
fi
case ":${PATH:-}:" in
*":$install_dir:"*) ;;
*)
  printf 'Add %s to PATH to run herdr-world directly.\n' "$install_dir"
  ;;
esac

# Generated from the shared Unix bootstrap and verified runtime metadata.
# Regenerate with: bun scripts/herdr-bootstrap.ts
# BEGIN generated Herdr compatibility bootstrap
# A published World binary may predate missing-only CLI support. Keep this Unix
# compatibility path independent of its upgrade command, with atomic publication.
install_missing_herdr() (
  status="$("$world" herdr status)" || return 1
  case "$status" in 'Herdr is not installed.'*) ;; *) return 0 ;; esac
  install_dir="${HERDR_INSTALL_DIR:-$HOME/.local/bin}"
  if [ -e "$install_dir/herdr" ] || [ -L "$install_dir/herdr" ]; then
    if [ -f "$install_dir/herdr" ] && [ -x "$install_dir/herdr" ]; then return 0; fi
    printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$install_dir/herdr" >&2
    return 1
  fi
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) target=linux-x86_64; expected=14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d ;;
    Linux:aarch64|Linux:arm64) target=linux-aarch64; expected=17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c ;;
    Darwin:x86_64|Darwin:amd64) target=macos-x86_64; expected=5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369 ;;
    Darwin:arm64|Darwin:aarch64) target=macos-aarch64; expected=fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2 ;;
    *) return 1 ;;
  esac
  mkdir -p "$install_dir" || return 1
  staging="$(mktemp -d "$install_dir/.herdr.XXXXXXXX")" || return 1
  trap 'rm -rf "$staging"' 0
  trap 'exit 1' HUP INT TERM
  curl -fsSL --proto '=https' --proto-redir '=https' --max-time 120 -o "$staging/herdr" "https://github.com/herdrdev/herdr/releases/download/v0.9.5/herdr-$target" || return 1
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$staging/herdr" | awk '{print $1}')"
  else
    actual="$(sha256sum "$staging/herdr" | awk '{print $1}')"
  fi
  [ "$actual" = "$expected" ] || return 1
  chmod 755 "$staging/herdr" || return 1
  version="$("$staging/herdr" --version)" || return 1
  [ "$version" = 'herdr 0.9.5' ] || return 1
  # Recheck every discovery path after download; publication below still refuses
  # an entry created at the destination after this check, including symlinks.
  status="$("$world" herdr status)" || return 1
  case "$status" in 'Herdr is not installed.'*) ;; *) return 0 ;; esac
  if ln "$staging/herdr" "$install_dir/" 2>/dev/null; then
    printf '%s\n' 'Installed Herdr 0.9.5.'
  elif [ ! -f "$install_dir/herdr" ] || [ ! -x "$install_dir/herdr" ]; then
    printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$install_dir/herdr" >&2
    return 1
  fi
)
# END generated Herdr compatibility bootstrap

# Install Herdr only when absent, without relying on new options in an older
# selected World release. Never fall back to its unrestricted upgrade command.
if [ "$skip_herdr" != "1" ]; then
  printf 'Checking Herdr...\n'
  herdr_help="$("$target" herdr --help 2>/dev/null)" || herdr_help=""
  case "$herdr_help" in
  *--only-if-missing*)
    if ! "$target" herdr upgrade --install --only-if-missing --no-integrations --no-plugin; then
      printf 'Herdr World installer: Herdr installation failed; run `%s herdr upgrade --install` to retry.\n' "$target" >&2
    fi
    ;;
  *)
    world="$target"
    if ! install_missing_herdr; then
      printf 'Herdr World installer: Herdr installation failed; run `%s herdr upgrade --install` to retry.\n' "$target" >&2
    fi
    ;;
  esac
fi
