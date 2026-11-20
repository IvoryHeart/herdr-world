"""Regress walk requests against the product's real response shapes."""
import copy
import contextlib
import io
import json
import os
from pathlib import Path
import stat
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
from journeys import Fixture, launch, listing, upgrade
from processes import Events
from world import World


def cli_response(entries):
    return SimpleNamespace(stdout=json.dumps(dict(ok=True, result=dict(hosts=[], connections=entries))))


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
            agents.append(dict(connection=connection, result=result, workspace_id=workspace, runtime=runtime, kind=kind))
            rows.append(dict(**connection, stale=False, snapshot=dict(
                workspaces=[dict(workspace_id=workspace)], panes=[pane],
                agents=[dict(pane_id=pane['pane_id'], agent=kind)])))
            entries.append(dict(connection_id=runtime, current=True, workspaces=[dict(
                workspace_id=workspace, tabs=[dict(panes=[dict(pane_id=pane['pane_id'], agent=kind)])])]))
        return agents, rows, entries

    def listing_world(self, rows):
        world = SimpleNamespace(binary=Path('/synthetic/world'), env={}, base='http://127.0.0.1:1',
                                snapshot=Mock(return_value=rows), messages=Events())
        # Exercise the real event wait without starting a server or sleeping.
        world.observe = lambda read, predicate, reason: World.observe(world, read, predicate, reason, timeout=0)
        return world

    def test_listing_waits_for_pushed_topology_after_input_before_cli_converges(self):
        agents, rows, entries = self.listed_agents()
        world = self.listing_world(rows)
        pending = copy.deepcopy(entries)
        pending[0]['workspaces'][0]['tabs'][0]['panes'][0].pop('agent')
        def cli(*args):
            if world.snapshot.call_count == 1:
                # A CLI call takes a separate snapshot, after terminal input
                # invalidation. Only a real pushed update permits another read.
                world.messages.add(dict(method='world.changed'))
                return cli_response(pending)
            return cli_response(entries)
        with patch('journeys.run', side_effect=cli) as command:
            listing(world, agents)
        self.assertEqual(world.snapshot.call_count, 2)
        self.assertEqual(command.call_count, 2)
        self.assertEqual(command.call_args.args[0], [world.binary, 'ls', '--json'])
        self.assertEqual(command.call_args.args[1]['HERDR_WORLD_URL'], world.base)

    def test_listing_does_not_retry_without_a_push_and_names_the_missing_agent(self):
        agents, rows, entries = self.listed_agents()
        entries[1]['workspaces'][0]['tabs'][0]['panes'].clear()
        world = self.listing_world(rows)
        with patch('journeys.run', return_value=cli_response(entries)) as command:
            with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: herdr-world ls omitted a runtime agent'):
                listing(world, agents)
        self.assertEqual(world.snapshot.call_count, 1)
        self.assertEqual(command.call_count, 1)

    def test_listing_accepts_tui_launch_shape_and_runtime_agent_rows(self):
        agents, rows, entries = self.listed_agents()
        world = self.listing_world(rows)
        with patch('journeys.run', return_value=SimpleNamespace(stdout=json.dumps(entries))):
            listing(world, agents)

    def test_failed_listing_keeps_assertions_and_reads_native_core_once_without_private_data(self):
        agents, rows, entries = self.listed_agents()
        rows[1]['snapshot']['panes'][0].pop('agent')
        fixture = SimpleNamespace(tools=Path('/synthetic/tools'), env={'HC_SESSION': 'isolated'})
        for state, code in (('live', None), ('finished', 1)):
            native = dict(state=state, exit_code=code, argv=['private-argument'],
                          cwd='/private-path', foreground=dict(name='codex', argv=['private-argument']))
            output = io.StringIO()
            with self.subTest(state=state), contextlib.redirect_stdout(output), patch(
                    'journeys.run', side_effect=[cli_response(entries), SimpleNamespace(returncode=0, stdout=json.dumps(native))]) as command:
                with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: aggregate omitted the launched agent from its runtime room'):
                    listing(self.listing_world(rows), agents, fixture)
            self.assertEqual(command.call_count, 2)
            self.assertEqual(command.call_args.args, ([fixture.tools / 'core/herdr-core', 'get', '--json',
                                                       agents[1]['result']['terminal_id']], fixture.env))
            evidence = [json.loads(line.removeprefix('Listing diagnostic: ')) for line in output.getvalue().splitlines()]
            self.assertEqual(evidence[1]['native_state'], state)
            self.assertEqual(evidence[1]['native_exit_code'], code)
            self.assertTrue(evidence[1]['room_matches'])
            self.assertFalse(evidence[1]['harness_matches'])
            self.assertNotIn('private', output.getvalue())

    def test_listing_diagnostic_failure_cannot_replace_original_journey_failure(self):
        agents, rows, entries = self.listed_agents()
        rows[1]['snapshot']['panes'].clear()
        fixture = SimpleNamespace(tools=Path('/synthetic/tools'), env={})
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch('journeys.run', side_effect=[cli_response(entries), RuntimeError('private-path')]):
            with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: aggregate omitted the launched agent from its runtime room'):
                listing(self.listing_world(rows), agents, fixture)
        self.assertIn('"native_read": "unavailable"', output.getvalue())
        self.assertNotIn('private', output.getvalue())

    def test_listing_diagnostics_do_not_read_native_core_for_a_changed_generation(self):
        agents, rows, entries = self.listed_agents()
        rows[1]['generation'] += 1
        fixture = SimpleNamespace(tools=Path('/synthetic/tools'), env={})
        with contextlib.redirect_stdout(io.StringIO()), patch('journeys.run', return_value=cli_response(entries)) as command:
            with self.assertRaisesRegex(AssertionError, 'aggregate runtime generation changed'):
                listing(self.listing_world(rows), agents, fixture)
        self.assertEqual(command.call_count, 1)

    def test_listing_accepts_current_host_catalogue_and_previous_cli_array(self):
        agents, rows, entries = self.listed_agents()
        for result in (dict(hosts=[], connections=entries), entries):
            world = self.listing_world(rows)
            with self.subTest(result_type=type(result).__name__), patch(
                    'journeys.run', return_value=SimpleNamespace(stdout=json.dumps(dict(ok=True, result=result)))):
                listing(world, agents)

    def test_listing_rejects_missing_or_invalid_connections_in_cli_catalogue(self):
        agents, rows, entries = self.listed_agents()
        for result in (dict(hosts=entries), dict(connections=None), dict(hosts=entries, connections=[])):
            world = self.listing_world(rows)
            with self.subTest(result=result), patch(
                    'journeys.run', return_value=SimpleNamespace(stdout=json.dumps(dict(ok=True, result=result)))):
                with self.assertRaisesRegex(AssertionError, 'herdr-world ls'):
                    listing(world, agents)

    def test_listing_requires_all_agents_in_one_aggregate_and_cli_observation(self):
        agents, rows, entries = self.listed_agents()
        pending_rows = copy.deepcopy(rows)
        pending_rows[0]['snapshot']['agents'].clear()
        pending_entries = copy.deepcopy(entries)
        pending_entries[1]['workspaces'][0]['tabs'][0]['panes'].clear()
        world = self.listing_world(rows)
        world.snapshot.side_effect = [pending_rows, rows]
        def cli(*args):
            if world.snapshot.call_count == 1:
                world.messages.add(dict(method='world.changed'))
                return cli_response(entries)
            return cli_response(pending_entries)
        with patch('journeys.run', side_effect=cli) as command:
            with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: herdr-world ls omitted a runtime agent'):
                listing(world, agents)
        self.assertEqual(world.snapshot.call_count, 2)
        self.assertEqual(command.call_count, 2)

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
        def stale_cli_runtime(rows, entries):
            entries[0]['current'] = False
        def missing_cli_agent(rows, entries):
            entries[0]['workspaces'][0]['tabs'][0]['panes'].clear()
        def wrong_cli_agent(rows, entries):
            entries[0]['workspaces'][0]['tabs'][0]['panes'][0]['agent'] = 'codex'
        for mutate in (missing_runtime, stale_runtime, changed_generation, missing_room, missing_agent,
                       moved_agent, replaced_terminal, missing_cli_runtime, missing_cli_room,
                       stale_cli_runtime, missing_cli_agent, wrong_cli_agent):
            current_rows, current_entries = copy.deepcopy((rows, entries))
            mutate(current_rows, current_entries)
            world = self.listing_world(current_rows)
            with self.subTest(case=mutate.__name__), patch('journeys.run', return_value=cli_response(current_entries)):
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

    def test_upgrade_saves_both_pinned_runtime_profiles_before_unpinned_restart(self):
        self.upgrade_saved_profiles()

    def test_upgrade_allows_new_host_metadata_but_preserves_every_saved_field(self):
        def add_hosts(document):
            document['hosts'] = [dict(id='local', discovered=[])]
        self.upgrade_saved_profiles(add_hosts)
        def lose_profile(document):
            document['profiles'].pop()
        def change_endpoint(document):
            document['profiles'][0]['control_socket_path'] = 'another-synthetic.sock'
        def change_default(document):
            document['default_connection_id'] = 'walk-tui'
        def remove_default(document):
            document.pop('default_connection_id')
        for mutate, reason in ((lose_profile, 'upgrade'), (change_endpoint, 'upgrade'),
                               (change_default, 'default runtime'), (remove_default, 'default runtime')):
            with self.subTest(case=mutate.__name__), self.assertRaisesRegex(AssertionError, reason):
                self.upgrade_saved_profiles(mutate)

    def upgrade_saved_profiles(self, mutate_candidate=None):
        with tempfile.TemporaryDirectory(prefix='walk-upgrade-') as directory:
            root = Path(directory)
            fixture = Fixture(root, root / 'tools', SimpleNamespace(path=root / 'events.sock'))
            baseline, candidate = root / 'baseline', root / 'candidate'
            baseline.write_text('previous-published-binary')
            candidate.write_text('candidate-binary')
            saved = root / 'world/connections.json'
            started = []
            startup = dict(id='startup-default', type='local',
                           control_socket_path=str(root / 'tui-control.sock'),
                           client_socket_path=str(root / 'tui-render.sock'))
            def world_process(binary, home, env, cookie=None):
                started.append((Path(binary).read_text(), dict(env), cookie))
                if 'HERDR_SESSION' not in env:
                    profiles = json.loads(saved.read_text())['profiles']
                    self.assertEqual({item['id'] for item in profiles}, {'walk-tui', 'walk-core'})
                    tui = next(item for item in profiles if item['id'] == 'walk-tui')
                    self.assertEqual(tui['control_socket_path'], startup['control_socket_path'])
                    self.assertEqual(tui['client_socket_path'], startup['client_socket_path'])
                if Path(binary).read_text() == 'candidate-binary' and mutate_candidate:
                    document = json.loads(saved.read_text())
                    mutate_candidate(document)
                    saved.write_text(json.dumps(document))
                world = MagicMock(cookie='session=synthetic')
                world.__enter__.return_value = world
                world.ready.side_effect = lambda runtime: dict(connection_id='walk-core' if runtime == 'herdr-core' else
                                                               'startup-default' if 'HERDR_SESSION' in env else 'walk-tui')
                def rpc(method, params=None):
                    if method == 'connections.create':
                        # An explicit session pins a read-only startup profile.
                        # Creating core does not implicitly save that TUI profile.
                        document = json.loads(saved.read_text()) if saved.exists() else dict(
                            default_connection_id=params['profile']['id'], profiles=[])
                        document['profiles'].append(params['profile'])
                        saved.write_text(json.dumps(document))
                    if method == 'connections.set_default':
                        assert 'HERDR_SESSION' not in env, 'explicit session pins the process default'
                        document = json.loads(saved.read_text())
                        document['default_connection_id'] = params['id']
                        saved.write_text(json.dumps(document))
                    if method == 'connections.list':
                        if 'HERDR_SESSION' in env:
                            return dict(default_connection_id=startup['id'], connections=[startup])
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

    def test_upgrade_prepares_private_settings_for_the_real_connection_store(self):
        with tempfile.TemporaryDirectory(prefix='walk-upgrade-') as directory:
            root = Path(directory)
            fixture = Fixture(root, root / 'tools', SimpleNamespace(path=root / 'events.sock'))
            baseline, candidate = root / 'baseline', root / 'candidate'
            baseline.write_text('baseline')
            candidate.write_text('candidate')
            class SetupInspected(Exception):
                pass
            def inspect(*args, **kwargs):
                if os.name != 'nt':
                    self.assertEqual(stat.S_IMODE((root / 'world').stat().st_mode), 0o700)
                    self.assertEqual(stat.S_IMODE((root / 'world/settings.json').stat().st_mode), 0o600)
                raise SetupInspected()
            # A normal umask made the old fixture create a 0755 directory; the
            # real ConnectionProfileStore rejects that overridden data folder.
            previous = os.umask(0o022)
            try:
                with patch('journeys.World', side_effect=inspect), self.assertRaises(SetupInspected):
                    upgrade(Mock(), candidate, baseline, fixture)
            finally:
                os.umask(previous)


if __name__ == '__main__':
    unittest.main()
