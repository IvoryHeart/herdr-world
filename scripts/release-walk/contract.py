"""Public receipts contain synthetic evidence only; never transcripts or credentials."""
import contextlib
import hashlib
import json
from pathlib import Path
import platform
import re
import sys
import traceback

HARNESS_VERSIONS = {'claude': '2.1.328', 'codex': '0.170.0'}
CORE_VERSION = '0.1.21'
PAIRS = [(runtime, kind) for runtime in ('herdr', 'herdr-core')
         for kind in ('claude', 'codex')]


def journeys(mode):
    result = ['Fresh World: core only', 'Fresh World: TUI only', 'Fresh World: both']
    result += [f'New agent starts: {runtime}/{kind}' for runtime, kind in PAIRS]
    result += ['New agent starts: TUI quick Claude']
    result += [f'Prompt reaches input: {runtime}/{kind}' for runtime, kind in PAIRS]
    result += ['Every runtime is listed', 'Previous release upgrade',
               'Service install and uninstall', 'Previous release service uninstall']
    if mode == 'signed-in':
        result += [f'Prompt and Chat reply: {runtime}/{kind}' for runtime, kind in PAIRS]
    return result


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_receipt(report, sha=None):
    allowed = {'schema', 'mode', 'commit', 'version', 'platform', 'binary_sha256',
               'archive_sha256', 'baseline', 'harnesses', 'core_version', 'journeys',
               'status', 'negative_control'}
    assert set(report).issubset(allowed), 'Receipt contains unexpected fields; do not upload private data'
    assert report['schema'] == 1, 'Unrecognized release-walk receipt'
    assert report['mode'] in ('ci', 'signed-in'), 'Unknown walk mode'
    assert re.fullmatch(r'[a-f0-9]{40}', report['commit']), 'Missing exact commit'
    if sha:
        assert report['commit'] == sha, 'Walk ran a different release commit'
    for key in ('binary_sha256', 'archive_sha256'):
        assert re.fullmatch(r'[a-f0-9]{64}', report[key]), 'Missing package digest'
    actual = report['journeys']
    assert [item['name'] for item in actual] == journeys(report['mode']), 'Missing, extra or reordered journey'
    assert all(item['status'] == 'pass' for item in actual), 'A journey failed or was skipped'
    assert all(set(item) == {'name', 'status'} for item in actual), 'Successful journeys must not contain private diagnostics'
    assert report['status'] == 'pass', 'Walk did not pass'
    assert report['harnesses'] == HARNESS_VERSIONS, 'Different harness versions'
    assert report['core_version'] == CORE_VERSION, 'Different core release'
    if 'negative_control' in report:
        control = report['negative_control']
        assert set(control) == {'tag', 'status', 'journey', 'reason', 'binary_sha256'}, 'Unexpected negative-control evidence'
        assert control['tag'] == 'v0.3.5' and control['status'] == 'expected-failure', 'Invalid historical launch proof'
        assert control['journey'] == 'New agent starts: TUI quick Claude' and control['reason'] == 'agent never started', 'Historical failure was not the launch regression'
        assert re.fullmatch(r'[a-f0-9]{64}', control['binary_sha256']), 'Missing historical binary digest'


def validate_publication(reports, signed, sha, version):
    expected = {'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'}
    assert len(reports) == len(expected), 'Require all four native walk receipts'
    assert {report['platform'] for report in reports} == expected, 'Missing Linux or macOS architecture'
    for report in reports + ([signed] if signed is not None else []):
        validate_receipt(report, sha)
        assert report['version'] == version, 'Walk ran a different release version'
    assert all(report['mode'] == 'ci' for report in reports), 'Native receipts must be CI walks'
    if signed is not None:
        assert signed['mode'] == 'signed-in', 'Require the signed-in local walk'
        match = next((report for report in reports if report['platform'] == signed['platform']), None)
        assert match, 'Signed-in walk platform was not tested in CI'
        for key in ('binary_sha256', 'archive_sha256', 'baseline'):
            assert match[key] == signed[key], 'Signed-in walk did not use the same release package/baseline'
    control = next(report for report in reports if report['platform'] == 'linux-x64')['negative_control']
    assert control['tag'] == 'v0.3.5' and control['status'] == 'expected-failure', 'Missing v0.3.5 launch proof'
    assert control['journey'] == 'New agent starts: TUI quick Claude', 'Wrong negative-control journey'
    assert control['reason'] == 'agent never started', 'Historical failure was not the launch regression'
    assert re.fullmatch(r'[a-f0-9]{64}', control['binary_sha256']), 'Missing v0.3.5 binary digest'


def print_failure(name, error):
    print(f'FAIL {name}: {type(error).__name__}: {error}', file=sys.stderr, flush=True)
    # Preserve the exception and its chain without dumping locals or absolute
    # source paths. Raw diagnostics belong in the log, never in public receipts.
    detail = traceback.TracebackException.from_exception(error, capture_locals=False)
    pending = [detail]
    while pending:
        current = pending.pop()
        for frame in current.stack:
            frame.filename = Path(frame.filename).name
        pending.extend(cause for cause in (current.__cause__, current.__context__)
                       if cause is not None)
        pending.extend(getattr(current, 'exceptions', None) or [])
    print(''.join(detail.format()), file=sys.stderr, end='', flush=True)


class Walk:
    def __init__(self, mode, commit, version, archive, binary, baseline):
        machine = {'x86_64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}[platform.machine()]
        self.report = dict(schema=1, mode=mode, commit=commit, version=version,
                           platform=('darwin' if platform.system() == 'Darwin' else 'linux') + '-' + machine,
                           archive_sha256=digest(archive), binary_sha256=digest(binary),
                           baseline=baseline, harnesses=HARNESS_VERSIONS, core_version=CORE_VERSION,
                           journeys=[], status='fail')

    @contextlib.contextmanager
    def journey(self, name):
        assert name in journeys(self.report['mode']), 'Unknown journey'
        assert not any(item['name'] == name for item in self.report['journeys']), 'Repeated journey'
        print(f'RUN {name}', flush=True)
        item = {'name': name, 'status': 'fail'}
        self.report['journeys'].append(item)
        try:
            yield
            item['status'] = 'pass'
            print(f'PASS {name}', flush=True)
        except Exception as error:
            # Keep the receipt's bounded reason separate from console diagnostics.
            reason = str(error) if isinstance(error, (AssertionError, RuntimeError)) else type(error).__name__ + ' during journey'
            item['reason'] = reason
            print_failure(name, error)
            raise

    def write(self, path):
        required = journeys(self.report['mode'])
        by_name = {item['name']: item for item in self.report['journeys']}
        self.report['journeys'] = [by_name.get(name, {'name': name, 'status': 'not-run'}) for name in required]
        self.report['status'] = 'pass' if all(item['status'] == 'pass' for item in self.report['journeys']) else 'fail'
        path.write_text(json.dumps(self.report, indent=2) + '\n')
