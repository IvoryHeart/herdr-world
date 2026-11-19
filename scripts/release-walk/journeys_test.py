"""Regress walk requests against the product's real response shapes."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
from journeys import Fixture, launch, listing, upgrade


class JourneyTests(unittest.TestCase):
    def listed_agents(self):
        agents, rows, entries = [], [], []
        for runtime, kind in [('herdr', 'claude'), ('herdr-core', 'codex')]:
            connection = dict(connection_id=runtime, generation=1)
            workspace = runtime + '-room'
            pane = dict(pane_id=runtime + '-pane', terminal_id=runtime + '-terminal',
                        workspace_id=workspace, agent=kind)
            # TUI launch replies have no workspace_id. The room is an input.
            result = dict(tab_id=runtime + '-tab', pane_id=pane['pane_id'], terminal_id=pane['terminal_id'])
            if runtime == 'herdr-core':
                result['workspace_id'] = workspace
            agents.append(dict(connection=connection, result=result, workspace_id=workspace, kind=kind))
            rows.append(dict(**connection, stale=False, snapshot=dict(
                workspaces=[dict(workspace_id=workspace)], panes=[pane],
                agents=[dict(pane_id=pane['pane_id'], agent=kind)])))
            entries.append(dict(connection_id=runtime, current=True, workspaces=[dict(
                workspace_id=workspace, tabs=[dict(panes=[dict(pane_id=pane['pane_id'], agent=kind)])])]))
        return agents, rows, entries

    def test_listing_accepts_tui_launch_shape_and_runtime_agent_rows(self):
        agents, rows, entries = self.listed_agents()
        world = Mock(binary=Path('/synthetic/world'), env={}, base='http://127.0.0.1:1')
        world.snapshot.return_value = rows
        with patch('journeys.run', return_value=SimpleNamespace(stdout=json.dumps(entries))):
            listing(world, agents)

    def test_listing_rejects_missing_stale_moved_or_replaced_runtime_agents(self):
        agents, rows, entries = self.listed_agents()
        def missing_runtime(rows, entries):
            rows.pop(0)
        def stale_runtime(rows, entries):
            rows[0]['stale'] = True
        def changed_generation(rows, entries):
            rows[0]['generation'] += 1
        def missing_room(rows, entries):
            rows[0]['snapshot']['workspaces'].clear()
        def missing_agent(rows, entries):
            rows[0]['snapshot']['agents'].clear()
        def moved_agent(rows, entries):
            rows[0]['snapshot']['panes'][0]['workspace_id'] = 'another-room'
        def replaced_terminal(rows, entries):
            rows[0]['snapshot']['panes'][0]['terminal_id'] = 'another-terminal'
        def missing_cli_runtime(rows, entries):
            entries.pop(0)
        def missing_cli_room(rows, entries):
            entries[0]['workspaces'].clear()
        def missing_cli_agent(rows, entries):
            entries[0]['workspaces'][0]['tabs'][0]['panes'].clear()
        for mutate in (missing_runtime, stale_runtime, changed_generation, missing_room, missing_agent,
                       moved_agent, replaced_terminal, missing_cli_runtime, missing_cli_room, missing_cli_agent):
            current_rows, current_entries = copy.deepcopy((rows, entries))
            mutate(current_rows, current_entries)
            world = Mock(binary=Path('/synthetic/world'), env={}, base='http://127.0.0.1:1')
            world.snapshot.return_value = current_rows
            with self.subTest(case=mutate.__name__), patch('journeys.run', return_value=SimpleNamespace(stdout=json.dumps(current_entries))):
                with self.assertRaisesRegex(AssertionError, 'aggregate|herdr-world ls'):
                    listing(world, agents)

    def test_launch_retains_requested_room_separately_from_tui_reply(self):
        world, fixture = Mock(), Mock()
        result = dict(tab_id='tab', pane_id='pane', terminal_id='terminal')
        world.rpc.return_value = result
        fixture.telemetry.items = []
        fixture.telemetry.wait.return_value = (0, dict(identity='synthetic', settings=[dict(statusLine=dict(command='complete'))]))
        with patch('journeys.complete_arguments'), patch('journeys.pane_for', return_value=dict(workspace_id='requested-room')):
            agent = launch(world, fixture, dict(connection_id='tui', generation=1), 'herdr', 'claude', 'requested-room', quick=True)
        self.assertEqual(agent['workspace_id'], 'requested-room')
        self.assertEqual(agent['result'], result)
        self.assertNotIn('workspace_id', result)

    def test_upgrade_changes_saved_default_only_after_removing_process_pin(self):
        with tempfile.TemporaryDirectory(prefix='walk-upgrade-') as directory:
            root = Path(directory)
            fixture = Fixture(root, root / 'tools', SimpleNamespace(path=root / 'events.sock'))
            baseline, candidate = root / 'baseline', root / 'candidate'
            baseline.write_text('previous-published-binary')
            candidate.write_text('candidate-binary')
            saved = root / 'world/connections.json'
            started = []
            def world_process(binary, home, env, cookie=None):
                started.append((Path(binary).read_text(), dict(env), cookie))
                world = MagicMock(cookie='session=synthetic')
                world.__enter__.return_value = world
                world.ready.side_effect = lambda runtime: dict(connection_id='walk-core' if runtime == 'herdr-core' else 'local')
                def rpc(method, params=None):
                    if method == 'connections.create':
                        saved.write_text(json.dumps(dict(default_connection_id='local', profiles=[
                            dict(id='local', control_socket_path='isolated-tui.sock'), params['profile']])))
                    if method == 'connections.set_default':
                        assert 'HERDR_SESSION' not in env, 'explicit session pins the process default'
                        document = json.loads(saved.read_text())
                        document['default_connection_id'] = params['id']
                        saved.write_text(json.dumps(document))
                    if method == 'connections.list':
                        return json.loads(saved.read_text())
                world.rpc.side_effect = rpc
                world.request.return_value.status = 401
                return world
            with patch('journeys.World', side_effect=world_process):
                upgrade(Mock(), candidate, baseline, fixture)
            self.assertEqual([item[0] for item in started], ['previous-published-binary', 'previous-published-binary', 'candidate-binary'])
            self.assertEqual(started[0][1]['HERDR_SESSION'], fixture.env['HERDR_SESSION'])
            for _, env, cookie in started[1:]:
                self.assertNotIn('HERDR_SESSION', env)
                self.assertEqual(env['HC_SESSION'], fixture.env['HC_SESSION'])
                self.assertEqual(cookie, 'session=synthetic')
            self.assertIn('HERDR_SESSION', fixture.env)


if __name__ == '__main__':
    unittest.main()
