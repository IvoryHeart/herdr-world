"""Exercise acceptance assertions offline, without containers or World processes."""
import ast
import copy
from pathlib import Path
import unittest


# Load only the assertions and client methods, leaving the container's config,
# signal handlers, websocket dependency and scenario entry point untouched.
source = Path(__file__).with_name('scenarios.py')
tree = ast.parse(source.read_text())
definitions = [node for node in tree.body
               if isinstance(node, (ast.ClassDef, ast.FunctionDef))
               and node.name in ('World', 'assert_tui_default')]
namespace = {'CASE': 'stopped', 'CONFIG': {'core': 'latest'}}
exec(compile(ast.Module(body=definitions, type_ignores=[]), str(source), 'exec'), namespace)
World = namespace['World']
assert_tui_default = namespace['assert_tui_default']


class InstallerAssertions(unittest.TestCase):
    def test_preserves_implicit_and_saved_tui_defaults(self):
        for connection_id in ('startup-default', 'local', 'saved-tui'):
            with self.subTest(connection_id=connection_id):
                profiles = self.profiles(connection_id)
                assert_tui_default(profiles, copy.deepcopy(profiles))

    def test_rejects_changed_tui_default_or_endpoint(self):
        initial = self.profiles('saved-tui')
        for field, value in (('id', 'different-tui'), ('type', 'ssh'),
                             ('control_socket_path', '/tmp/other-control.sock'),
                             ('client_socket_path', '/tmp/other-render.sock')):
            with self.subTest(field=field):
                changed = copy.deepcopy(initial)
                changed['connections'][0][field] = value
                if field == 'id':
                    changed['default_connection_id'] = value
                with self.assertRaises(AssertionError):
                    assert_tui_default(initial, changed)

    def test_ready_core_can_precede_setup_job_completion(self):
        for phase in ('installing', 'done'):
            with self.subTest(phase=phase):
                world, profiles = self.world(phase)
                self.assertEqual(world.setup(), profiles)

    def test_ready_core_does_not_hide_failed_or_unstarted_setup(self):
        for phase in ('failed', 'idle'):
            with self.subTest(phase=phase):
                world, _ = self.world(phase)
                with self.assertRaises(AssertionError):
                    world.setup()

    def test_ready_core_does_not_skip_unfinished_install_steps(self):
        world, _ = self.world('installing', lines=['Starting herdr-core...'])
        with self.assertRaises(AssertionError):
            world.setup()

    @staticmethod
    def profiles(connection_id):
        return {'default_connection_id': connection_id, 'connections': [
            {'id': connection_id, 'type': 'local',
             'control_socket_path': '/tmp/fixture-control.sock',
             'client_socket_path': '/tmp/fixture-render.sock'}]}

    @staticmethod
    def world(phase, lines=None):
        world = World()
        profiles = {'core_connections': [{'id': 'core-local', 'state': 'ready'}]}

        def rpc(method, params):
            assert method == 'connections.core_install'
            if params['action'] == 'probe':
                return {'probe': {'login': 'systemd', 'core': 'herdr-core', 'herdr': None}}
            if params['action'] == 'install':
                return {'phase': 'installing'}
            assert params['action'] == 'status'
            return {'phase': phase, 'lines': lines if lines is not None else ['Connecting World...']}

        world.rpc = rpc
        world.ready = lambda: profiles
        return world, profiles


if __name__ == '__main__':
    unittest.main()
