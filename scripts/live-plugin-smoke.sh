#!/usr/bin/env bash
set -euo pipefail

# Release smoke for the GitHub-installed plugin. The caller supplies a stock
# Herdr binary for the runner's platform; the plugin itself supplies the
# published npm payload and its platform-specific bridge.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERDR_BIN="${HERDR_BIN:?set HERDR_BIN to the stock Herdr binary}"
VERSION="${VERSION:?set VERSION to the release tag, including v}"
PLUGIN_ID="ivoryheart.herdr-world"

[[ -x "$HERDR_BIN" ]] || { echo "stock Herdr binary is not executable: $HERDR_BIN" >&2; exit 1; }
[[ "$VERSION" == v* ]] || { echo "VERSION must be a v-prefixed release tag" >&2; exit 1; }

SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/herdr-world-plugin-smoke.XXXXXX")"
CONFIG_HOME="$SMOKE_ROOT/config"
STATE_HOME="$SMOKE_ROOT/state"
SOCKET_A="$SMOKE_ROOT/herdr-a.sock"
LOG_A="$SMOKE_ROOT/herdr-a.log"
LOG_B="$SMOKE_ROOT/herdr-b.log"
PID_A=0
PID_B=0
PLUGIN_CONFIG_DIR=""

cleanup() {
  set +e
  if [[ -n "$PLUGIN_CONFIG_DIR" && -d "$PLUGIN_CONFIG_DIR" ]]; then
    invoke_action default stop >/dev/null 2>&1
  fi
  [[ "$PID_A" == 0 ]] || kill "$PID_A" 2>/dev/null
  [[ "$PID_B" == 0 ]] || kill "$PID_B" 2>/dev/null
  [[ "$PID_A" == 0 ]] || wait "$PID_A" 2>/dev/null
  [[ "$PID_B" == 0 ]] || wait "$PID_B" 2>/dev/null
  rm -rf "$SMOKE_ROOT"
}
trap cleanup EXIT

mkdir -p "$CONFIG_HOME" "$STATE_HOME"

start_default_herdr() {
  HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
    "$HERDR_BIN" server >"$LOG_A" 2>&1 &
  PID_A=$!
}

start_named_herdr() {
  XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
    "$HERDR_BIN" --session secondary server >"$LOG_B" 2>&1 &
  PID_B=$!
}

wait_for_herdr() {
  local command=("$HERDR_BIN" status server --json)
  local extra_env=(HERDR_SOCKET_PATH="$SOCKET_A")
  if [[ "${1:-default}" == secondary ]]; then
    command=("$HERDR_BIN" --session secondary status server --json)
    extra_env=()
  fi
  local status=""
  local ready=false
  for _ in $(seq 1 100); do
    if [[ ${#extra_env[@]} -gt 0 ]]; then
      status="$(env "${extra_env[@]}" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" "${command[@]}" 2>/dev/null || true)"
    else
      status="$(XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" "${command[@]}" 2>/dev/null || true)"
    fi
    if node --input-type=module - "$status" <<'NODE'
try {
  const value = JSON.parse(process.argv[2] || "null");
  process.exit(value?.running === true && value?.status === "running" && value?.protocol === 20 ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
    then
      ready=true
      break
    fi
    sleep 0.2
  done
  if [[ "$ready" == true ]]; then return; fi
  echo "Herdr did not become ready ($1)" >&2
  cat "$LOG_A" "$LOG_B" >&2
  exit 1
}

invoke_default() {
  invoke_action default "$1"
}

invoke_secondary() {
  invoke_action secondary "$1"
}

invoke_action() {
  local session="$1" action="$2" output log_id logs state
  if [[ "$session" == secondary ]]; then
    output="$(XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
      "$HERDR_BIN" --session secondary plugin action invoke "$action" --plugin "$PLUGIN_ID")"
  else
    output="$(HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
      "$HERDR_BIN" plugin action invoke "$action" --plugin "$PLUGIN_ID")"
  fi
  log_id="$(node --input-type=module - "$output" <<'NODE'
const value = JSON.parse(process.argv[2]);
process.stdout.write(value.result?.log?.log_id ?? "");
NODE
  )"
  [[ -n "$log_id" ]] || { echo "Herdr did not return a plugin action log id for $action" >&2; return 1; }
  for _ in $(seq 1 100); do
    if [[ "$session" == secondary ]]; then
      logs="$(XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
        "$HERDR_BIN" --session secondary plugin log list --plugin "$PLUGIN_ID" --limit 100 2>/dev/null || true)"
    else
      logs="$(HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
        "$HERDR_BIN" plugin log list --plugin "$PLUGIN_ID" --limit 100 2>/dev/null || true)"
    fi
    state="$(node --input-type=module - "$logs" "$log_id" <<'NODE'
