#!/bin/sh
set -eu

plugin_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
version="$(awk -F '"' '/^version = "/ { print $2; exit }' "$plugin_root/herdr-plugin.toml")"
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' || {
  printf 'Herdr World plugin: invalid manifest version\n' >&2
  exit 1
}

mkdir -p "$plugin_root/server"
staging="$(mktemp -d "$plugin_root/server/.plugin-install.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
trap 'exit 1' HUP INT TERM

# Herdr runs this build, so the plugin never upgrades Herdr from inside it.
HERDR_WORLD_VERSION="$version" HERDR_WORLD_INSTALL_DIR="$staging" \
  HERDR_WORLD_SKIP_HERDR=1 sh "$plugin_root/scripts/install-herdr-world.sh"
if ! native_version="$("$staging/herdr-world" plugin version)" ||
  [ "$native_version" != "herdr-world $version" ]; then
  printf 'Herdr World plugin: this release has no native plugin commands. Build an unreleased checkout with `bun scripts/world-plugin.ts build-source`, then `herdr plugin link .`, or select a published tag that includes native plugin support.\n' >&2
  exit 1
fi
target="$plugin_root/server/herdr-world"
if { [ -e "$target" ] || [ -L "$target" ]; } &&
  { [ ! -f "$target" ] || [ -L "$target" ]; }; then
  printf 'Herdr World plugin: install target is not a regular file\n' >&2
  exit 1
fi
launcher="$plugin_root/server/herdr-world-plugin.exe"
if { [ -e "$launcher" ] || [ -L "$launcher" ]; } &&
  { [ ! -f "$launcher" ] || [ -L "$launcher" ]; }; then
  printf 'Herdr World plugin: launcher target is not a regular file\n' >&2
  exit 1
fi
# Frozen cached action argv invokes this basename with a direct verb. The native
# executable recognizes it and routes service work to the canonical sibling.
cp "$staging/herdr-world" "$staging/herdr-world-plugin.exe"
had_target=false
if [ -f "$target" ]; then
  cp -p "$target" "$staging/previous-herdr-world"
  had_target=true
fi
mv -f "$staging/herdr-world" "$target"
if ! mv -f "$staging/herdr-world-plugin.exe" "$launcher"; then
  if [ "$had_target" = true ]; then
    mv -f "$staging/previous-herdr-world" "$target"
  else
    rm -f "$target"
  fi
  printf 'Herdr World plugin: launcher replacement failed; restored previous binary\n' >&2
  exit 1
fi
printf 'Installed Herdr World plugin binary %s\n' "$version"
