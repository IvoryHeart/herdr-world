#!/usr/bin/env bash
set -euo pipefail

herdr_world_resolve_script() {
  local source="$1"
  local link_dir=""
  local link_target=""

  while [[ -L "$source" ]]; do
    link_dir="$(cd -P "$(dirname "$source")" && pwd)"
    link_target="$(readlink "$source")"
    case "$link_target" in
      /*) source="$link_target" ;;
      *) source="$link_dir/$link_target" ;;
    esac
  done

  printf '%s\n' "$source"
}

LAUNCHER_PATH="$(herdr_world_resolve_script "${BASH_SOURCE[0]}")"
BIN_DIR="$(cd "$(dirname "$LAUNCHER_PATH")" && pwd)"
BUNDLE_ROOT="$(cd "$BIN_DIR/.." && pwd)"
BRIDGE_BIN="$BIN_DIR/herdr-world-bridge"
STATIC_DIR="$BUNDLE_ROOT/share/herdr-world/web"

HERDR_INSTALLER_URL="https://herdr.dev/install.sh"
HERDR_INSTALL_DOCS_URL="https://herdr.dev/docs/install/"
HERDR_MINIMUM_VERSION="v0.8.2"
HERDR_TERMINAL_PROTOCOL="20"

herdr_world_default_socket() {
  local config_home="${XDG_CONFIG_HOME:-}"
  if [[ -z "$config_home" ]]; then
    [[ -n "${HOME:-}" ]] || return 1
    config_home="$HOME/.config"
  fi
  printf '%s/herdr/herdr.sock\n' "$config_home"
}

herdr_world_socket_ready() {
  [[ -S "$1" ]]
}

herdr_world_find_binary() {
  local found=""
  if found="$(command -v herdr 2>/dev/null)" && [[ -n "$found" ]]; then
    printf '%s\n' "$found"
    return 0
  fi

  if [[ -n "${HERDR_INSTALL_DIR:-}" && -x "$HERDR_INSTALL_DIR/herdr" ]]; then
    printf '%s/herdr\n' "$HERDR_INSTALL_DIR"
    return 0
  fi

  if [[ -n "${HOME:-}" && -x "$HOME/.local/bin/herdr" ]]; then
    printf '%s/.local/bin/herdr\n' "$HOME"
    return 0
  fi

  return 1
}

herdr_world_find_installer_binary() {
  if [[ -n "${HERDR_INSTALL_DIR:-}" && -x "$HERDR_INSTALL_DIR/herdr" ]]; then
    printf '%s/herdr\n' "$HERDR_INSTALL_DIR"
    return 0
  fi

  if [[ -n "${HOME:-}" && -x "$HOME/.local/bin/herdr" ]]; then
    printf '%s/.local/bin/herdr\n' "$HOME"
    return 0
  fi

  herdr_world_find_binary
}

herdr_world_version_is_supported() {
  local version="$1"
  local major
  local minor
  local patch

  version="${version#v}"
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)([-+].*)?$ ]]; then
    return 1
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"

  (( major > 0 || minor > 8 || (minor == 8 && patch >= 2) ))
}

herdr_world_binary_is_supported() {
  local herdr_bin="$1"
  local version_output=""
  local version=""

  version_output="$("$herdr_bin" -V 2>/dev/null)" || return 1
  version="${version_output##* }"
  herdr_world_version_is_supported "$version"
}

herdr_world_server_is_supported() {
  local herdr_bin="$1"
  local status_output=""
  local server_fields=""
  local server_version=""
  local server_protocol=""
  local server_compatible=""

  status_output="$("$herdr_bin" status 2>/dev/null)" || return 1
  server_fields="$(printf '%s\n' "$status_output" | awk '
    $0 == "server:" { in_server = 1; next }
    in_server && $0 !~ /^  / { in_server = 0 }
    in_server && $1 == "version:" { version = $2 }
    in_server && $1 == "protocol:" { protocol = $2 }
    in_server && $1 == "compatible:" { compatible = $2 }
    END { printf "%s\t%s\t%s\n", version, protocol, compatible }
  ')"
  IFS=$'\t' read -r server_version server_protocol server_compatible <<<"$server_fields"

  herdr_world_version_is_supported "$server_version" \
    && [[ "$server_protocol" == "$HERDR_TERMINAL_PROTOCOL" ]] \
    && [[ "$server_compatible" == "yes" ]]
}

herdr_world_server_is_reachable() {
  local herdr_bin="$1"
  local status_output=""
  local server_state=""

  status_output="$("$herdr_bin" status 2>/dev/null)" || return 1
  server_state="$(printf '%s\n' "$status_output" | awk '
    $0 == "server:" { in_server = 1; next }
    in_server && $0 !~ /^  / { in_server = 0 }
    in_server && $1 == "status:" { print $2; exit }
  ')"
  [[ "$server_state" == "running" ]]
}

herdr_world_is_interactive() {
  [[ -t 0 && -t 2 ]]
}

herdr_world_confirm() {
  local prompt="$1"
  local answer=""
  printf '%s [y/N] ' "$prompt" >&2
  IFS= read -r answer || return 1
  case "$answer" in
    y | Y | yes | YES | Yes) return 0 ;;
    *) return 1 ;;
  esac
}

herdr_world_manual_instructions() {
  cat >&2 <<EOF
Herdr World needs a running Herdr ${HERDR_MINIMUM_VERSION} or newer session using terminal protocol ${HERDR_TERMINAL_PROTOCOL}.

Install Herdr using the official instructions:
  ${HERDR_INSTALL_DOCS_URL}

Then start it from the directory containing the work you want Herdr to manage:
  cd /path/to/your/project
  herdr

Detach from Herdr with Ctrl+B, then Q, and run herdr-world again
(or bin/herdr-world from a portable bundle).
EOF
}

herdr_world_install() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "Cannot install Herdr automatically because curl is not available." >&2
    return 1
  fi

  local installer_dir=""
  local installer_path=""
  installer_dir="$(mktemp -d "${TMPDIR:-/tmp}/herdr-world-install.XXXXXX")"
  installer_path="$installer_dir/install.sh"

  if ! curl --proto '=https' --tlsv1.2 -fsSL "$HERDR_INSTALLER_URL" -o "$installer_path"; then
    rm -rf -- "$installer_dir"
    echo "Could not download the official Herdr installer." >&2
    return 1
  fi

  if ! sh "$installer_path"; then
    rm -rf -- "$installer_dir"
    echo "The Herdr installer did not complete successfully." >&2
    return 1
  fi

  rm -rf -- "$installer_dir"
}

herdr_world_ensure_supported_binary() {
  local herdr_bin=""

  if herdr_bin="$(herdr_world_find_binary)" && herdr_world_binary_is_supported "$herdr_bin"; then
    printf '%s\n' "$herdr_bin"
    return 0
  fi

  if [[ -n "$herdr_bin" ]]; then
    cat >&2 <<EOF
The installed Herdr executable is older than ${HERDR_MINIMUM_VERSION}:
  $herdr_bin

Herdr World can download ${HERDR_INSTALLER_URL} over HTTPS and run it locally
to install the latest stable Herdr.
EOF
  else
    cat >&2 <<EOF
Herdr is not installed or is not available on PATH.

Herdr World can download ${HERDR_INSTALLER_URL} over HTTPS and run it locally.
The official installer installs the latest stable Herdr (normally under ~/.local/bin)
and verifies the downloaded Herdr binary checksum. Herdr and Herdr World remain
separate commands and installations.
EOF
  fi

  if ! herdr_world_confirm "Download and run the official Herdr installer now?"; then
    herdr_world_manual_instructions
    return 1
  fi
  # This function's stdout is its resolved-binary return value. The official
  # installer is intentionally chatty on stdout, so display that output on the
  # launcher diagnostic stream instead of capturing it as part of the path.
  if ! herdr_world_install >&2; then
    herdr_world_manual_instructions
    return 1
  fi
  if ! herdr_bin="$(herdr_world_find_installer_binary)"; then
    echo "Herdr was installed, but its executable could not be found." >&2
    herdr_world_manual_instructions
    return 1
  fi
  if ! herdr_world_binary_is_supported "$herdr_bin"; then
    echo "The installed Herdr executable is still older than ${HERDR_MINIMUM_VERSION}." >&2
    herdr_world_manual_instructions
    return 1
  fi

  printf '%s\n' "$herdr_bin"
}

herdr_world_choose_workspace() {
  local default_dir="$PWD"
  local answer=""
  local resolved=""

  case "$PWD/" in
    "$BUNDLE_ROOT/"*)
      default_dir=""
      echo "Choose a project directory; the unpacked Herdr World bundle should not become your Herdr workspace." >&2
      ;;
  esac

  while true; do
    if [[ -n "$default_dir" ]]; then
      printf 'Directory containing the work Herdr should manage [%s]: ' "$default_dir" >&2
    else
      printf 'Directory containing the work Herdr should manage: ' >&2
    fi
    IFS= read -r answer || return 1
    answer="${answer:-$default_dir}"

    if [[ "$answer" == "~/"* && -n "${HOME:-}" ]]; then
      answer="$HOME/${answer#\~/}"
    fi
    if [[ -z "$answer" || ! -d "$answer" ]]; then
      echo "Enter an existing directory." >&2
      continue
    fi

    resolved="$(cd "$answer" && pwd -P)"
    printf '%s\n' "$resolved"
    return 0
  done
}

herdr_world_run_herdr() {
  local herdr_bin="$1"
  local workspace="$2"
  (
    cd "$workspace"
    "$herdr_bin"
  )
}

herdr_world_wait_for_server() {
  local herdr_bin="$1"
  local attempt
  for attempt in {1..50}; do
    if herdr_world_server_is_supported "$herdr_bin"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

herdr_world_wait_for_server_to_stop() {
  local herdr_bin="$1"
  local attempt
  for attempt in {1..50}; do
    if ! herdr_world_server_is_reachable "$herdr_bin"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

herdr_world_stop_herdr() {
  local herdr_bin="$1"
  "$herdr_bin" server stop
}

herdr_world_exec_bridge() {
  exec "$BRIDGE_BIN" --static-dir "$STATIC_DIR" "$@"
}

herdr_world_start_bridge() {
  local -a args=("$@")
  local port="8787"
  local index

  for ((index = 0; index < ${#args[@]}; index += 1)); do
    case "${args[$index]}" in
      --port)
        if ((index + 1 < ${#args[@]})); then
          port="${args[$((index + 1))]}"
        fi
        ;;
      --port=*) port="${args[$index]#--port=}" ;;
    esac
  done

  echo "Herdr is running; starting Herdr World at http://127.0.0.1:$port (press Ctrl+C to stop)." >&2
  herdr_world_exec_bridge "${args[@]+"${args[@]}"}"
}

herdr_world_main() {
  local -a bridge_args=()
  local setup_enabled=true
  local arg
  local default_socket=""
  local herdr_bin=""
  local workspace=""
  local socket_is_ready=false

  for arg in "$@"; do
    if [[ "$arg" == "--no-herdr-setup" ]]; then
      setup_enabled=false
    else
      bridge_args+=("$arg")
    fi
  done

  for arg in "${bridge_args[@]+"${bridge_args[@]}"}"; do
    case "$arg" in
      -h | --help)
        herdr_world_exec_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
        return
        ;;
    esac
  done

  # Explicit sessions and socket paths are operator-managed. The launcher must
  # not create or start a different default session in response to their state.
  for arg in "${bridge_args[@]+"${bridge_args[@]}"}"; do
    case "$arg" in
      --session | --session=*)
        herdr_world_exec_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
        return
        ;;
    esac
  done
  if [[ -n "${HERDR_SOCKET_PATH:-}" || -n "${HERDR_CLIENT_SOCKET_PATH:-}" || -n "${HERDR_SESSION:-}" ]]; then
    herdr_world_exec_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
    return
  fi

  if ! default_socket="$(herdr_world_default_socket)"; then
    echo "Herdr World could not determine the default Herdr socket because HOME and XDG_CONFIG_HOME are unset." >&2
    herdr_world_manual_instructions
    return 1
  fi

  case "${HERDR_WORLD_SETUP:-auto}" in
    never | off | 0) setup_enabled=false ;;
  esac

  if herdr_world_socket_ready "$default_socket"; then
    socket_is_ready=true
    if herdr_bin="$(herdr_world_find_binary)" \
      && herdr_world_binary_is_supported "$herdr_bin" \
      && herdr_world_server_is_supported "$herdr_bin"; then
      herdr_world_start_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
      return
    fi

    if [[ -n "$herdr_bin" ]] \
      && herdr_world_binary_is_supported "$herdr_bin" \
      && ! herdr_world_server_is_reachable "$herdr_bin"; then
      socket_is_ready=false
    fi

    # Preserve non-interactive and explicitly disabled behavior. The bridge
    # remains the authority for the detailed compatibility error in this path.
    if [[ "$setup_enabled" != true ]] || ! herdr_world_is_interactive; then
      herdr_world_exec_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
      return
    fi
  fi

  if [[ "$setup_enabled" != true ]] || ! herdr_world_is_interactive; then
    echo "No running default Herdr session was found at $default_socket." >&2
    herdr_world_manual_instructions
    return 1
  fi

  if ! herdr_bin="$(herdr_world_ensure_supported_binary)"; then
    return 1
  fi

  if [[ "$socket_is_ready" == true ]]; then
    if herdr_world_server_is_supported "$herdr_bin"; then
      herdr_world_start_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
      return
    fi

    if ! herdr_world_server_is_reachable "$herdr_bin"; then
      socket_is_ready=false
      cat >&2 <<EOF
A stale Herdr socket was found at $default_socket, but no server is running.
Continuing with normal Herdr startup.
EOF
    fi
  fi

  if [[ "$socket_is_ready" == true ]]; then
    cat >&2 <<EOF
The running default Herdr server is incompatible with Herdr World.

It must be stopped before the current Herdr can start. Stopping it exits the
terminal panes and processes owned by that server.
EOF
    if ! herdr_world_confirm "Stop the incompatible Herdr server now?"; then
      herdr_world_manual_instructions
      return 1
    fi
    if ! herdr_world_stop_herdr "$herdr_bin"; then
      echo "The incompatible Herdr server could not be stopped." >&2
      herdr_world_manual_instructions
      return 1
    fi
    if ! herdr_world_wait_for_server_to_stop "$herdr_bin"; then
      echo "The incompatible Herdr server did not stop." >&2
      herdr_world_manual_instructions
      return 1
    fi
  fi

  cat >&2 <<EOF

Herdr is available at: $herdr_bin
Starting it opens the Herdr terminal UI. Detach with Ctrl+B, then Q; the Herdr
server remains active and this launcher will then continue with Herdr World.
EOF
  if ! herdr_world_confirm "Start Herdr now?"; then
    herdr_world_manual_instructions
    return 1
  fi
  if ! workspace="$(herdr_world_choose_workspace)"; then
    echo "Herdr was not started because no workspace directory was selected." >&2
    return 1
  fi
  if ! herdr_world_run_herdr "$herdr_bin" "$workspace"; then
    echo "Herdr exited with an error; Herdr World was not started." >&2
    return 1
  fi
  if ! herdr_world_wait_for_server "$herdr_bin"; then
    echo "Herdr returned, but no compatible running session appeared at $default_socket." >&2
    herdr_world_manual_instructions
    return 1
  fi

  herdr_world_start_bridge "${bridge_args[@]+"${bridge_args[@]}"}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  herdr_world_main "$@"
fi
