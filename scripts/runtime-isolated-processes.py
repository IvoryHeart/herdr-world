"""Linux-only process ownership and crash cleanup for runtime-isolated.ts.

Never select by executable name or a persisted PID. A random environment marker
identifies the run; pidfds keep signals/waits attached to the captured processes.
"""

import json
import fcntl
import os
from pathlib import Path
import select
import signal
import sys


def snapshot():
    found = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            env = (entry / 'environ').read_bytes().split(b'\0')
            found[int(entry.name)] = (int(fields[1]), env, fields[0])
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return found


def owned(table, token):
    marker = f'WORLD_RUNTIME_KIT={token}'.encode()
    selected = {pid for pid, (_, env, _) in table.items() if marker in env}
    # Include descendants that deliberately cleared their own environment.
    while True:
        children = {pid for pid, (parent, _, _) in table.items() if parent in selected}
        expanded = selected | children
        if expanded == selected:
            return selected
        selected = expanded


def main():
    action, token = sys.argv[1:]
    if action == 'lock':
        expected = f'/tmp/world-kit-{os.getuid()}'
        if token != expected:
            raise ValueError('invalid control directory')
        fd = os.open(token, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        stat = os.fstat(fd)
        if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
            raise ValueError('control directory is not private')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('another kit operation is running; no action taken') from None
        print('locked', flush=True)
        sys.stdin.read()  # EOF also releases the lock after a controller crash.
        os.close(fd)
        return
    if action == 'probe':
        fd = os.pidfd_open(os.getpid())
        os.close(fd)
        print('pidfd available')
        return
    table = snapshot()
    selected = owned(table, token)
    if action == 'inspect':
        print(json.dumps([
            {'pid': pid, 'env': [v.decode(errors='replace') for v in table[pid][1]]}
            for pid in sorted(selected)
        ]))
        return
    if action != 'stop':
        raise ValueError('unknown action')
    handles = {}

    def freeze(pids):
        for pid in pids - handles.keys():
            try:
                fd = os.pidfd_open(pid)
                # Revalidate the marker/ancestry after opening the pidfd.
                if pid not in owned(snapshot(), token):
                    os.close(fd)
                    continue
                handles[pid] = fd
                signal.pidfd_send_signal(fd, signal.SIGSTOP)
            except ProcessLookupError:
                pass

    freeze(selected)
    # Frozen holders cannot respawn core. Capture children born during discovery.
    freeze(owned(snapshot(), token))
    for fd in handles.values():
        try:
            signal.pidfd_send_signal(fd, signal.SIGKILL)
        except ProcessLookupError:
            pass
    poller = select.poll()
    for fd in handles.values():
        poller.register(fd, select.POLLIN)
    pending = set(handles.values())
    # This is a blocking exit-event wait, not status polling.
    while pending:
        events = poller.poll(10000)
        if not events:
            raise RuntimeError('owned processes did not exit; retaining run folder')
        for fd, _ in events:
            pending.discard(fd)
            poller.unregister(fd)
    for fd in handles.values():
        os.close(fd)
    remaining = owned(snapshot(), token)
    if remaining:
        raise RuntimeError('owned processes remain; retaining run folder')
    print(json.dumps({'removed_processes': len(handles)}))


if __name__ == '__main__':
    main()
