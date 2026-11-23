FROM ubuntu:24.04
ENV container=docker DEBIAN_FRONTEND=noninteractive
# APT does not retry HTTP 520; allow one fresh index attempt after mirror errors.
# Require every index and keep signature checks; never install after two failures.
RUN (apt-get -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update \
    || apt-get -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update) \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    systemd systemd-sysv dbus-user-session libpam-systemd ca-certificates \
    curl xz-utils python3 python3-websocket \
    && rm -rf /var/lib/apt/lists/* \
    && userdel -r ubuntu && useradd -m -u 1000 -s /bin/bash tester \
    && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/tester \
    && systemctl mask systemd-remount-fs.service systemd-udevd.service \
       systemd-udev-trigger.service console-getty.service
COPY scenarios.py boot.py /opt/install-test/
COPY curl.py /usr/local/bin/curl
RUN chmod 755 /usr/local/bin/curl
ENV HOME=/home/tester USER=tester XDG_RUNTIME_DIR=/run/user/1000 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
    PATH=/home/tester/.local/bin:/usr/local/bin:/usr/bin:/bin \
    HERDR_WORLD_DATA_DIR=/home/tester/.local/share/herdr-world \
    HERDR_WORLD_CONNECTIONS_PATH=/home/tester/.local/share/herdr-world/connections.json \
    HERDR_WORLD_SKIP_INTEGRATIONS=1 OPEN_BROWSER=0
STOPSIGNAL SIGRTMIN+3
