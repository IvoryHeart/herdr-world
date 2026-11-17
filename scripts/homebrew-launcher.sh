#!/bin/sh
set -eu
world=@HERDR_WORLD_BINARY@

@HERDR_BOOTSTRAP@

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
warn_bootstrap() {
  printf '%s\n' 'Herdr World: Herdr check or installation failed; starting World anyway. Retry with `herdr-world herdr upgrade --install`, or set HERDR_WORLD_SKIP_HERDR=1 to skip automatic setup.' >&2
}
if [ "$bootstrap" = 1 ] && [ "${HERDR_WORLD_SKIP_HERDR:-}" != 1 ]; then
  if ! install_missing_herdr; then
    warn_bootstrap
  fi
fi
exec "$world" "$@"
