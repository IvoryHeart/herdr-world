"""Unit test the recorder itself; acceptance always installs real vendor CLIs."""
import json
import os
from pathlib import Path
import pty
import subprocess
import sys
import tempfile
import threading
import unittest
from processes import Events, Telemetry


class RecorderTests(unittest.TestCase):
    def test_recorder_preserves_complete_arguments_settings_and_child_input(self):
        with tempfile.TemporaryDirectory(prefix='walk-recorder-') as directory:
            root = Path(directory)
            probe = root / 'probe.py'
            probe.write_text('import os\nos.write(1, b"\\x1b[2GChoose\\x1b[9Gthe\\x1b[13Gtext\\x1b[18Gstyle\\r\\n")\n'
                             'line = input()\nos.write(1, ("child received: " + line).encode())\n'
                             'input()\n')
            executable = root / 'claude'
            executable.write_text('#!/bin/sh\nexec ' + __import__('shlex').join([sys.executable, str(probe)]) + ' "$@"\n')
            executable.chmod(0o755)
            settings = root / 'settings.json'
            command = 'complete settings ' + 'x' * 8192
            settings.write_text(json.dumps({'statusLine': {'command': command}}))
            role = 'role with "quotes" and apostrophe\'s value\ncomplete end'
            args = ['--agents', json.dumps({'walk': {'prompt': role}}), '--settings', str(settings)]
            telemetry = Telemetry(root / 'events.sock')
            master, slave = pty.openpty()
            output = Events()
            child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('observe.py')), 'claude', *args],
                                     env={**os.environ, 'WALK_REAL_CLAUDE': str(executable), 'WALK_TELEMETRY': str(telemetry.path)},
                                     stdin=slave, stdout=slave, stderr=slave)
            os.close(slave)

            def read():
                text = ''
                try:
                    while True:
                        data = os.read(master, 65536)
                        if not data:
                            return
                        text += data.decode(errors='replace')
                        output.add(text)
                except OSError:
                    pass

            threading.Thread(target=read, daemon=True).start()
            try:
                _, invoked = telemetry.wait(lambda item: item['event'] == 'invoked', timeout=10)
                self.assertEqual(invoked['argv'], args)
                self.assertEqual(invoked['settings'][0]['statusLine']['command'], command)
                telemetry.wait(lambda item: item['event'] == 'first-screen', timeout=10)
                os.write(master, b'WALK_INPUT_COMPLETE\r')
                telemetry.wait(lambda item: item['event'] == 'input' and 'WALK_INPUT_COMPLETE' in item['text'], timeout=10)
                output.wait(lambda text: 'child received: WALK_INPUT_COMPLETE' in text, timeout=10)
            finally:
                child.terminate()
                child.wait(timeout=10)
                os.close(master)
                telemetry.close()


if __name__ == '__main__':
    unittest.main()
