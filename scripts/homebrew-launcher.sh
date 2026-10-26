#!/bin/sh
set -eu
world=@HERDR_WORLD_BINARY@

# Metadata and management commands keep their existing behavior. Only listener
# startup needs the local runtime; remote/custom endpoints keep their own owner.
bootstrap=0
case "${1:-}" in
  --version|-V|--help|-h|--skill) ;;
  ""|-*) bootstrap=1 ;;
esac
for argument in "$@"; do
  case "$argument" in
    --version|-V|--help|-h|--skill|--ssh-host|--ssh-host=*|--socket-path|--socket-path=*|--client-socket-path|--client-socket-path=*|--session|--session=*) bootstrap=0 ;;
  esac
done
if [ -n "${HERDR_SSH_HOST:-}${HERDR_SOCKET_PATH:-}${HERDR_CLIENT_SOCKET_PATH:-}${HERDR_SESSION:-}" ]; then
  bootstrap=0
fi
if [ "$bootstrap" = 1 ] && [ "${HERDR_WORLD_SKIP_HERDR:-}" != 1 ]; then
  status="$("$world" herdr status)"
  case "$status" in
    'Herdr is not installed.'*)
      "$world" herdr upgrade --install --no-integrations --no-plugin
      ;;
  esac
fi
exec "$world" "$@"
