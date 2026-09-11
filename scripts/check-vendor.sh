#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT="$ROOT/vendor/herdr-compat"
EXPECTED_HERDR_COMMIT="b99002ac99b09e00b4ca692436cb15a6b0d676f1"
EXPECTED_HERDR_RELEASE="v0.9.0"

# This is the reviewed bridge compatibility surface. Keep the set explicit so
# deleting a manifest entry cannot silently narrow the provenance claim.
EXPECTED_MANIFEST_ENTRIES=(
  "src/api/schema.rs|src/api/schema.rs"
  "src/api/schema/agents.rs|src/api/schema/agents.rs"
  "src/api/schema/common.rs|src/api/schema/common.rs"
  "src/api/schema/commands.rs|src/api/schema/commands.rs"
  "src/api/schema/events.rs|src/api/schema/events.rs"
  "src/api/schema/integrations.rs|src/api/schema/integrations.rs"
  "src/api/schema/panes.rs|src/api/schema/panes.rs"
  "src/api/schema/plugins.rs|src/api/schema/plugins.rs"
  "src/api/schema/response.rs|src/api/schema/response.rs"
  "src/api/schema/server.rs|src/api/schema/server.rs"
  "src/api/schema/session.rs|src/api/schema/session.rs"
  "src/api/schema/worktrees.rs|src/api/schema/worktrees.rs"
  "src/api/schema/tests.rs|src/api/schema/tests.rs"
  "src/protocol/wire.rs|src/protocol/wire.rs"
  "src/protocol/wire.rs|src/protocol/wire/upstream_wire_tests.rs"
  "src/api/client.rs|src/api/client.rs"
  "src/api/status.rs|src/api/status.rs"
  "src/api/schema/tabs.rs|src/api/schema/tabs.rs"
  "src/api/schema/workspaces.rs|src/api/schema/workspaces.rs"
  "src/input/model.rs|src/input.rs"
  "src/raw_input.rs|src/raw_input.rs"
  "src/ipc.rs|src/ipc.rs"
  "src/logging.rs|src/logging.rs"
  "src/popup_size.rs|src/popup_size.rs"
  "src/server/socket_paths.rs|src/server/socket_paths.rs"
  "src/terminal_theme.rs|src/terminal_theme.rs"
)

if ! command -v rg >/dev/null; then
  echo "ripgrep (rg) is required for vendor checks" >&2
  exit 1
fi

required=(
  "$COMPAT/Cargo.toml"
  "$COMPAT/VENDOR-MANIFEST.toml"
  "$COMPAT/src/lib.rs"
  "$COMPAT/src/api/client.rs"
  "$COMPAT/src/api/status.rs"
  "$COMPAT/src/api/schema.rs"
  "$COMPAT/src/api/schema"
  "$COMPAT/src/api/schema/agents.rs"
  "$COMPAT/src/api/schema/common.rs"
  "$COMPAT/src/api/schema/events.rs"
  "$COMPAT/src/api/schema/integrations.rs"
  "$COMPAT/src/api/schema/panes.rs"
  "$COMPAT/src/api/schema/plugins.rs"
  "$COMPAT/src/api/schema/response.rs"
  "$COMPAT/src/api/schema/server.rs"
  "$COMPAT/src/api/schema/session.rs"
  "$COMPAT/src/api/schema/tabs.rs"
  "$COMPAT/src/api/schema/tests.rs"
  "$COMPAT/src/api/schema/workspaces.rs"
  "$COMPAT/src/api/schema/worktrees.rs"
  "$COMPAT/src/ipc.rs"
  "$COMPAT/src/input.rs"
  "$COMPAT/src/logging.rs"
  "$COMPAT/src/popup_size.rs"
  "$COMPAT/src/protocol.rs"
  "$COMPAT/src/protocol/wire.rs"
  "$COMPAT/src/protocol/wire/upstream_wire_tests.rs"
  "$COMPAT/src/terminal_theme.rs"
  "$COMPAT/src/raw_input.rs"
  "$COMPAT/src/server/socket_paths.rs"
)

for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "missing Herdr compatibility vendor file: $path" >&2
    exit 1
  fi
done

