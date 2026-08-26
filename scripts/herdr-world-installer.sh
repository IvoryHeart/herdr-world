#!/usr/bin/env bash
set -euo pipefail

herdr_world_installer_resolve_script() {
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

herdr_world_installer_usage() {
  cat <<'EOF'
Usage: install [--install-only] [-- LAUNCHER_ARGS...]
       herdr-world-installer [--install-only] [-- LAUNCHER_ARGS...]

Installs this Herdr World bundle for the current user and exposes these commands:
  ~/.local/bin/herdr-world
  ~/.local/bin/herdr-world-installer

Unless --install-only is supplied, the installed launcher then offers the
consent-based Herdr installation/startup flow and starts Herdr World.

Environment overrides:
  HERDR_WORLD_INSTALL_ROOT  Versioned bundle base (default: ~/.local/share/herdr-world)
  HERDR_WORLD_BIN_DIR       User command directory (default: ~/.local/bin)
EOF
}

installer_path="$(herdr_world_installer_resolve_script "${BASH_SOURCE[0]}")"
installer_dir="$(cd "$(dirname "$installer_path")" && pwd -P)"

if [[ -f "$installer_dir/VERSION" && -x "$installer_dir/bin/herdr-world" ]]; then
  bundle_root="$installer_dir"
elif [[ -f "$installer_dir/../VERSION" && -x "$installer_dir/herdr-world" ]]; then
  bundle_root="$(cd "$installer_dir/.." && pwd -P)"
else
  echo "This installer must be run from an unpacked Herdr World desktop bundle." >&2
  exit 1
fi

version="$(tr -d '\r\n' < "$bundle_root/VERSION")"
if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "The desktop bundle contains an invalid VERSION value: $version" >&2
  exit 1
fi

install_only=false
launcher_args=()
while (($# > 0)); do
  case "$1" in
    -h | --help)
      herdr_world_installer_usage
      exit 0
      ;;
    --install-only)
      install_only=true
      shift
      ;;
    --)
      shift
      launcher_args=("$@")
      break
      ;;
    *)
      echo "Unknown installer option: $1" >&2
      herdr_world_installer_usage >&2
      exit 2
      ;;
  esac
done

if [[ "$install_only" == true && ${#launcher_args[@]} -gt 0 ]]; then
  echo "Launcher arguments cannot be used with --install-only." >&2
  exit 2
fi

if [[ -z "${HOME:-}" ]]; then
  echo "Herdr World cannot determine the current user's home directory." >&2
  exit 1
fi

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
install_base="${HERDR_WORLD_INSTALL_ROOT:-$data_home/herdr-world}"
command_dir="${HERDR_WORLD_BIN_DIR:-$HOME/.local/bin}"
case "$install_base:$command_dir" in
  /*:/*) ;;
  *) echo "Herdr World installation directories must be absolute paths." >&2; exit 1 ;;
esac

mkdir -p "$install_base" "$command_dir"
install_base="$(cd "$install_base" && pwd -P)"
command_dir="$(cd "$command_dir" && pwd -P)"
install_target="$install_base/$version"

for command_name in herdr-world herdr-world-installer; do
  command_path="$command_dir/$command_name"
  if [[ -e "$command_path" && ! -L "$command_path" ]]; then
    echo "Refusing to replace the existing non-symlink command: $command_path" >&2
    echo "Move it aside or set HERDR_WORLD_BIN_DIR to another directory." >&2
    exit 1
  fi
done

bundle_real="$(cd "$bundle_root" && pwd -P)"
target_real=""
if [[ -d "$install_target" ]]; then
  target_real="$(cd "$install_target" && pwd -P)"
fi

if [[ "$bundle_real" != "$target_real" ]]; then
  if [[ -e "$install_target" || -L "$install_target" ]]; then
    if [[ ! -d "$install_target" \
      || ! -f "$install_target/VERSION" \
      || "$(tr -d '\r\n' < "$install_target/VERSION")" != "$version" \
      || ! -x "$install_target/bin/herdr-world" \
      || ! -x "$install_target/bin/herdr-world-bridge" ]]; then
      echo "Refusing to replace an unrecognized installation at $install_target." >&2
      exit 1
    fi
  fi

  stage="$(mktemp -d "$install_base/.install-$version.XXXXXX")"
  backup=""
  installed_new=false
  committed=false
  cleanup_install() {
    local status=$?
    if [[ "$committed" != true ]]; then
      [[ -z "$stage" || ! -e "$stage" ]] || rm -rf -- "$stage"
      if [[ "$installed_new" == true && -e "$install_target" ]]; then
        rm -rf -- "$install_target"
      fi
      if [[ -n "$backup" && -e "$backup" ]]; then
        mv "$backup" "$install_target"
      fi
    fi
    return "$status"
  }
  trap cleanup_install EXIT

  cp -R "$bundle_root/." "$stage/"
  if [[ -e "$install_target" ]]; then
    backup="$install_base/.previous-$version.$$"
    [[ ! -e "$backup" ]] || { echo "Temporary backup path already exists: $backup" >&2; exit 1; }
    mv "$install_target" "$backup"
  fi
  mv "$stage" "$install_target"
  stage=""
  installed_new=true

  ln -sfn "$install_target/bin/herdr-world" "$command_dir/herdr-world"
  ln -sfn "$install_target/bin/herdr-world-installer" "$command_dir/herdr-world-installer"

  [[ -z "$backup" || ! -e "$backup" ]] || rm -rf -- "$backup"
  backup=""
  committed=true
  trap - EXIT
  echo "Installed Herdr World $version to $install_target"
else
  ln -sfn "$install_target/bin/herdr-world" "$command_dir/herdr-world"
  ln -sfn "$install_target/bin/herdr-world-installer" "$command_dir/herdr-world-installer"
  echo "Herdr World $version is already installed at $install_target"
fi

echo "Installed command: $command_dir/herdr-world"
if [[ ":${PATH:-}:" != *":$command_dir:"* ]]; then
  echo "Add $command_dir to PATH to run herdr-world by name in a new shell." >&2
fi

if [[ "$install_only" == true ]]; then
  exit 0
fi

echo "Continuing with Herdr dependency setup and Herdr World startup." >&2
exec "$install_target/bin/herdr-world" "${launcher_args[@]+"${launcher_args[@]}"}"
