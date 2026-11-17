"""Wait for systemd's socket creation event, then its boot transaction.

Docker reports started before PID 1 has opened its bus. Subscribe before
checking the socket to avoid a missed notification; never poll boot status.
"""
import ctypes
import os
from pathlib import Path
import select
import subprocess
import time

libc = ctypes.CDLL(None, use_errno=True)
fd = libc.inotify_init1(os.O_CLOEXEC)
assert fd >= 0, 'cannot open boot event subscription'
try:
    # /run exists from --tmpfs; watch it too until systemd creates its directory.
    assert libc.inotify_add_watch(fd, b'/run', 0x100 | 0x80) >= 0
    deadline = time.monotonic() + 90
    while True:
        if Path('/run/systemd').is_dir():
            assert libc.inotify_add_watch(fd, b'/run/systemd', 0x100 | 0x80) >= 0
        if Path('/run/systemd/private').is_socket():
            break
        assert select.select([fd], [], [], max(0, deadline - time.monotonic()))[0], \
            'systemd did not open its bus within 90 seconds'
        os.read(fd, 65536)
finally:
    os.close(fd)
result = subprocess.run(['systemctl', 'is-system-running', '--wait'],
                        text=True, capture_output=True, timeout=90)
# Containers have no devices/getty: unrelated device units may be degraded.
assert result.stdout.strip() in ('running', 'degraded'), result.stdout + result.stderr
