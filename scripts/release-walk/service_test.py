"""Fixture regressions only; native acceptance still uses the real manager."""
import contextlib
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import service
from service import services


class ServiceTests(unittest.TestCase):
    def test_native_lifecycles_use_configuration_the_real_installer_accepts(self):
        for platform in ('Linux', 'Darwin'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory(prefix='walk-service-') as directory:
                root = Path(directory)
                candidate, baseline = root / 'candidate', root / 'baseline'
                config = root / '.config/herdr-world/herdr-world.env'
                definition = root / ('.config/systemd/user/herdr-world.service' if platform == 'Linux'
                                     else 'Library/LaunchAgents/dev.herdr-world.plist')
                installed = []
                walk = MagicMock()
                watching = False
                loaded = False
                def watch_exit(printed):
                    nonlocal watching
                    self.assertEqual(printed, '\tpid = 123\n')
                    watching = True
                    def wait():
                        nonlocal loaded
                        loaded = False
                    return contextlib.nullcontext(wait)
                def command(argv, env, check=True):
                    nonlocal loaded, watching
                    if argv[0] in (candidate, baseline):
                        if argv[2] == 'install':
                            # Exercise the actual installer boundary without
                            # invoking a manager or starting a World server.
                            result = subprocess.run(['bun', '-e', '''
                                import {readFileSync} from 'node:fs';
                                import {prepareServiceAccess} from './server/src/config/service-manager';
                                const [path, platform, home] = process.argv.slice(1);
                                const access = prepareServiceAccess(path, readFileSync(path, 'utf8'), platform, home);
                                console.log(JSON.stringify({host: access.host, port: access.port}));
                            ''', str(config), 'systemd' if platform == 'Linux' else 'launchd', str(root)],
                                capture_output=True, text=True)
                            self.assertEqual(result.returncode, 0, 'service fixture rejected by prepareServiceAccess')
                            access = json.loads(result.stdout)
                            self.assertEqual(access['host'], '127.0.0.1')
                            self.assertGreater(access['port'], 0)
                            self.assertNotIn(access['port'], (8787, 8788))
                            installed.append(argv[0])
                            definition.parent.mkdir(parents=True, exist_ok=True)
                            definition.write_text('synthetic native definition')
                            loaded = True
                            watching = False
                        elif argv[2] == 'uninstall':
                            if platform == 'Darwin' and definition.exists():
                                self.assertTrue(watching, 'must observe process exit before requesting uninstall')
                            definition.unlink(missing_ok=True)
                            if platform == 'Linux':
                                loaded = False
                        else:
                            self.fail('unexpected service action')
                        return SimpleNamespace(returncode=0)
                    if argv[0] == 'systemctl' and 'show' in argv:
                        return SimpleNamespace(stdout='not-found\n', returncode=0)
                    return SimpleNamespace(returncode=0 if loaded else 113, stdout='\tpid = 123\n')
                with patch('service.Path.home', return_value=root), patch('service.platform.system', return_value=platform), \
                        patch('service.run', side_effect=command), patch('service.service_guard') as guard, \
                        patch('service.launchd_exit_watch', side_effect=watch_exit, create=True):
                    services(walk, candidate, baseline, root, True)
                guard.assert_called_once_with(root, True)
                self.assertEqual(installed, [candidate, baseline])
                self.assertEqual([call.args[0] for call in walk.journey.call_args_list],
                                 ['Service install and uninstall', 'Previous release service uninstall'])
                self.assertFalse(config.exists())
                self.assertFalse(definition.exists())


class LaunchdExitTests(unittest.TestCase):
    def queue(self):
        queue = MagicMock()
        queue.__enter__.return_value = queue
        return queue

    def native_events(self, queue):
        return patch.multiple('service.select', kqueue=MagicMock(return_value=queue),
                              kevent=MagicMock(return_value='exit subscription'),
                              KQ_FILTER_PROC=-5, KQ_EV_ADD=1, KQ_EV_ONESHOT=16,
                              KQ_NOTE_EXIT=0x80000000, KQ_EV_ERROR=0x4000, create=True)

    def test_arms_before_uninstall_and_blocks_once_for_the_exact_process_exit(self):
        queue = self.queue()
        queue.control.side_effect = [[], [SimpleNamespace(ident=123, filter=-5, flags=0, fflags=0x80000000)]]
        with self.native_events(queue):
            with service.launchd_exit_watch('\tpid = 123\n\tother = value\n') as wait:
                queue.control.assert_called_once_with(['exit subscription'], 0, 0)
                service.select.kevent.assert_called_once_with(123, filter=-5, flags=17, fflags=0x80000000)
                # Acknowledging bootout is not process termination. Wait only
                # after the caller has issued the real uninstall command.
                wait()
            self.assertEqual(queue.control.call_args_list[-1].args, (None, 1, 30))
            self.assertEqual(queue.control.call_count, 2)
            queue.__exit__.assert_called_once()

    def test_no_exit_event_fails_without_retrying_the_manager(self):
        queue = self.queue()
        queue.control.side_effect = [[], []]
        with self.native_events(queue), service.launchd_exit_watch('\tpid = 123\n') as wait:
            with self.assertRaisesRegex(AssertionError, 'service uninstall left the native service running'):
                wait()
            self.assertEqual(queue.control.call_count, 2)

    def test_unrelated_or_error_event_cannot_prove_exit(self):
        for event in (SimpleNamespace(ident=999, filter=-5, flags=0, fflags=0x80000000),
                      SimpleNamespace(ident=123, filter=-5, flags=0x4000, fflags=0x80000000)):
            queue = self.queue()
            queue.control.side_effect = [[], [event]]
            with self.native_events(queue), service.launchd_exit_watch('\tpid = 123\n') as wait:
                with self.assertRaisesRegex(AssertionError, 'service uninstall left the native service running'):
                    wait()

    def test_registered_job_without_a_running_process_is_not_a_started_service(self):
        queue = self.queue()
        with self.native_events(queue):
            with self.assertRaisesRegex(AssertionError, 'native service did not start'):
                with service.launchd_exit_watch('\tstate = waiting\n'):
                    self.fail('uninstall must not run without an exit subscription')
            queue.control.assert_not_called()


if __name__ == '__main__':
    unittest.main()
