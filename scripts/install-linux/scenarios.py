"""Runs as a normal user inside disposable systemd containers, never on the host."""
import contextlib
import hashlib
import http.server
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import websocket

CONFIG = json.loads(Path('/artifacts/config.json').read_text())
HOME = Path.home()
BIN = HOME / '.local/bin'
REGISTRY = Path(os.environ['HERDR_WORLD_CONNECTIONS_PATH'])
UNIT = HOME / '.config/systemd/user/herdr-core-login.service'
CASE = 'fresh' if sys.argv[1] == 'reboot' else sys.argv[1]
PASSWORD = 'install-fixture-password'
signal.signal(signal.SIGALRM, lambda *_: sys.exit('case deadline exceeded'))
signal.alarm(15 * 60)


@contextlib.contextmanager
def step(label):
    print(f'[{CASE}] CHECK {label}', flush=True)
    try:
        yield
    except Exception as error:
        raise RuntimeError(f'check "{label}": {error}') from error
    print(f'[{CASE}] PASS {label}', flush=True)


def run(*args, env=None):
    result = subprocess.run(args, env={**os.environ, **(env or {})},
                            text=True, capture_output=True, timeout=12 * 60)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} exited {result.returncode}: '
                           f'{(result.stdout + result.stderr)[-4000:]}')
    return result.stdout.strip()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def core_download(setup=False):
    # Reviewed production functions: checksum verified before execution.
    script = Path('/artifacts/herdr-core-install.sh').read_text()
    version = '' if CONFIG['core'] == 'latest' else CONFIG['core']
    action = 'setup' if setup else 'install'
    output = run('sh', '-c', script + f"\nherdr_core_{action} '{version}'")
    assert 'Checksum verified.' in output, output


def no_unit():
    assert not UNIT.exists(), 'installer added a core login unit without consent'


def unit_ready():
    assert UNIT.is_file(), 'core login unit is missing'
    assert run('systemctl', '--user', 'is-enabled', UNIT.name) == 'enabled'
    assert (BIN / 'herdr-core').is_file(), 'core executable is missing'
    # status reads the real core lock/server; it never starts the server.
    status = run('hc', 'server', 'status')
    assert status and 'not running' not in status.lower(), status


class Mirror(http.server.ThreadingHTTPServer):
    def __init__(self):
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory='/artifacts', **kwargs)

            def log_message(self, *_):
                pass
        super().__init__(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.serve_forever, daemon=True).start()


def install(baseline=False):
    env = {'HERDR_WORLD_VERSION': CONFIG['baseline'] if baseline else CONFIG['version']}
    if baseline:
        # Align with installer-upgrade.ts: current installer, published stable
        # executable and checksum, runtime setup independently exercised below.
        env['HERDR_WORLD_SKIP_HERDR'] = '1'
        output = run('sh', '/artifacts/install-herdr-world.sh', env=env)
    else:
        mirror = Mirror()
        try:
            env['HERDR_WORLD_RELEASE_BASE_URL'] = f'http://127.0.0.1:{mirror.server_port}'
            output = run('sh', '/artifacts/install-herdr-world.sh', env=env)
        finally:
            mirror.shutdown()
            mirror.server_close()
    assert run('herdr-world', '--version') == f"herdr-world {env['HERDR_WORLD_VERSION']}"
    return output


