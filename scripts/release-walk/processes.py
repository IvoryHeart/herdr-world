"""Bounded subprocesses and event waits. No status polling or sleep loops."""
import contextlib
import json
import os
from pathlib import Path
import socketserver
import subprocess
import threading


def run(argv, env=None, cwd=None, check=True, timeout=180):
    result = subprocess.run([str(arg) for arg in argv], env=env, cwd=cwd,
                            capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        # Do not publish command output: auth commands may print credentials.
        raise RuntimeError(f'{Path(argv[0]).name} command failed (exit {result.returncode})')
    return result


class Events:
    def __init__(self):
        self.condition = threading.Condition()
        self.items = []

    def add(self, value):
        with self.condition:
            self.items.append(value)
            self.condition.notify_all()

    def wait(self, predicate, start=0, timeout=90, reason='event did not arrive'):
        def find():
            return next(((i, item) for i, item in enumerate(self.items[start:], start)
                         if predicate(item)), None)
        with self.condition:
            assert self.condition.wait_for(find, timeout), reason
            return find()


class Telemetry(Events):
    def __init__(self, path):
        super().__init__()
        self.path = path
        events = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                for line in self.rfile:
                    events.add(json.loads(line))

        self.server = socketserver.ThreadingUnixStreamServer(str(path), Handler)
        self.server.daemon_threads = True
        self.server.block_on_close = False
        os.chmod(path, 0o600)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@contextlib.contextmanager
def background(argv, env, cwd):
    child = subprocess.Popen([str(arg) for arg in argv], env=env, cwd=cwd,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield child
    finally:
        child.terminate()
        try:
            child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=10)