if [[ -d "$ROOT/vendor/herdr" ]]; then
  echo "full vendor/herdr snapshot is not allowed; keep only vendor/herdr-compat" >&2
  exit 1
fi

if rg -n '#\[path[[:space:]]*=' "$ROOT/bridge" "$COMPAT" >/dev/null; then
  echo "build-time Rust #[path] imports are not allowed in bridge or vendor/herdr-compat" >&2
  rg -n '#\[path[[:space:]]*=' "$ROOT/bridge" "$COMPAT" >&2
  exit 1
fi

if rg -n '\bcustom_status\b' "$COMPAT" >/dev/null; then
  echo "obsolete custom_status fields are not allowed in the Herdr 0.9.0 compatibility copy" >&2
  rg -n '\bcustom_status\b' "$COMPAT" >&2
  exit 1
fi

parse_manifest_entries() {
  awk '
    function fail(message) {
      print "invalid vendor manifest: " message > "/dev/stderr"
      failed = 1
      exit 1
    }

    function parse_quoted(name, line, value) {
      value = line
      sub("^[[:space:]]*" name "[[:space:]]*=[[:space:]]*\"", "", value)
      if (value == line || value !~ /\"[[:space:]]*$/) {
        fail(name " must be a quoted string")
      }
      sub("\"[[:space:]]*$", "", value)
      if (value ~ /\"/) {
        fail(name " contains an unescaped quote")
      }
      return value
    }

    function emit(    source_key, destination_key) {
      if (!has_source) {
        fail("[[files]] entry is missing source")
      }
      if (!has_destination) {
        fail("[[files]] entry is missing destination")
      }
      if (!has_source_sha) {
        fail("[[files]] entry is missing source_sha256")
      }
      if (!has_destination_sha) {
        fail("[[files]] entry is missing destination_sha256")
      }
      if (source == "" || destination == "") {
        fail("[[files]] entry has an empty source or destination path")
      }
      if (source ~ /^\// || source ~ /(^|\/)\.\.?($|\/)/) {
        fail("source path must be relative and cannot contain dot components: " source)
      }
      if (destination ~ /^\// || destination ~ /(^|\/)\.\.?($|\/)/) {
        fail("destination path must be relative and cannot contain dot components: " destination)
      }
      if (source ~ /[[:cntrl:]|]/ || destination ~ /[[:cntrl:]|]/) {
        fail("source and destination paths contain unsupported characters")
      }
      if (length(source_sha) != 64 || source_sha ~ /[^0-9a-f]/) {
        fail("source_sha256 must be 64 lowercase hexadecimal characters for " source)
      }
      if (length(destination_sha) != 64 || destination_sha ~ /[^0-9a-f]/) {
        fail("destination_sha256 must be 64 lowercase hexadecimal characters for " destination)
      }
      if (seen_destination[destination]++) {
        fail("destination path is not unique: " destination)
      }
      print source "\t" destination "\t" source_sha "\t" destination_sha
      entries++
    }

    /^\[\[files\]\][[:space:]]*$/ {
      if (in_entry) {
        emit()
      }
      in_entry = 1
      has_source = has_destination = has_source_sha = has_destination_sha = 0
      source = destination = source_sha = destination_sha = ""
      next
    }

    in_entry && /^[[:space:]]*source[[:space:]]*=/ {
      if (has_source) {
        fail("duplicate source field")
      }
      has_source = 1
      source = parse_quoted("source", $0)
      next
    }

    in_entry && /^[[:space:]]*destination[[:space:]]*=/ {
      if (has_destination) {
        fail("duplicate destination field")
      }
      has_destination = 1
      destination = parse_quoted("destination", $0)
      next
    }

    in_entry && /^[[:space:]]*source_sha256[[:space:]]*=/ {
      if (has_source_sha) {
        fail("duplicate source_sha256 field")
      }
      has_source_sha = 1
      source_sha = parse_quoted("source_sha256", $0)
      next
    }

    in_entry && /^[[:space:]]*destination_sha256[[:space:]]*=/ {
      if (has_destination_sha) {
        fail("duplicate destination_sha256 field")
      }
      has_destination_sha = 1
      destination_sha = parse_quoted("destination_sha256", $0)
      next
    }

    END {
      if (failed) {
        exit 1
      }
      if (in_entry) {
        emit()
      }
      if (entries == 0) {
        fail("manifest has no [[files]] entries")
      }
    }
  ' "$COMPAT/VENDOR-MANIFEST.toml"
}