class World:
    def __enter__(self):
        env = {**os.environ, 'HOST': '127.0.0.1', 'PORT': '0',
               'HERDR_WORLD_PASSWORD': PASSWORD}
        self.process = subprocess.Popen(['herdr-world'], env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1)
        self.logs = []
        events = queue.Queue()

        def read():
            for line in self.process.stdout:
                self.logs.append(line)
                match = re.search(r'listening url=http://(?:127\.0\.0\.1|localhost):(\d+)', line)
                if match:
                    events.put('http://127.0.0.1:' + match[1])
            events.put(None)
        threading.Thread(target=read, daemon=True).start()
        try:
            try:
                self.base = events.get(timeout=60)
            except queue.Empty:
                raise RuntimeError('World did not report its listening URL: ' + ''.join(self.logs[-15:]))
            assert self.base, 'World exited before listening: ' + ''.join(self.logs[-15:])
            request = urllib.request.Request(self.base + '/api/login',
                                            data=json.dumps({'password': PASSWORD}).encode(),
                                            headers={'Content-Type': 'application/json', 'Origin': self.base})
            with urllib.request.urlopen(request, timeout=20) as response:
                cookie = response.headers['Set-Cookie'].split(';')[0]
            self.ws = websocket.create_connection(self.base.replace('http:', 'ws:') + '/ws',
                                                   cookie=cookie, origin=self.base, timeout=60)
            self.sequence = 0
            self.events = []
            self.receive_until(lambda message: message.get('hello'))
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if hasattr(self, 'ws'):
            self.ws.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

    def receive_until(self, predicate):
        deadline = time.monotonic() + 12 * 60
        while True:
            self.ws.settimeout(max(0.01, deadline - time.monotonic()))
            message = json.loads(self.ws.recv())
            if predicate(message):
                return message
            if message.get('control'):
                self.events.append(message)
            assert time.monotonic() < deadline, 'World event deadline exceeded'

    def rpc(self, method, params=None):
        self.sequence += 1
        request_id = str(self.sequence)
        self.ws.send(json.dumps({'id': request_id, 'method': method, 'params': params or {}}))
        reply = self.receive_until(lambda message: message.get('id') == request_id)
        assert not reply.get('error'), reply.get('error')
        return reply.get('result')

    def ready(self):
        def is_ready(message):
            event = message.get('control', {})
            return event.get('connection_state') == 'ready'
        profiles = self.rpc('connections.list')
        if not any(item['state'] == 'ready' for item in profiles['core_connections']):
            if not any(is_ready(event) for event in self.events):
                self.receive_until(is_ready)
            profiles = self.rpc('connections.list')
        core = next(item for item in profiles['core_connections'] if item['id'] == 'core-local')
        assert core['state'] == 'ready', core
        return profiles

    def setup(self):
        params = {'host': {'type': 'local'}}
        probe = self.rpc('connections.core_install', {**params, 'action': 'probe'})
        assert probe['probe']['login'] == 'systemd', probe
        assert bool(probe['probe']['core']) == (CASE == 'stopped'), probe
        assert bool(probe['probe']['herdr']) == (CASE == 'tui'), probe
        version = None if CONFIG['core'] == 'latest' else CONFIG['core']
        self.rpc('connections.core_install', {**params, 'action': 'install', 'version': version})
        # Await connection invalidation/ready events, not a timed status loop.
        try:
            profiles = self.ready()
        except Exception:
            status = self.rpc('connections.core_install', {**params, 'action': 'status'})
            raise RuntimeError(f'core setup did not connect: {status}')
        status = self.rpc('connections.core_install', {**params, 'action': 'status'})
        assert status['phase'] == 'done', status
        return profiles

    def core_only(self):
        assert REGISTRY.is_file(), 'core registration did not save connections.json'
        saved = json.loads(REGISTRY.read_text())
        assert saved['default_connection_id'] == 'core-local', 'saved default is not core-local'
        assert [item['runtime'] for item in saved['profiles']] == ['herdr-core'], saved
        profiles = self.ready()
        assert not profiles['connections'], 'saved or implicit Herdr TUI profile on core-only computer'
        assert profiles['default_connection_id'] == 'core-local', profiles
        snapshot = self.rpc('world.snapshot')
        assert [item['connection_id'] for item in snapshot['connections']] == ['core-local'], \
            'Town topology has a dead Local building'
        listing = run('herdr-world', 'ls', '--json', env={'HERDR_WORLD_URL': self.base,
                                                      'HERDR_WORLD_PASSWORD': PASSWORD})
        assert 'core-local' in listing, 'World CLI does not list core-local'


