"""Real pinned-Codex update regression, without World or a model credential."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import signal
import struct
import subprocess
import sys
import termios
import threading
from assets import environment
from processes import Events


def check_codex_update_policy(root, tools):
    for fixed in (False, True):
        home = root / ('fixed' if fixed else 'legacy')
        env = environment(home, tools, 'walk-update', False, root / 'unused.sock')
        codex = Path(env['CODEX_HOME'])
        if not fixed:
            (codex / 'config.toml').unlink(missing_ok=True)
        (codex / 'version.json').write_text(json.dumps(dict(
            latest_version='999.0.0', last_checked_at='2099-01-01T00:00:00Z')))
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        attach = 'import os,fcntl,termios,sys; fcntl.ioctl(0,termios.TIOCSCTTY,0); os.execv(sys.argv[1],sys.argv[1:])'
        child = subprocess.Popen([sys.executable, '-c', attach, str(tools / 'node_modules/.bin/codex')],
                                 env=env, cwd=home, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        events = Events()

        def read():
            output = ''
            try:
                while True:
                    data = os.read(master, 65536)
                    if not data:
                        break
                    if b'\x1b[6n' in data:
                        os.write(master, b'\x1b[1;1R')
                    for number, rgb in ((10, b'ffff/ffff/ffff'), (11, b'0000/0000/0000')):
                        if f'\x1b]{number};?'.encode() in data:
                            os.write(master, f'\x1b]{number};rgb:'.encode() + rgb + b'\x1b\\')
                    output = (output + data.decode(errors='replace'))[-131072:]
                    plain = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', ' ', output)
                    events.add(plain)
            except OSError:
                pass

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        try:
            _, screen = events.wait(lambda text: 'Update now' in text or 'Ask Codex' in text,
                                    timeout=20, reason='Codex control never displayed its screen')
            if not fixed and 'Update now' not in screen:
                # The initial composer can render before the cached update popup.
                events.wait(lambda text: 'Update now' in text, timeout=20,
                            reason='Legacy control never offered the cached update')
            if fixed:
                assert 'Update now' not in screen, 'Pinned Codex offered an update'
                os.write(master, b'WALK_INPUT_UPDATE_CONTROL\r')
                _, text = events.wait(lambda text: 'WALK_INPUT_UPDATE_CONTROL' in text, timeout=20,
                                      reason='Pinned Codex input did not reach the composer')
                assert child.poll() is None and 'Update now' not in text, 'Pinned Codex entered its updater'
        finally:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            child.wait(timeout=10)
            os.close(master)
            reader.join(timeout=2)
    print('PASS pinned Codex cached-update regression (legacy popup; fixed input stays live)', flush=True)
