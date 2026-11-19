"""Transparent PTY recorder. The child is always the installed vendor executable.

It reports observations; it never prints a replacement screen, reports runtime
agent state, generates a reply, or writes a transcript. A cut shell command
cannot reach this program, which is the regression boundary for #984.
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import socket
import struct
import sys
import termios
import tty


def main():
    kind, *args = sys.argv[1:]
    real = os.environ['WALK_REAL_' + kind.upper()]
    # Readiness probes stay the real executable's probes, without a PTY.
    if args and args[0] in ('--version', '-V', '--help', 'auth', 'login'):
        os.execv(real, [real, *args])
    channel = socket.socket(socket.AF_UNIX)
    channel.connect(os.environ['WALK_TELEMETRY'])
    identity = str(os.getpid())

    def emit(event, **values):
        channel.sendall((json.dumps(dict(event=event, kind=kind, identity=identity, **values)) + '\n').encode())

    settings = []
    for index, arg in enumerate(args[:-1]):
        if arg == '--settings':
            value = args[index + 1]
            settings.append(json.loads(value if value.startswith('{') else Path(value).read_text()))
    emit('invoked', argv=args, settings=settings)
    child, master = pty.fork()
    if child == 0:
        os.execv(real, [real, *args])
    size = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    rows, cols, _, _ = struct.unpack('HHHH', size)
    if not rows or not cols:
        size = struct.pack('HHHH', 40, 120, 0, 0)
    fcntl.ioctl(master, termios.TIOCSWINSZ, size)
    saved = termios.tcgetattr(0)
    tty.setraw(0)

    def end(*_):
        raise SystemExit(128 + signal.SIGTERM)

    signal.signal(signal.SIGTERM, end)
    signal.signal(signal.SIGHUP, end)
    output = ''
    received = ''
    ready = False
    try:
        while True:
            readable, _, _ = select.select([0, master], [], [])
            for fd in readable:
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        return
                    raise
                if not data:
                    return
                if fd == master:
                    os.write(1, data)
                    output = (output + data.decode(errors='replace'))[-131072:]
                    positioned = re.sub(r'\x1b\[\d+[GCD]', ' ', output)
                    plain = re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]', '', positioned)
                    signature = (r'Claude\s+Code|Welcome\s+to\s+Claude|(?:Select|Choose)\s+the\s+text\s+style|Let.s\s+get\s+started' if kind == 'claude'
                                 else r'Welcome\s+to\s+Codex|OpenAI\s+Codex|Sign\s+in\s+with\s+ChatGPT')
                    if not ready and re.search(signature, plain, re.I):
                        assert not re.search(r'(?:error:|unknown option|unexpected argument)', plain, re.I), 'harness rejected its arguments'
                        os.kill(child, 0)
                        emit('first-screen', pid=child)
                        ready = True
                else:
                    # Observation is before the unchanged bytes reach the real child.
                    os.write(master, data)
                    received = (received + data.decode(errors='replace'))[-32768:]
                    emit('input', text=received)
    finally:
        termios.tcsetattr(0, termios.TCSANOW, saved)
        try:
            os.killpg(child, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(master)
        def force_exit(*_):
            try:
                os.killpg(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
        signal.signal(signal.SIGALRM, force_exit)
        signal.alarm(10)
        os.waitpid(child, 0)
        signal.alarm(0)
        channel.close()


if __name__ == '__main__':
    main()