def scenario():
    if sys.argv[1] == 'reboot':
        with step('reboot starts core through the lingering user unit'):
            # Block on the real user default target's start transaction.
            boot = subprocess.run(['systemctl', '--user', 'is-system-running', '--wait'],
                                  text=True, capture_output=True, timeout=90)
            assert boot.stdout.strip() in ('running', 'degraded'), boot.stdout + boot.stderr
            run('systemctl', '--user', 'is-active', UNIT.name)
            unit_ready()
        with step('core-only default, saved profiles, CLI and Town after reboot'):
            with World() as world:
                world.core_only()
        return
    if CASE == 'tui':
        with step('official Herdr TUI download and pinned SHA-256'):
            BIN.mkdir(parents=True, exist_ok=True)
            tui = CONFIG['tui']
            run('curl', '--proto', '=https', '--proto-redir', '=https', '-fsSL',
                '--connect-timeout', '10', '--max-time', '600', tui['url'], '-o', str(BIN / 'herdr'))
            assert digest(BIN / 'herdr') == tui['sha256'], 'Herdr checksum mismatch'
            (BIN / 'herdr').chmod(0o755)
            assert tui['version'] in run('herdr', '--version')
            before = digest(BIN / 'herdr')
    elif CASE == 'stopped':
        with step('real core installed, stopped, without a login unit'):
            core_download()
            before = digest(BIN / 'herdr-core')
            no_unit()
    elif CASE == 'upgrade':
        with step('latest published stable World installed first'):
            install(baseline=True)
        with step('existing connections, chosen default and enabled core unit'):
            core_download(setup=True)
            run('herdr-world', 'connections', 'add', 'preserved', '--control-socket', '/tmp/preserved-control.sock',
                '--client-socket', '/tmp/preserved-render.sock', '--default')
            saved = json.loads(REGISTRY.read_text())
            saved['profiles'].append({'id': 'core-local', 'label': 'Fixture core', 'type': 'local',
                                      'runtime': 'herdr-core', 'core_session': 'default',
                                      'core_state_dir': '', 'auto_connect': True})
            REGISTRY.write_text(json.dumps(saved))
            unit_hash = digest(UNIT)
    with step('candidate standalone installer from in-container loopback mirror'):
        output = install()
        if CASE == 'fresh':
            assert 'Reading the herdr-core release list' in output, output
            assert 'Checksum verified.' in output, output
            unit_ready()
        elif CASE in ('tui', 'stopped'):
            no_unit()
            binary = BIN / ('herdr' if CASE == 'tui' else 'herdr-core')
            assert digest(binary) == before, 'installer changed an existing runtime'
            if CASE == 'tui':
                assert not (BIN / 'herdr-core').exists(), 'installer added core beside Herdr'
    if CASE in ('tui', 'stopped'):
        with step('Manage connections install' if CASE == 'tui' else 'Town setup-card Start and connect RPC'):
            with World() as world:
                initial = world.rpc('connections.list')
                profiles = world.setup()
                if CASE == 'tui':
                    assert profiles['connections'], 'existing Herdr TUI connection lost'
                    before_id = initial['default_connection_id']
                    after_id = profiles['default_connection_id']
                    # First persistence names the implicit startup profile "local".
                    # Its runtime/socket identity, rather than that temporary ID,
                    # must remain the default when core is added beside the TUI.
                    expected_id = 'local' if before_id == 'startup-default' else before_id
                    assert after_id == expected_id, 'adding core changed the TUI default'
                    before_profile = next(item for item in initial['connections'] if item['id'] == before_id)
                    after_profile = next(item for item in profiles['connections'] if item['id'] == after_id)
                    for field in ('type', 'control_socket_path', 'client_socket_path'):
                        assert before_profile.get(field) == after_profile.get(field), f'TUI default changed {field}'
                else:
                    world.core_only()
            unit_ready()
            assert digest(binary) == before, 'setup changed an existing runtime'
    elif CASE == 'upgrade':
        with step('upgrade preserves connections, default, core unit and connection readiness'):
            assert json.loads(REGISTRY.read_text()) == saved, 'upgrade changed saved connections/default'
            assert digest(UNIT) == unit_hash, 'upgrade changed existing core login unit'
            unit_ready()
            with World() as world:
                profiles = world.ready()
                assert profiles['default_connection_id'] == 'preserved', profiles
                assert any(item['id'] == 'preserved' for item in profiles['connections']), profiles
    # Fresh profile/topology checks run after reboot, so failures still exercise reboot.


if __name__ == '__main__':
    try:
        scenario()
    except Exception as failure:
        print(f'[{CASE}] FAIL {failure}', flush=True)
        traceback.print_exc(limit=8)
        sys.exit(1)
