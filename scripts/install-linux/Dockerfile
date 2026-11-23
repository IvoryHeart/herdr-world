ARG INSTALL_TEST_BASE
FROM ${INSTALL_TEST_BASE}
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
