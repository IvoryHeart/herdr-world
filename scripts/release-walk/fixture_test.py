"""Regress fixture setup and assertions; acceptance still uses real runtimes."""
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch
from assets import environment
from journeys import default_connection


class FixtureTests(unittest.TestCase):
    def test_private_runtime_paths_fit_macos_even_for_holder_sockets(self):
        with tempfile.TemporaryDirectory(prefix='world-walk-', dir='/tmp') as directory:
            root = Path(directory)
            runtime_dirs = set()
            for journey in ('herdr-core', 'both', 'upgrade', 'signed'):
                home = root / journey
                session = 'walk-0123456789ab'
                with patch.dict(os.environ, {'XDG_RUNTIME_DIR': '/owner/run'}):
                    env = environment(home, root / 'tools', session, True, root / 'events.sock')
                run = Path(env.get('XDG_RUNTIME_DIR', str(home / 'state/herdr-core' / session)))
                # Core adds a holder ID to its longest endpoint name. macOS
                # permits 103 bytes before the terminating NUL (Linux: 107).
                holder = (run / 'herdr-core' / (session + '.holder.01234567.sock')) if 'XDG_RUNTIME_DIR' in env else (run / (session + '.holder.01234567.sock'))
                self.assertLessEqual(len(os.fsencode(holder)), 103)
                self.assertEqual(run.parent, home)
                self.assertTrue(run.is_dir())
                self.assertEqual(stat.S_IMODE(run.stat().st_mode), 0o700)
                runtime_dirs.add(run)
            self.assertEqual(len(runtime_dirs), 4)

    def test_default_uses_global_catalogue_for_both_runtime_managers(self):
        for runtime, observed_default in [('herdr', True), ('herdr-core', False)]:
            with self.subTest(runtime=runtime):
                connection = dict(connection_id='walk-' + runtime, is_default=observed_default)
                world = Mock()
                world.ready.return_value = connection
                world.rpc.return_value = dict(default_connection_id=connection['connection_id'])
                self.assertIs(default_connection(world, runtime), connection)
                world.ready.assert_called_once_with(runtime)
                world.rpc.assert_called_once_with('connections.list')

    def test_default_rejects_another_or_missing_selection_even_if_observation_claims_default(self):
        world = Mock()
        world.ready.return_value = dict(connection_id='walk-core', is_default=True)
        for catalogue in ({'default_connection_id': 'another-runtime'}, {}):
            world.rpc.return_value = catalogue
            with self.subTest(catalogue=catalogue), self.assertRaisesRegex(AssertionError, 'default runtime'):
                default_connection(world, 'herdr-core')


if __name__ == '__main__':
    unittest.main()
