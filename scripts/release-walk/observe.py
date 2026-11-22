"""Transparent PTY recorder. The foreground process execs the vendor executable.

It reports observations; it never prints a replacement screen, reports runtime
agent state, generates a reply, or writes a transcript. Codex startup update
checks are disabled to keep the fixture on its pinned version. A cut shell command
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
    # Do not pty.fork() the harness: that puts it in another session and leaves
    # Python as the runtime pane's foreground process. Keep this PID, session,
    # controlling terminal and foreground group for the real executable. Only
    # the byte relay is forked; its slave supplies the executable's stdio.
    harness = os.getpid()
    master, slave = pty.openpty()
    size = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    rows, cols, _, _ = struct.unpack('HHHH', size)
    if not rows or not cols:
        size = struct.pack('HHHH', 40, 120, 0, 0)
    fcntl.ioctl(master, termios.TIOCSWINSZ, size)
    saved = termios.tcgetattr(0)
    termios.tcsetattr(slave, termios.TCSANOW, saved)
    tty.setraw(0)
    relay = os.fork()
    if relay:
        os.close(master)
        channel.close()
        for fd in (0, 1, 2):
            os.dup2(slave, fd)
        if slave > 2:
            os.close(slave)
        # A synthetic Enter must reach onboarding/input, never an updater that
        # can exit or replace the pinned harness. Keep captured World argv exact.
        launch_args = ['-c', 'check_for_update_on_startup=false', *args] if kind == 'codex' else args
        os.execv(real, [real, *launch_args])
    os.close(slave)

    def resize(*_):
        size = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack('HHHH', 0, 0, 0, 0))
        fcntl.ioctl(master, termios.TIOCSWINSZ, size)

    signal.signal(signal.SIGWINCH, resize)

    termination = dict(reason='relay-error')

    def end(number, *_):
        termination.update(reason='relay-signal', signal=number)
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
                source = 'harness-output' if fd == master else 'runtime-input'
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        termination.update(reason=source + '-eio', source=source, errno=error.errno)
                        return
                    raise
                if not data:
                    termination.update(reason=source + '-eof', source=source)
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
                        os.kill(harness, 0)
                        emit('first-screen', pid=harness)
                        ready = True
                else:
                    # Observation is before the unchanged bytes reach the real child.
                    os.write(master, data)
                    received = (received + data.decode(errors='replace'))[-32768:]
                    emit('input', text=received)
    except Exception as error:
        termination.update(error_type=type(error).__name__, errno=getattr(error, 'errno', None))
        raise
    finally:
        try:
            emit('terminated', **termination, output_tail=output)
        except OSError:
            pass  # Preserve relay cleanup if the telemetry collector has closed.
        try:
            termios.tcsetattr(0, termios.TCSANOW, saved)
        except termios.error:
            pass  # The runtime may already have closed its terminal.
        try:
            os.kill(harness, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(master)
        channel.close()


if __name__ == '__main__':
    main()
