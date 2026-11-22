"""Failure evidence must retain the cause without publishing sign-in material."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from diagnostics import capture_listing, redact
from journeys import listing
import journeys_test as journeys
from processes import Events


class DiagnosticsTests(unittest.TestCase):
    def fixture(self, root, agent):
        telemetry = Events()
        agent['invocation'] = dict(identity='42')
        telemetry.add(dict(event='terminated', identity='other', reason='wrong-agent'))
        telemetry.add(dict(event='terminated', identity='42', kind='codex',
                           reason='runtime-input-eof', source='runtime-input',
                           output_tail='Sign in https://auth.example.invalid/device?token=private-token\nABCD-EFGHJ\nfinal screen'))
        return SimpleNamespace(tools=root / 'tools', env={}, telemetry=telemetry,
                               failure_artifact=root / 'listing-failure.json',
                               failure_context=dict(commit='a' * 40, platform='darwin-arm64'))

    def test_failed_listing_retains_redacted_terminal_recorder_and_runtime_snapshot(self):
        helper = journeys.JourneyTests()
        agents, rows, entries = helper.listed_agents()
        rows[1]['snapshot']['panes'].clear()
        rows[1]['snapshot']['secret_token'] = 'private-token'
        rows[1]['snapshot']['cwd'] = '/synthetic/fixture/cwd'
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(Path(directory), agents[1])
            native = SimpleNamespace(returncode=0, stdout=json.dumps(dict(text='final screen\nhttps://auth.example.invalid/private\naccess_token=private-token')))
            with contextlib.redirect_stdout(io.StringIO()), patch('journeys.run', side_effect=[journeys.cli_response(entries), RuntimeError()]), patch('diagnostics.run', return_value=native) as command:
                with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: aggregate omitted'):
                    listing(helper.listing_world(rows), agents, fixture)
            artifact = fixture.failure_artifact.read_text()
            evidence = json.loads(artifact)
            self.assertNotIn('private', artifact)
            self.assertNotIn('/synthetic', artifact)
            self.assertNotIn('ABCD-EFGHJ', artifact)
            self.assertNotIn('wrong-agent', artifact)
            self.assertIn('final screen', evidence['terminal']['text'])
            self.assertEqual(evidence['recorder']['reason'], 'runtime-input-eof')
            self.assertEqual(evidence['aggregate']['connection_id'], 'herdr-core')
            self.assertEqual(evidence['aggregate']['snapshot']['panes'], [])
            self.assertEqual(evidence['context']['platform'], 'darwin-arm64')
            self.assertEqual(evidence['context']['commit'], 'a' * 40)
            self.assertEqual(command.call_args.args[0], [fixture.tools / 'core/herdr-core', 'read', '--json', agents[1]['result']['terminal_id']])
            self.assertEqual(command.call_args.kwargs['timeout'], 10)

    def test_changed_generation_never_reads_another_terminal(self):
        agents, rows, _ = journeys.JourneyTests().listed_agents()
        rows[1]['generation'] += 1
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(Path(directory), agents[1])
            with patch('diagnostics.run') as command:
                capture_listing(rows, agents, fixture)
            command.assert_not_called()
            evidence = json.loads(fixture.failure_artifact.read_text())
            self.assertEqual(evidence['terminal']['status'], 'generation-changed')
            self.assertEqual(evidence['expected_generation'], 1)
            self.assertEqual(evidence['aggregate']['generation'], 2)

    def test_native_read_failure_still_saves_recorder_screen_and_snapshot(self):
        agents, rows, _ = journeys.JourneyTests().listed_agents()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(Path(directory), agents[1])
            with patch('diagnostics.run', side_effect=RuntimeError('private-token')):
                capture_listing(rows, agents, fixture)
            evidence = json.loads(fixture.failure_artifact.read_text())
            self.assertEqual(evidence['terminal']['status'], 'unavailable')
            self.assertIn('final screen', evidence['recorder']['output_tail'])
            self.assertNotIn('private', fixture.failure_artifact.read_text())

    def test_capture_failure_never_replaces_listing_reason_and_success_writes_nothing(self):
        helper = journeys.JourneyTests()
        agents, rows, entries = helper.listed_agents()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(Path(directory), agents[1])
            with patch('journeys.run', return_value=journeys.cli_response(entries)), patch('journeys.capture_listing') as capture:
                listing(helper.listing_world(rows), agents, fixture)
                capture.assert_not_called()
            rows[1]['snapshot']['panes'].clear()
            with contextlib.redirect_stdout(io.StringIO()), patch('journeys.run', side_effect=[journeys.cli_response(entries), RuntimeError()]), patch('journeys.capture_listing', side_effect=OSError('private-path')):
                with self.assertRaisesRegex(AssertionError, 'herdr-core/codex: aggregate omitted'):
                    listing(helper.listing_world(rows), agents, fixture)
            world = helper.listing_world(rows)
            world.snapshot.side_effect = RuntimeError('aggregate read failed')
            with contextlib.redirect_stdout(io.StringIO()), patch('journeys.capture_listing') as capture:
                with self.assertRaisesRegex(RuntimeError, 'aggregate read failed'):
                    listing(world, agents, fixture)
                capture.assert_called_once_with([], agents, fixture)

    def test_live_recorder_is_explicit_and_terminal_output_is_bounded(self):
        agents, rows, _ = journeys.JourneyTests().listed_agents()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(Path(directory), agents[1])
            fixture.telemetry.items.clear()
            native = SimpleNamespace(returncode=0, stdout=json.dumps(dict(text='screen ' * 40000)))
            with patch('diagnostics.run', return_value=native):
                capture_listing(rows, agents, fixture)
            evidence = json.loads(fixture.failure_artifact.read_text())
            self.assertEqual(evidence['recorder']['reason'], 'no-termination-observed')
            self.assertEqual(len(evidence['terminal']['text']), 131072)

    def test_redaction_handles_ansi_split_links_credentials_paths_and_device_codes(self):
        raw = '\x1b]8;;https://auth.example.invalid/token\x1b\\sign in\x1b]8;;\x1b\\\nhttps://auth.\x1b[31mexample.invalid/token\nAuthorization: Bearer private-token\n"refresh_token": "private-token"\ncode: ABCDE-FGHIJ\n/synthetic/fixture/cwd\n' + 'opaque' * 10 + '\nWALK_INPUT_complete\n'
        safe = redact(raw, screen=True)
        for forbidden in ('https:', 'example.invalid', 'private', 'ABCDE-FGHIJ', '\x1b', 'opaque'):
            self.assertNotIn(forbidden, safe)
        self.assertNotIn('/synthetic', safe)
        self.assertIn('WALK_INPUT_complete', safe)


if __name__ == '__main__':
    unittest.main()
