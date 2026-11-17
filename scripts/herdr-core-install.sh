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
  fetch() {
    curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 \
      --connect-timeout 10 --max-time "$1" "$2" -o "$3"
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
