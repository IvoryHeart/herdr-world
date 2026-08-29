#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERDR_BIN="${HERDR_BIN:-/tmp/herdr-upstream-v082/target/release/herdr}"
BRIDGE_BIN="${HERDR_WEB_BRIDGE_BIN:-$ROOT/bridge/target/debug/herdr-web-bridge}"
STATIC_DIR="${HERDR_WEB_STATIC_DIR:-$ROOT/web/dist}"
BRIDGE_A_PORT="${HERDR_WEB_LIVE_PORT_A:-8791}"
BRIDGE_B_PORT="${HERDR_WEB_LIVE_PORT_B:-8792}"

[[ -x "$HERDR_BIN" ]] || {
  echo "stock Herdr v0.8.2 binary not found: $HERDR_BIN" >&2
  echo "Build it from the clean v0.8.2 checkout with: ZIG=/path/to/zig cargo build --release --bin herdr" >&2
  exit 1
}
[[ -x "$BRIDGE_BIN" ]] || {
  echo "bridge binary not found: $BRIDGE_BIN" >&2
  exit 1
}
[[ -d "$STATIC_DIR" ]] || {
  echo "static web directory not found: $STATIC_DIR" >&2
  exit 1
}

LIVE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/herdr-web-stock-v082.XXXXXX")"
mkdir -p "$LIVE_ROOT/config-a" "$LIVE_ROOT/state-a" "$LIVE_ROOT/config-b" "$LIVE_ROOT/state-b"
pid_daemon_a=0
pid_daemon_b=0
pid_bridge_a=0
pid_bridge_b=0

cleanup() {
  for pid in "$pid_bridge_a" "$pid_bridge_b" "$pid_daemon_a" "$pid_daemon_b"; do
    [[ "$pid" != 0 ]] && kill "$pid" 2>/dev/null || true
  done
  for pid in "$pid_bridge_a" "$pid_bridge_b" "$pid_daemon_a" "$pid_daemon_b"; do
    [[ "$pid" != 0 ]] && wait "$pid" 2>/dev/null || true
  done
  echo "stock-v0.8.2 evidence logs: $LIVE_ROOT"
}
trap cleanup EXIT

start_daemon() {
  local name="$1" config_dir="$2" state_dir="$3" socket_path="$4"
  HERDR_SOCKET_PATH="$socket_path" \
    XDG_CONFIG_HOME="$config_dir" \
    XDG_STATE_HOME="$state_dir" \
    "$HERDR_BIN" server >"$LIVE_ROOT/$name-daemon.log" 2>&1 &
  echo $!
}

pid_daemon_a="$(start_daemon a "$LIVE_ROOT/config-a" "$LIVE_ROOT/state-a" "$LIVE_ROOT/herdr-a.sock")"
pid_daemon_b="$(start_daemon b "$LIVE_ROOT/config-b" "$LIVE_ROOT/state-b" "$LIVE_ROOT/herdr-b.sock")"

status_a=""
status_b=""
for _ in $(seq 1 100); do
  status_a="$(HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-a.sock" "$HERDR_BIN" status server 2>&1 || true)"
  status_b="$(HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-b.sock" "$HERDR_BIN" status server 2>&1 || true)"
  if [[ "$status_a" == *"version: 0.8.2"* && "$status_a" == *"protocol: 20"* \
    && "$status_b" == *"version: 0.8.2"* && "$status_b" == *"protocol: 20"* ]]; then
    break
  fi
  sleep 0.2
done
printf '%s\n' '--- stock daemon A ---' "$status_a" '--- stock daemon B ---' "$status_b"
if [[ "$status_a" != *"version: 0.8.2"* || "$status_a" != *"protocol: 20"* \
  || "$status_b" != *"version: 0.8.2"* || "$status_b" != *"protocol: 20"* ]]; then
  echo "stock Herdr v0.8.2 daemons did not become ready" >&2
  exit 1
fi

HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-a.sock" "$HERDR_BIN" workspace create \
  --cwd /tmp --label 'Live A' --focus >/dev/null
HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-b.sock" "$HERDR_BIN" workspace create \
  --cwd /tmp --label 'Live B' --focus >/dev/null

HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-a.sock" \
  HOST=127.0.0.1 PORT="$BRIDGE_A_PORT" BRIDGE_BIN="$BRIDGE_BIN" STATIC_DIR="$STATIC_DIR" \
  "$ROOT/scripts/run-bridge.sh" --bridge-label live-a >"$LIVE_ROOT/bridge-a.log" 2>&1 &
pid_bridge_a=$!
HERDR_SOCKET_PATH="$LIVE_ROOT/herdr-b.sock" \
  HOST=127.0.0.1 PORT="$BRIDGE_B_PORT" BRIDGE_BIN="$BRIDGE_BIN" STATIC_DIR="$STATIC_DIR" \
  "$ROOT/scripts/run-bridge.sh" --bridge-label live-b >"$LIVE_ROOT/bridge-b.log" 2>&1 &
pid_bridge_b=$!

bridges_ready=false
for _ in $(seq 1 100); do
  if curl -fsS "http://127.0.0.1:$BRIDGE_A_PORT/api/capabilities" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$BRIDGE_B_PORT/api/capabilities" >/dev/null 2>&1; then
    bridges_ready=true
    break
  fi
  sleep 0.2
done
if [[ "$bridges_ready" != true ]]; then
  echo "Herdr World bridges did not become ready" >&2
  cat "$LIVE_ROOT/bridge-a.log" "$LIVE_ROOT/bridge-b.log" >&2
  exit 1
fi

HERDR_WEB_LIVE_BRIDGE_A="http://127.0.0.1:$BRIDGE_A_PORT" \
  HERDR_WEB_LIVE_BRIDGE_B="http://127.0.0.1:$BRIDGE_B_PORT" \
  node "$ROOT/scripts/live-bridge-smoke.mjs"
