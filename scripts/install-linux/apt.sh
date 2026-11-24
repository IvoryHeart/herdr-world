#!/bin/sh
set -eu

# Per-request limits alone do not bound a mirror that keeps trickling bytes.
started=$(date +%s)
if timeout --kill-after=5s 300s sh -eu -c '
    apt_get() {
        if [ -n "${INSTALL_TEST_APT_PROXY:-}" ]; then
            set -- -o "Acquire::http::Proxy=$INSTALL_TEST_APT_PROXY" \
                -o "Acquire::https::Proxy=$INSTALL_TEST_APT_PROXY" "$@"
        fi
        apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=15 \
            -o Acquire::https::Timeout=15 -o APT::Update::Error-Mode=any "$@"
    }
    started=$(date +%s)
    # APT does not retry HTTP 520; permit one fresh attempt within the deadline.
    apt_get update || apt_get update
    printf "[apt] update: %ss\n" "$(($(date +%s) - started))"
    started=$(date +%s)
    apt_get install -y --no-install-recommends \
        systemd systemd-sysv dbus-user-session libpam-systemd ca-certificates \
        curl xz-utils python3 python3-websocket
    printf "[apt] install: %ss\n" "$(($(date +%s) - started))"
'; then
    status=0
else
    status=$?
fi
printf '[apt] total: %ss (exit %s)\n' "$(($(date +%s) - started))" "$status"
if [ "$status" -ne 0 ]; then
    printf '%s\n' "Installer test base: apt failed (exit $status; 300s total deadline, one retry, 15s HTTP/HTTPS timeouts). Check the Ubuntu mirror errors above; rerun to rebuild the dependency cache." >&2
    exit "$status"
fi
