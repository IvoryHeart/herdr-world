#!/bin/sh
set -eu

github_repository="IvoryHeart/herdr-world"
# VERSION= intentionally means latest.
custom_release_base="${HERDR_WORLD_RELEASE_BASE_URL-}"
install_dir="${HERDR_WORLD_INSTALL_DIR-$HOME/.local/bin}"
requested_version="${HERDR_WORLD_VERSION-}"
# Set to 1 to skip Herdr setup/upgrades and its integration/plugin changes.
skip_herdr="${HERDR_WORLD_SKIP_HERDR-}"
# HERDR_WORLD_SKIP_INTEGRATIONS=1 independently keeps World's integrations manual.

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

# A replacement finishes through the newly installed release's update path.
# Probe support because this script can also install older, pinned releases.
if [ -n "$backup" ] || [ -n "$legacy_launcher_target" ]; then
  update_help="$("$target" update --help 2>/dev/null)" || update_help=""
  case "$update_help" in
  *--finish-install*)
    if ! HERDR_WORLD_SKIP_HERDR="$skip_herdr" "$target" update --finish-install; then
      fail "World is installed, but finishing the upgrade failed; run \`$target update --finish-install\` to retry (preserve HERDR_WORLD_SKIP_HERDR=1 if set)."
    fi
    exit 0
    ;;
  *)
    printf 'This World release cannot finish installer upgrades automatically. Restart any running herdr-world process, then run `%s herdr upgrade` to refresh Herdr and its integrations.\n' "$target"
    ;;
  esac
fi

# Generated from scripts/herdr-core-install.sh and scripts/homebrew-herdr-bootstrap.sh.
# Regenerate with: bun scripts/herdr-bootstrap.ts
# BEGIN generated Herdr compatibility bootstrap
# herdr-core install and login setup: World's reviewed copy of the steps in
# core's official installer (https://releases.herdr.dev/core/install.sh):
# read the release manifest over HTTPS, download the archive, compare its
# SHA-256 with the manifest, unpack, run `--version`, and place herdr-core in
# ~/.local/bin with `hc` beside it only when no `hc` exists. On macOS a
# release must carry the signed Herdr Core.app: codesign verifies the
# executable that will run before anything downloaded runs, and core itself
# installs the bundle. Nothing downloaded is ever run as a script.
#
# These are functions only, so the standalone installer and Homebrew's first
# launch can embed them; World's server runs them with `sh -s -- <action>`
# locally or over SSH. They never replace, update or remove an installed core.
# HC_INSTALL_DIR places core elsewhere, as in core's own installer.

herdr_core_fail() {
  printf 'herdr-core: %s\n' "$*" >&2
  return 1
}

# Prints the installed herdr-core, if any: ~/.local/bin/herdr-core (core's
# default, often not on an SSH command's PATH), herdr-core on PATH, or an `hc`
# that says it is core (other programs also ship an `hc`).
herdr_core_find() {
  herdr_core_dir="${HC_INSTALL_DIR:-$HOME/.local/bin}"
  if [ -e "$herdr_core_dir/herdr-core" ] || [ -L "$herdr_core_dir/herdr-core" ]; then
    printf '%s\n' "$herdr_core_dir/herdr-core"
    return 0
  fi
  if herdr_core_found="$(command -v herdr-core 2>/dev/null)"; then
    printf '%s\n' "$herdr_core_found"
    return 0
  fi
  if herdr_core_found="$(command -v hc 2>/dev/null)"; then
    case "$("$herdr_core_found" --version 2>/dev/null)" in
    'hc '[0-9]*)
      printf '%s\n' "$herdr_core_found"
      return 0
      ;;
    esac
  fi
  return 1
}

# Prints the release target core publishes for this machine.
herdr_core_target() {
  case "$(uname -s)" in
  Linux) herdr_core_os=linux ;;
  Darwin) herdr_core_os=macos ;;
  *) return 1 ;;
  esac
  case "$(uname -m)" in
  x86_64 | amd64) herdr_core_arch=x86_64 ;;
  arm64 | aarch64) herdr_core_arch=aarch64 ;;
  *) return 1 ;;
  esac
  printf '%s-%s\n' "$herdr_core_os" "$herdr_core_arch"
}

