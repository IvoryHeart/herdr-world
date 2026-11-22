import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contract import HARNESS_VERSIONS, CORE_VERSION, Walk, journeys, validate_receipt, validate_publication
from assets import environment
from service import service_guard


def receipt(mode='ci', platform='linux-x64'):
    return dict(schema=1, mode=mode, platform=platform, commit='a' * 40,
                version='0.3.6', binary_sha256='b' * 64, archive_sha256='c' * 64,
                baseline='v0.3.5', harnesses=HARNESS_VERSIONS.copy(), core_version=CORE_VERSION,
                status='pass', journeys=[dict(name=name, status='pass') for name in journeys(mode)],
                negative_control=dict(tag='v0.3.5', status='expected-failure',
                                      journey='New agent starts: TUI quick Claude', reason='agent never started', binary_sha256='e' * 64))


class ReceiptTests(unittest.TestCase):
    def test_missing_skipped_failed_and_duplicate_journeys_never_pass(self):
        validate_receipt(receipt())
        for change in ('missing', 'skip', 'fail', 'duplicate'):
            report = receipt()
            if change == 'missing':
                report['journeys'].pop()
            elif change == 'duplicate':
                report['journeys'].append(report['journeys'][0])
            else:
                report['journeys'][0]['status'] = change
            with self.subTest(change=change), self.assertRaises(AssertionError):
                validate_receipt(report)

    def test_publication_requires_exact_commit_bytes_platforms_and_signed_in_reply(self):
        reports = [receipt(platform=name) for name in ('linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64')]
        signed = receipt('signed-in')
        validate_publication(reports, signed, 'a' * 40, '0.3.6')
        for field in ('commit', 'binary_sha256', 'archive_sha256', 'baseline', 'version'):
            changed = copy.deepcopy(signed)
            changed[field] = 'd' * (40 if field == 'commit' else 64)
            with self.subTest(field=field), self.assertRaises(AssertionError):
                validate_publication(reports, changed, 'a' * 40, '0.3.6')
        with self.assertRaises(AssertionError):
            validate_publication(reports[:-1], signed, 'a' * 40, '0.3.6')
        with self.assertRaises(AssertionError):
            validate_publication(reports, receipt(), 'a' * 40, '0.3.6')
        private = receipt('signed-in')
        private['credentials'] = 'synthetic accidental private field'
        with self.assertRaises(AssertionError):
            validate_publication(reports, private, 'a' * 40, '0.3.6')

    def test_network_error_is_not_a_historical_launch_regression(self):
        reports = [receipt(platform=name) for name in ('linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64')]
        reports[0]['negative_control']['reason'] = 'download failed'
        with self.assertRaises(AssertionError):
            validate_publication(reports, receipt('signed-in'), 'a' * 40, '0.3.6')

    def test_partial_walk_serializes_missing_journeys_as_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / 'artifact'
            artifact.write_bytes(b'synthetic receipt test')
            walk = Walk('ci', 'a' * 40, '0.3.6', artifact, artifact, 'v0.3.5')
            with walk.journey('Fresh World: core only'):
                pass
            walk.write(root / 'report.json')
            report = json.loads((root / 'report.json').read_text())
            self.assertEqual(report['status'], 'fail')
            self.assertIn('not-run', [item['status'] for item in report['journeys']])
            with self.assertRaises(AssertionError):
                validate_receipt(report)

    def test_failed_journey_prints_exception_message_and_traceback_without_locals(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact'
            artifact.write_bytes(b'synthetic artifact')
            walk = Walk('ci', 'a' * 40, '0.3.6', artifact, artifact, 'v0.3.5')
            output = io.StringIO()
            with contextlib.redirect_stderr(output), self.assertRaisesRegex(TypeError, 'synthetic kqueue cause'):
                with walk.journey('Service install and uninstall'):
                    private_local = 'synthetic private local value'
                    try:
                        raise OSError('synthetic original cause')
                    except OSError as error:
                        raise TypeError('synthetic kqueue cause') from error
            diagnostic = output.getvalue()
            self.assertIn('FAIL Service install and uninstall: TypeError: synthetic kqueue cause', diagnostic)
            self.assertIn('Traceback (most recent call last):', diagnostic)
            self.assertIn('contract_test.py', diagnostic)
            self.assertIn('OSError: synthetic original cause', diagnostic)
            self.assertNotIn(str(Path(__file__).resolve().parent), diagnostic)
            self.assertNotIn(private_local, diagnostic)
            self.assertEqual(walk.report['journeys'], [dict(name='Service install and uninstall', status='fail',
                                                          reason='TypeError during journey')])

    def test_setup_failure_prints_original_exception_and_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            config.write_text('[]')  # Invalid config fails before any runtime or service is touched.
            result = subprocess.run([sys.executable, 'scripts/release-walk/main.py', str(config)],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('FAIL release walk: TypeError: list indices must be integers or slices, not str', result.stderr)
            self.assertIn('Traceback (most recent call last):', result.stderr)
            self.assertIn('main.py', result.stderr)
            self.assertIn('in main', result.stderr)
            self.assertNotIn(str(Path.cwd()), result.stderr)

    def test_runtime_environment_cannot_inherit_owner_routes_or_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'HERDR_SOCKET_PATH': '/owner/control.sock', 'HERDR_SESSION': 'owner',
            'HERDR_WORLD_DATA_DIR': '/owner/world', 'OPENAI_API_KEY': 'synthetic-owner-token',
        }):
            root = Path(directory)
            env = environment(root / 'home', root / 'tools', 'walk-isolated', False, root / 'events.sock')
            for key in ('HERDR_SOCKET_PATH', 'HERDR_SESSION', 'HERDR_WORLD_DATA_DIR', 'OPENAI_API_KEY'):
                self.assertNotIn(key, env)
            self.assertEqual(env['HC_SESSION'], 'walk-isolated')
            self.assertNotIn(str(root / 'tools/tui'), env['PATH'])
            self.assertEqual(env['CLAUDE_CONFIG_DIR'], str(root / 'home/.claude'))
            self.assertIn('check_for_update_on_startup = false',
                          (Path(env['CODEX_HOME']) / 'config.toml').read_text())

    def test_service_guard_refuses_existing_configuration_and_implicit_consent(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with self.assertRaises(AssertionError):
                service_guard(home, False)
            service_guard(home, True)
            config = home / '.config/herdr-world/herdr-world.env'
            config.parent.mkdir(parents=True)
            config.write_text('synthetic existing service')
            with self.assertRaises(AssertionError):
                service_guard(home, True)
            self.assertEqual(config.read_text(), 'synthetic existing service')
            config.unlink()
            for relative, contents in [
                ('Library/LaunchAgents/homebrew.mxcl.herdr-world.plist', '<plist/>'),
                ('Library/LaunchAgents/custom.plist', '<string>/opt/example/herdr-world</string>'),
                ('.config/systemd/user/custom.service', 'ExecStart=/opt/example/herdr-world'),
                ('.config/systemd/user/legacy.service', '# Generated by herdr-world service install.'),
            ]:
                definition = home / relative
                definition.parent.mkdir(parents=True, exist_ok=True)
                definition.write_text(contents)
                with self.subTest(relative=relative), self.assertRaises(AssertionError):
                    service_guard(home, True)
                self.assertEqual(definition.read_text(), contents)
                definition.unlink()
            unrelated = home / 'Library/LaunchAgents/unrelated.plist'
            unrelated.write_text('<string>/opt/example/other-service</string>')
            service_guard(home, True)


if __name__ == '__main__':
    unittest.main()
