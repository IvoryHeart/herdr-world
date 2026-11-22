"""Unit test the recorder itself; acceptance always installs real vendor CLIs."""
import json
import os
from pathlib import Path
import pty
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock
from journeys import pane_for
from processes import Events, Telemetry


class RecorderTests(unittest.TestCase):
    def test_signed_out_unknown_is_explicit_and_model_reply_requires_classified_status(self):
        pane = dict(terminal_id='walk-terminal', agent='claude', agent_status='unknown')
        connection = dict(connection_id='walk-connection', generation=1)
        rows = [dict(**connection, snapshot=dict(panes=[pane]))]
        world = Mock()
        def observe(read, predicate, reason):
            self.assertTrue(predicate(rows), reason)
            return rows
        world.observe.side_effect = observe
        for status in ('unknown', 'idle', 'working', 'blocked', 'done'):
            pane['agent_status'] = status
            self.assertIs(pane_for(world, connection, pane), pane)
            if status != 'unknown':
                self.assertIs(pane_for(world, connection, pane, require_classified=True), pane)
        for status in (None, 'invalid'):
            pane['agent_status'] = status
            with self.assertRaisesRegex(AssertionError, 'without a status'):
                pane_for(world, connection, pane)
        pane['agent_status'] = 'unknown'
        with self.assertRaisesRegex(AssertionError, 'classified agent status'):
            pane_for(world, connection, pane, require_classified=True)

    def test_recorder_preserves_complete_arguments_settings_and_child_input(self):
        with tempfile.TemporaryDirectory(prefix='walk-recorder-') as directory:
            root = Path(directory)
            probe = root / 'probe.py'
            probe.write_text('import json, os\n'
                             'with open("/dev/tty") as terminal:\n'
                             '    state = dict(pid=os.getpid(), sid=os.getsid(0), pgid=os.getpgrp(), foreground=os.tcgetpgrp(terminal.fileno()))\n'
                             'print("PROCESS " + json.dumps(state), flush=True)\n'
                             'os.write(1, b"\\x1b[2GChoose\\x1b[9Gthe\\x1b[13Gtext\\x1b[18Gstyle\\r\\n")\n'
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
            # Model a pane's controlling terminal and foreground group. Merely
            # wiring a slave to stdio misses the runtime-detection regression.
            attach = 'import fcntl, os, sys, termios; fcntl.ioctl(0, termios.TIOCSCTTY, 0); os.execv(sys.argv[1], sys.argv[1:])'
            child = subprocess.Popen([sys.executable, '-c', attach, sys.executable,
                                      str(Path(__file__).with_name('observe.py')), 'claude', *args],
                                     env={**os.environ, 'WALK_REAL_CLAUDE': str(executable), 'WALK_TELEMETRY': str(telemetry.path)},
                                     stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
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
                _, screen = telemetry.wait(lambda item: item['event'] == 'first-screen', timeout=10)
                _, text = output.wait(lambda text: 'PROCESS ' in text and 'style' in text, timeout=10)
                state = json.loads(text.split('PROCESS ', 1)[1].splitlines()[0])
                self.assertEqual(state, dict(pid=child.pid, sid=child.pid, pgid=child.pid, foreground=child.pid))
                self.assertEqual(screen['pid'], child.pid)
                self.assertEqual(invoked['identity'], str(child.pid))
                os.write(master, b'WALK_INPUT_COMPLETE\r')
                telemetry.wait(lambda item: item['event'] == 'input' and 'WALK_INPUT_COMPLETE' in item['text'], timeout=10)
                output.wait(lambda text: 'child received: WALK_INPUT_COMPLETE' in text, timeout=10)
                os.write(master, b'finish\r')
                child.wait(timeout=10)
                _, ended = telemetry.wait(lambda item: item['event'] == 'terminated', timeout=2)
                self.assertEqual(ended['identity'], invoked['identity'])
                # Exiting the controlling session leader can SIGHUP the relay
                # before the inner PTY reports EOF (platform-dependent).
                self.assertIn(ended['reason'], ('harness-output-eof', 'harness-output-eio', 'relay-signal'))
                if ended['reason'] == 'relay-signal':
                    self.assertEqual(ended['signal'], signal.SIGHUP)
                self.assertIn('child received: WALK_INPUT_COMPLETE', ended['output_tail'])
            finally:
                child.terminate()
                child.wait(timeout=10)
                os.close(master)
                telemetry.close()


if __name__ == '__main__':
    unittest.main()