# One line per fact, for World's confirmation step. Reads only; runs nothing
# but `uname`, `command -v` and an `hc --version` identity check.
herdr_core_probe() {
  printf 'target=%s\n' "$(herdr_core_target || printf 'unsupported')"
  printf 'core=%s\n' "$(herdr_core_find || true)"
  herdr_core_tui="$(command -v herdr 2>/dev/null || true)"
  if [ -z "$herdr_core_tui" ] && [ -x "$HOME/.local/bin/herdr" ]; then
    herdr_core_tui="$HOME/.local/bin/herdr"
  fi
  printf 'herdr=%s\n' "$herdr_core_tui"
  printf 'dir=%s\n' "${HC_INSTALL_DIR:-$HOME/.local/bin}"
  printf 'login=%s\n' "$(herdr_core_login_kind)"
}

herdr_core_login_kind() {
  if [ "$(uname -s)" = Darwin ]; then
    printf 'launchd\n'
  elif command -v systemctl >/dev/null 2>&1 &&
    systemctl --user show-environment >/dev/null 2>&1; then
    printf 'systemd\n'
  else
    printf 'none\n'
  fi
}

herdr_core_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# Installs herdr-core when none is installed. $1 is an exact version, or
# empty for the newest release. Progress goes to stdout as it happens.
herdr_core_install() (
  set -eu
  requested="${1:-}"
  releases="https://releases.herdr.dev"
  bin="${HC_INSTALL_DIR:-$HOME/.local/bin}"
  if existing="$(herdr_core_find)"; then
    printf 'herdr-core is already installed at %s; leaving it unchanged.\n' "$existing"
    exit 0
  fi
  target="$(herdr_core_target)" ||
    herdr_core_fail "there is no herdr-core build for $(uname -s) $(uname -m)" || exit 1
  for command in curl tar awk sed tr; do
    command -v "$command" >/dev/null 2>&1 ||
      herdr_core_fail "this machine needs $command to install herdr-core" || exit 1
  done
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    herdr_core_fail "this machine needs sha256sum or shasum to check the download" || exit 1
  if [ -n "$requested" ]; then
    case "$requested" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) herdr_core_fail "invalid herdr-core version: $requested" || exit 1 ;;
    esac
    case "$requested" in
    *[!0-9A-Za-z.+-]*) herdr_core_fail "invalid herdr-core version: $requested" || exit 1 ;;
    esac
    manifest="$releases/core/$requested/manifest.json"
  else
    manifest="$releases/core/latest.json"
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/herdr-core-install.XXXXXX")" ||
    herdr_core_fail "cannot create a temporary directory" || exit 1
  staged=""
  trap 'rm -rf "$tmp"; if [ -n "$staged" ]; then rm -f "$staged"; fi' EXIT
  trap 'exit 1' HUP INT TERM
  # curl's --retry skips a dropped connection (exit 56, "Connection reset by
  # peer"), and --retry-all-errors is missing from older curl, so retry here.
  # An HTTP error (22) is an answer, not a network fault: it fails at once.
  fetch() {
    hc_fetch_attempt=1
    while :; do
      hc_fetch_status=0
      curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 \
        --connect-timeout 10 --max-time "$1" "$2" -o "$3" || hc_fetch_status=$?
      [ "$hc_fetch_status" -ne 0 ] || return 0
      [ "$hc_fetch_status" -ne 22 ] && [ "$hc_fetch_attempt" -lt 3 ] || return "$hc_fetch_status"
      hc_fetch_attempt=$((hc_fetch_attempt + 1))
      sleep 1
    done
  }
  printf 'Reading the herdr-core release list...\n'
  fetch 60 "$manifest" "$tmp/manifest.json" ||
    herdr_core_fail "could not reach $manifest; check this machine's internet connection" || exit 1
  # The manifest is flat enough for sed once spaces are gone, as in core's installer.
  flat="$(tr -d '\n\r\t ' <"$tmp/manifest.json")"
  entry="$(printf '%s' "$flat" | sed -n "s/.*\"$target\":{\([^}]*\)}.*/\1/p")"
  url="$(printf '%s' "$entry" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
  want="$(printf '%s' "$entry" | sed -n 's/.*"sha256":"\([^"]*\)".*/\1/p')"
  version="$(printf '%s' "$flat" | sed -n 's/^{"version":"\([^"]*\)".*/\1/p')"
  [ -n "$url" ] && [ -n "$want" ] && [ -n "$version" ] ||
    herdr_core_fail "the release list has no herdr-core build for $target" || exit 1
  case "$url" in
  "$releases"/core/*) ;;
  *) herdr_core_fail "the release list points outside $releases" || exit 1 ;;
  esac
  case "$url" in
  *[!A-Za-z0-9/:._+-]*) herdr_core_fail "the release list has an invalid download address" || exit 1 ;;
  esac
  [ "${#want}" -eq 64 ] ||
    herdr_core_fail "the release list has an invalid checksum" || exit 1
  case "$want" in
  *[!0-9a-f]*) herdr_core_fail "the release list has an invalid checksum" || exit 1 ;;
  esac
  case "$version" in
  *[!0-9A-Za-z.+-]*) herdr_core_fail "the release list has an invalid version" || exit 1 ;;
  esac
  [ -z "$requested" ] || [ "$version" = "$requested" ] ||
    herdr_core_fail "the release list is for $version, not $requested" || exit 1
  printf 'Downloading herdr-core %s for %s...\n' "$version" "$target"
  fetch 600 "$url" "$tmp/hc.tar.gz" ||
    herdr_core_fail "the download failed; check this machine's internet connection" || exit 1
  [ "$(herdr_core_sha256 "$tmp/hc.tar.gz")" = "$want" ] ||
    herdr_core_fail "the download is damaged (checksum mismatch); try again" || exit 1
  printf 'Checksum verified. Unpacking...\n'
  mkdir "$tmp/release" || exit 1
  tar -xzf "$tmp/hc.tar.gz" -C "$tmp/release" ||
    herdr_core_fail "could not unpack the download" || exit 1
  core="$tmp/release/herdr-core"
  [ -f "$core" ] && [ ! -L "$core" ] ||
    herdr_core_fail "the download holds no herdr-core" || exit 1
  bundled="$tmp/release/Herdr Core.app/Contents/MacOS/herdr-core"
  bundle=0
  # On macOS nothing downloaded runs until Apple's codesign has verified the
  # executable that will run: a release without the signed Herdr Core.app is
  # refused, never installed unchecked. A user install under HOME runs and
  # installs the verified bundle (core's own installer does the same); any
  # other install runs the top-level herdr-core only once it is verified as
  # signed by the same Herdr team.
  if [ "$(uname -s)" = Darwin ]; then
    team='anchor apple generic and certificate leaf[subject.OU] = "2W9652Q7QR"'
    [ -d "$tmp/release/Herdr Core.app" ] && [ ! -L "$tmp/release/Herdr Core.app" ] &&
      [ -f "$bundled" ] && [ ! -L "$bundled" ] &&
      /usr/bin/codesign --verify --strict -R "=identifier \"dev.herdr.core\" and $team" "$tmp/release/Herdr Core.app" ||
      herdr_core_fail "the download is not a signed Herdr release" || exit 1
    if [ "$(id -u)" != 0 ]; then
      case "$bin" in "$HOME"/*) bundle=1 ;; esac
    fi
    if [ "$bundle" = 1 ]; then
      core="$bundled"
    else
      /usr/bin/codesign --verify --strict -R "=$team" "$core" ||
        herdr_core_fail "the download is not a signed Herdr release" || exit 1
    fi
  fi
  mkdir -p "$bin" || herdr_core_fail "cannot create $bin" || exit 1
  if ! "$core" --version >/dev/null 2>&1; then
    # A noexec temporary directory: check it again beside its destination.
    staged="$(mktemp "$bin/.herdr-core.staged.XXXXXX")" ||
      herdr_core_fail "cannot stage herdr-core in $bin" || exit 1
    cp "$core" "$staged" && chmod 755 "$staged" ||
      herdr_core_fail "cannot stage herdr-core in $bin" || exit 1
    core="$staged"
  fi
  [ "$("$core" --version 2>/dev/null)" = "hc $version" ] ||
    herdr_core_fail "the downloaded herdr-core does not run on this machine" || exit 1
  # Another installer may have finished meanwhile: never replace its core.
  if existing="$(herdr_core_find)"; then
    printf 'herdr-core appeared at %s during the download; leaving it unchanged.\n' "$existing"
    exit 0
  fi
  if [ "$bundle" = 1 ]; then
    "$bundled" --hc-install-bundle "$bundled" "$bin/herdr-core" ||
      herdr_core_fail "installing Herdr Core.app failed" || exit 1
  else
    new="$(mktemp "$bin/.herdr-core.new.XXXXXX")" ||
      herdr_core_fail "cannot write herdr-core into $bin" || exit 1
    staged="$new"
    cp "$core" "$new" && chmod 755 "$new" ||
      herdr_core_fail "cannot write herdr-core into $bin" || exit 1
    # A hard link publishes atomically and fails if anything took the name.
    ln "$new" "$bin/herdr-core" 2>/dev/null ||
      herdr_core_fail "$bin/herdr-core appeared during installation; leaving it unchanged" || exit 1
  fi
  if ! command -v hc >/dev/null 2>&1 && [ ! -e "$bin/hc" ] && [ ! -L "$bin/hc" ]; then
    ln -s herdr-core "$bin/hc" || true
  fi
  printf 'Installed herdr-core %s into %s.\n' "$version" "$bin/herdr-core"
)

# Starts core at each login through core's own start (`herdr-core server start`
# picks systemd-run or launchd itself): a one-shot systemd user unit on Linux,
# a LaunchAgent on macOS. Rewrites only a definition World wrote. $2 is the
# core session (HC_SESSION); a session other than `default` gets its own entry.
herdr_core_enable_login() (
  set -eu
  core="$1"
  session="${2:-default}"
  marker="Generated by Herdr World: starts herdr-core at login."
  case "$session" in
  default) suffix="" ;;
  [A-Za-z0-9_-]*)
    case "$session" in
    *[!A-Za-z0-9._-]*) herdr_core_fail "invalid herdr-core session: $session" || exit 1 ;;
    esac
    suffix="-$session"
    ;;
  *) herdr_core_fail "invalid herdr-core session: $session" || exit 1 ;;
  esac
  case "$core" in
  /*) ;;
  *) herdr_core_fail "herdr-core's path must be absolute" || exit 1 ;;
  esac
  case "$core" in
  *[!A-Za-z0-9/._+-]*)
    printf 'Not starting herdr-core at login: its path has characters a login entry cannot hold.\n'
    exit 0
    ;;
  esac
  case "$(herdr_core_login_kind)" in
  launchd)
    file="$HOME/Library/LaunchAgents/dev.herdr-world.herdr-core$suffix.plist"
    if [ -e "$file" ] && ! grep -qF "$marker" "$file"; then
      printf 'Leaving %s unchanged: Herdr World did not write it.\n' "$file"
      exit 0
    fi
    mkdir -p "$(dirname "$file")" || herdr_core_fail "cannot create $(dirname "$file")" || exit 1
    cat >"$file.new" <<EOF || herdr_core_fail "cannot write $file" || exit 1
<?xml version="1.0" encoding="UTF-8"?>
<!-- $marker -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.herdr-world.herdr-core$suffix</string>
  <key>ProgramArguments</key>
  <array>
    <string>$core</string>
    <string>server</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HC_SESSION</key>
    <string>$session</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF
    mv -f "$file.new" "$file" || herdr_core_fail "cannot write $file" || exit 1
    printf 'herdr-core will start at login (LaunchAgent %s).\n' "$file"
    ;;
  systemd)
    unit="herdr-core-login$suffix.service"
    file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"
    if [ -e "$file" ] && ! grep -qF "$marker" "$file"; then
      printf 'Leaving %s unchanged: Herdr World did not write it.\n' "$file"
      exit 0
    fi
    mkdir -p "$(dirname "$file")" || herdr_core_fail "cannot create $(dirname "$file")" || exit 1
    # RemainAfterExit and KillMode=process: whatever core starts outlives this unit.
    cat >"$file.new" <<EOF || herdr_core_fail "cannot write $file" || exit 1
# $marker
[Unit]
Description=Start herdr-core at login (set up by Herdr World)

[Service]
Type=oneshot
Environment=HC_SESSION=$session
ExecStart=$core server start
RemainAfterExit=yes
KillMode=process
TimeoutStartSec=60

[Install]
WantedBy=default.target
EOF
    mv -f "$file.new" "$file" || herdr_core_fail "cannot write $file" || exit 1
    systemctl --user daemon-reload &&
      systemctl --user enable "$unit" >/dev/null 2>&1 ||
      herdr_core_fail "could not enable the herdr-core login unit" || exit 1
    printf 'herdr-core will start at login (systemd user unit %s).\n' "$file"
    ;;
  *)
    printf 'Not starting herdr-core at login: this machine has no systemd user manager or launchd.\n'
    ;;
  esac
)

# Installs core when missing, starts it at login and starts it now. $1: an
# exact version, or empty for the newest; $2: the core session (default
# `default`), so a saved connection's session is the one started.
herdr_core_setup() (
  set -eu
  session="${2:-default}"
  herdr_core_install "${1:-}" || exit 1
  core="$(herdr_core_find)" || herdr_core_fail "herdr-core is missing after installation" || exit 1
  herdr_core_enable_login "$core" "$session" || exit 1
  printf 'Starting herdr-core...\n'
  HC_SESSION="$session" "$core" server start >/dev/null || herdr_core_fail "herdr-core did not start; run \`$core server start\` there to see why" || exit 1
  printf 'herdr-core is running.\n'
)

# World's runtime bootstrap for the standalone installer and Homebrew's first
# launch. herdr-core comes first: when neither herdr-core nor the Herdr TUI is
# installed, install herdr-core and start it now and at each login. An installed
# runtime is used as it is; nothing is replaced or updated. This runs the World
# binary's `herdr status` only, so it also works with older pinned releases.
# A status result is presence evidence only when its selected file is executable.
# Keep the running-server state independent of binary discovery.
check_herdr_presence() {
  herdr_status="$("$world" herdr status)" || return 1
  IFS= read -r herdr_status_line <<EOF || return 1
$herdr_status
EOF
  case "$herdr_status_line" in
    'Herdr is not installed.') herdr_missing=1 ;;
    'Herdr is running ('*) herdr_missing=0 ;;
    'Herdr is installed but not running: '*)
      herdr_candidate="${herdr_status_line#Herdr is installed but not running: }"
      if [ ! -f "$herdr_candidate" ] || [ ! -x "$herdr_candidate" ]; then
        printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$herdr_candidate" >&2
        return 1
      fi
      herdr_missing=0
      ;;
    *) return 1 ;;
  esac
}

# Save the core just installed as a World connection, so World connects to it
# when it starts. World reads core.lock and never starts core itself. This runs
# only without the Herdr TUI, so core is the default and World saves no Local
# Herdr profile. An older World, or one already serving, refuses; the person
# adds it in the UI instead.
herdr_core_register() {
  if "$world" connections add core-local --core --default --auto-connect --label 'herdr-core on this computer' >/dev/null 2>&1; then
    printf 'World will connect to herdr-core when it starts.\n'
  else
    printf 'If World does not list herdr-core, add it under Hosts > Manage connections.\n'
  fi
}

install_missing_runtime() (
  check_herdr_presence || return 1
  [ "$herdr_missing" = 1 ] || return 0
  if herdr_core_find >/dev/null; then return 0; fi
  herdr_core_setup || return 1
  herdr_core_register
)
# END generated Herdr compatibility bootstrap

# With neither herdr-core nor Herdr installed, install herdr-core and start it
# now and at login. Uses only the selected release's `herdr status`.
if [ "$skip_herdr" != "1" ]; then
  printf 'Checking Herdr runtimes...\n'
  world="$target"
  if ! install_missing_runtime; then
    printf 'Herdr World installer: the runtime check or herdr-core installation failed; repair any reported entry, then run `%s herdr upgrade --install` to retry.\n' "$target" >&2
  fi
fi

# Use the release's integration code, including its discovery, safety and removal
# preferences. Older pinned releases may not offer automatic World integrations.
integration_help="$("$target" integration --help 2>/dev/null)" || integration_help=""
case "$integration_help" in
*'integration sync'*)
  if ! "$target" integration sync; then
    printf 'World integrations were not fully installed; run `%s integration sync` to retry.\n' "$target" >&2
  fi
  ;;
*)
  printf 'This World release does not support automatic World integrations.\n'
  ;;
esac
