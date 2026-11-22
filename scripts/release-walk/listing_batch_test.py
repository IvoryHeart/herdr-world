import contextlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from listing_batch import listing_batch


class ListingBatchTests(unittest.TestCase):
    def test_repetitions_are_independent_and_stop_at_the_first_failure(self):
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
                root = Path(directory)
                homes = []

                def fixture(home, *_):
                    home.mkdir()
                    homes.append(home)
                    value = MagicMock()
                    value.env = {'CODEX_HOME': str(home)}
                    value.__enter__.return_value = value
                    return value

                stack.enter_context(patch('listing_batch.Fixture', side_effect=fixture))
                stack.enter_context(patch('listing_batch.check_codex_update_policy'))
                for name in ('check_signed_out', 'default_connection', 'room', 'launch', 'input_reaches'):
                    stack.enter_context(patch('listing_batch.' + name))
                check = stack.enter_context(patch('listing_batch.listing'))
                if fails:
                    check.side_effect = [None, AssertionError('synthetic missing agent')]
                config = dict(root=str(root), report=str(root / 'report.json'), listing_repetitions=3)
                context = dict(commit='a' * 40, platform='linux-x64', archive_sha256='b' * 64, binary_sha256='c' * 64)
                if fails:
                    with self.assertRaisesRegex(AssertionError, 'synthetic missing agent'):
                        listing_batch(config, None, None, None, context)
                else:
                    listing_batch(config, None, None, None, context)
                report = json.loads((root / 'listing-batch.json').read_text())
                expected = ['pass', 'fail'] if fails else ['pass'] * 3
                self.assertEqual([item['status'] for item in report['runs']], expected)
                self.assertEqual(report['status'], 'fail' if fails else 'pass')
                self.assertEqual(report['commit'], context['commit'])
                self.assertEqual(check.call_count, len(expected))
                self.assertEqual(len(set(homes)), len(expected))
                for home in homes:
                    self.assertEqual(json.loads((home / 'version.json').read_text())['latest_version'], '999.0.0')


if __name__ == '__main__':
    unittest.main()