try {
  const value = JSON.parse(process.argv[2]);
  const id = process.argv[3];
  const log = value.result?.logs?.find((entry) => entry.log_id === id);
  if (log) process.stdout.write(JSON.stringify({ status: log.status, stderr: log.stderr ?? "" }));
} catch {}
NODE
    )"
    if [[ "$state" == *'"status":"succeeded"'* ]]; then return 0; fi
    if [[ "$state" == *'"status":"failed"'* ]]; then
      node --input-type=module - "$state" <<'NODE' >&2
const value = JSON.parse(process.argv[2]);
process.stderr.write(value.stderr || "plugin action failed");
NODE
      return 1
    fi
    sleep 0.2
  done
  echo "plugin action did not finish: $action ($log_id)" >&2
  return 1
}

wait_for_bridge() {
  local url="$1"
  for _ in $(seq 1 100); do
    if curl --fail --silent --show-error "$url/api/capabilities" | \
      node --input-type=module -e '
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(text);
    process.exit(value.bridge_api_version === 1 && value.herdr_version === "0.8.2" && value.terminal_protocol === 20 && value.web_compat >= 1 ? 0 : 1);
  } catch {
    process.exit(1);
  }
});'
    then
      return
    fi
    sleep 0.2
  done
  echo "bridge did not become ready: $url" >&2
  exit 1
}

echo "Starting stock Herdr release smoke daemons"
start_default_herdr
wait_for_herdr default

echo "Installing $PLUGIN_ID from GitHub at $VERSION"
HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
  "$HERDR_BIN" plugin install IvoryHeart/herdr-world --ref "$VERSION" --yes
PLUGIN_CONFIG_DIR="$(HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
  "$HERDR_BIN" plugin config-dir "$PLUGIN_ID")"
[[ -d "$PLUGIN_CONFIG_DIR" ]] || { echo "plugin config directory was not retained" >&2; exit 1; }

actions="$(HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
  "$HERDR_BIN" plugin action list --plugin "$PLUGIN_ID")"
for action in start stop restart status open doctor; do
  [[ "$actions" == *"$action"* ]] || { echo "plugin action is missing: $action" >&2; exit 1; }
done

echo "Starting and reusing the default plugin service"
invoke_default start
wait_for_bridge http://127.0.0.1:8787
curl --fail --silent http://127.0.0.1:8787/ | grep -F '<title>' >/dev/null
invoke_default start >/dev/null
invoke_default status >/dev/null
invoke_default open >/dev/null
invoke_default doctor >/dev/null
invoke_default restart >/dev/null
wait_for_bridge http://127.0.0.1:8787

echo "Starting a second Herdr session with an isolated bridge port"
start_named_herdr
wait_for_herdr secondary
node --input-type=module - "$PLUGIN_CONFIG_DIR/config.json" <<'NODE'
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({ session_name: "secondary" }) + "\n", { mode: 0o600 });
NODE
invoke_secondary start >/dev/null
wait_for_bridge http://127.0.0.1:8788
curl --fail --silent http://127.0.0.1:8787/api/capabilities >/dev/null
invoke_secondary stop >/dev/null

node --input-type=module - "$PLUGIN_CONFIG_DIR/config.json" <<'NODE'
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], "{}\n", { mode: 0o600 });
NODE
# Herdr has no uninstall hook; stop the controller-owned bridge first.
invoke_default stop >/dev/null
invoke_default status >/dev/null
HERDR_SOCKET_PATH="$SOCKET_A" XDG_CONFIG_HOME="$CONFIG_HOME" XDG_STATE_HOME="$STATE_HOME" \
  "$HERDR_BIN" plugin uninstall "$PLUGIN_ID"
[[ -d "$PLUGIN_CONFIG_DIR" ]] || { echo "uninstall removed plugin config/state unexpectedly" >&2; exit 1; }

echo "Herdr plugin release smoke passed for $VERSION"