verify_manifest_metadata() {
  local expected_line="$1"
  local matches

  matches="$(rg -Nxc "^${expected_line}$" "$COMPAT/VENDOR-MANIFEST.toml" || true)"
  if [[ "$matches" != "1" ]]; then
    echo "vendor manifest must contain exactly one $expected_line" >&2
    return 1
  fi
}

verify_manifest_hashes() {
  local source_root="${1:-}"
  local manifest_entries
  local source destination expected_source_hash expected_destination_hash
  local actual_source_hash actual_destination_hash
  local entry_count=0
  local expected_entry expected_source expected_destination manifest_key
  declare -A actual_manifest_entries=()

  if ! manifest_entries="$(parse_manifest_entries)"; then
    return 1
  fi

  while IFS=$'\t' read -r source destination expected_source_hash expected_destination_hash; do
    [[ -n "$source" ]] || continue
    if [[ ! -f "$COMPAT/$destination" ]]; then
      echo "manifest destination is missing: $destination" >&2
      return 1
    fi
    manifest_key="$source|$destination"
    actual_manifest_entries["$manifest_key"]=1
    actual_destination_hash="$(sha256sum "$COMPAT/$destination" | awk '{print $1}')"
    if [[ "$actual_destination_hash" != "$expected_destination_hash" ]]; then
      echo "manifest destination hash mismatch for $destination" >&2
      echo "expected: $expected_destination_hash" >&2
      echo "found:    $actual_destination_hash" >&2
      return 1
    fi

    if [[ -n "$source_root" ]]; then
      if [[ ! -f "$source_root/$source" ]]; then
        echo "manifest source is missing from HERDR_SRC: $source" >&2
        return 1
      fi
      actual_source_hash="$(sha256sum "$source_root/$source" | awk '{print $1}')"
      if [[ "$actual_source_hash" != "$expected_source_hash" ]]; then
        echo "manifest source hash mismatch for $source (destination $destination)" >&2
        echo "expected: $expected_source_hash" >&2
        echo "found:    $actual_source_hash" >&2
        return 1
      fi
    fi
    entry_count=$((entry_count + 1))
  done <<< "$manifest_entries"

  if (( entry_count == 0 )); then
    echo "vendor manifest contains no file entries" >&2
    return 1
  fi
  if (( entry_count != ${#EXPECTED_MANIFEST_ENTRIES[@]} )); then
    echo "vendor manifest entry count mismatch: expected ${#EXPECTED_MANIFEST_ENTRIES[@]}, found $entry_count" >&2
    return 1
  fi
  for expected_entry in "${EXPECTED_MANIFEST_ENTRIES[@]}"; do
    expected_source="${expected_entry%%|*}"
    expected_destination="${expected_entry#*|}"
    manifest_key="$expected_source|$expected_destination"
    if [[ -z "${actual_manifest_entries[$manifest_key]+present}" ]]; then
      echo "vendor manifest is missing expected entry: $expected_source -> $expected_destination" >&2
      return 1
    fi
  done
  if [[ -n "$source_root" ]]; then
    echo "verified upstream and destination hashes for $entry_count vendor manifest entries"
  fi
}

verify_manifest_metadata "release_tag = \"$EXPECTED_HERDR_RELEASE\""
verify_manifest_metadata "upstream_commit = \"$EXPECTED_HERDR_COMMIT\""
verify_manifest_metadata "protocol_version = 22"

unexpected_path_deps="$(
  rg -n '(^|[[:space:]{,])path[[:space:]]*=' "$ROOT/bridge/Cargo.toml" "$COMPAT/Cargo.toml" \
    | grep -Ev 'path[[:space:]]*=[[:space:]]*"src/(main|lib)\.rs"' \
    | grep -Ev 'path[[:space:]]*=[[:space:]]*"\.\./vendor/herdr-compat"' \
    || true
)"
if [[ -n "$unexpected_path_deps" ]]; then
  echo "unexpected Cargo path dependency; only ../vendor/herdr-compat is allowed" >&2
  echo "$unexpected_path_deps" >&2
  exit 1
fi

if [[ -n "${HERDR_SRC:-}" ]]; then
  if [[ ! -d "$HERDR_SRC/src" ]]; then
    echo "HERDR_SRC must point at a Herdr checkout containing src/" >&2
    exit 1
  fi

  upstream_commit="$(git -C "$HERDR_SRC" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$upstream_commit" != "$EXPECTED_HERDR_COMMIT" ]]; then
    echo "HERDR_SRC must be a Herdr v0.9.0 checkout at $EXPECTED_HERDR_COMMIT" >&2
    echo "found: ${upstream_commit:-not a git checkout}" >&2
    exit 1
  fi

  if [[ -n "$(git -C "$HERDR_SRC" status --short)" ]]; then
    echo "HERDR_SRC must be a clean Herdr v0.9.0 checkout" >&2
    git -C "$HERDR_SRC" status --short >&2
    exit 1
  fi

  verify_manifest_hashes "$HERDR_SRC"

  compare_exact() {
    local upstream_rel="$1"
    local compat_rel="$2"
    if ! diff -q "$HERDR_SRC/$upstream_rel" "$COMPAT/$compat_rel" >/dev/null; then
      echo "Herdr compatibility copy drifted from HERDR_SRC: $compat_rel" >&2
      diff -u "$HERDR_SRC/$upstream_rel" "$COMPAT/$compat_rel" | sed -n '1,120p' >&2
      exit 1
    fi
  }

  check_terminal_attach_protocol() {
    if ! rg -q '^pub const PROTOCOL_VERSION: u32 = 22;' "$COMPAT/src/protocol/wire.rs"; then
      echo "terminal attach compatibility copy must advertise Herdr protocol 22" >&2
      exit 1
    fi
    for marker in TerminalHello TerminalBell; do
      if ! rg -q "$marker" "$COMPAT/src/protocol/wire.rs"; then
        echo "terminal attach compatibility copy is missing protocol-22 marker: $marker" >&2
        exit 1
      fi
    done
  }

  compare_popup_size() {
    normalize_popup_size_visibility() {
      awk '
        $0 == "pub(crate) enum PopupSize {" || $0 == "pub enum PopupSize {" {
          print "pub enum PopupSize {"
          next
        }
        { print }
      ' "$1"
    }

    if ! diff -q \
      <(normalize_popup_size_visibility "$HERDR_SRC/src/popup_size.rs") \
      <(normalize_popup_size_visibility "$COMPAT/src/popup_size.rs") \
      >/dev/null; then
      echo "Herdr popup_size copy drifted from HERDR_SRC beyond the intentional PopupSize visibility adaptation" >&2
      diff -u \
        <(normalize_popup_size_visibility "$HERDR_SRC/src/popup_size.rs") \
        <(normalize_popup_size_visibility "$COMPAT/src/popup_size.rs") \
        | sed -n '1,120p' >&2
      exit 1
    fi
  }

  compare_exact "src/api/schema.rs" "src/api/schema.rs"
  while IFS= read -r -d '' upstream_schema_file; do
    file_name="$(basename "$upstream_schema_file")"
    case "$file_name" in
      tests.rs|tabs.rs|workspaces.rs)
        continue
        ;;
    esac
    compare_exact "src/api/schema/$file_name" "src/api/schema/$file_name"
  done < <(find "$HERDR_SRC/src/api/schema" -maxdepth 1 -type f -name '*.rs' -print0)
  # The vendored wire module extracts upstream's test block and adjusts one
  # documentation link; the manifest verifies both reviewed hashes.
  compare_popup_size
  check_terminal_attach_protocol

  echo "Herdr $EXPECTED_HERDR_RELEASE compatibility vendor layout and HERDR_SRC drift checks passed"
else
  verify_manifest_hashes
  echo "Herdr $EXPECTED_HERDR_RELEASE compatibility vendor layout and manifest hashes look clean"
  echo "Set HERDR_SRC=/path/to/clean/herdr-v0.9.0 to compare exact upstream schema/wire copies"
fi
