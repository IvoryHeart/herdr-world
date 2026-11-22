import base64
import contextlib
import json
import os
from pathlib import Path
import secrets
import shutil
from assets import environment
from contract import HARNESS_VERSIONS
from diagnostics import capture_listing
from processes import background, run
from world import World


class Fixture:
    def __init__(self, root, tools, telemetry, tui=True, core=True, signed_home=None):
        self.root = root
        self.tools = tools
        self.telemetry = telemetry
        self.tui = tui
        self.core = core
        self.env = environment(root, tools, 'walk-' + secrets.token_hex(6), tui,
                               telemetry.path, signed_home, core=core)

    def __enter__(self):
        self.stack = contextlib.ExitStack()
        try:
            if not self.tui:
                assert not shutil.which('herdr', path=self.env['PATH']), 'core-only installation unexpectedly resolves a TUI executable'
            if not self.core:
                assert not shutil.which('herdr-core', path=self.env['PATH']), 'TUI-only installation unexpectedly resolves a core executable'
            for kind in ('claude', 'codex'):
                run([self.tools / 'tui/herdr', '--session', self.env['HC_SESSION'],
                     'integration', 'install', kind], self.env)
            if self.tui:
                self.stack.enter_context(background([self.tools / 'tui/herdr', '--session',
                                                     self.env['HC_SESSION'], 'server'], self.env, self.root))
            if self.core:
                run([self.tools / 'core/herdr-core', 'server', 'start'], self.env)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        try:
            if self.core:
                run([self.tools / 'core/herdr-core', 'server', 'stop'], self.env)
            if self.tui:
                run([self.tools / 'tui/herdr', '--session', self.env['HC_SESSION'], 'server', 'stop'], self.env)
        finally:
            self.stack.close()

    def world(self, binary, cookie=None):
        return World(binary, self.root, self.env, cookie)

    def connect_core(self, world):
        world.rpc('connections.create', {'profile': dict(id='walk-core', label='Release walk core',
                  type='local', runtime='herdr-core', core_session=self.env['HC_SESSION'],
                  core_state_dir='', auto_connect=True)})
        return world.ready('herdr-core')


def check_signed_out(fixture):
    for kind, args in [('claude', ['auth', 'status', '--json']), ('codex', ['login', 'status'])]:
        version = run([fixture.tools / ('bin/' + kind), '--version'], fixture.env).stdout.strip()
        expected = HARNESS_VERSIONS[kind] + ' (Claude Code)' if kind == 'claude' else 'codex-cli ' + HARNESS_VERSIONS[kind]
        assert version == expected, 'installed harness version differs from the pinned executable'
        result = run([fixture.tools / ('bin/' + kind), *args], fixture.env, check=False)
        if kind == 'claude':
            status = json.loads(result.stdout)
            assert status.get('loggedIn') is False, 'Claude is signed in during the signed-out launch walk'
        else:
            assert result.returncode != 0 and 'not logged in' in (result.stdout + result.stderr).lower(), 'Codex is signed in during the signed-out launch walk'


def default_connection(world, runtime):
    connection = world.ready(runtime)
    # Core's observation manager has no default of its own. The browser
    # catalogue names the global selection across both runtime managers.
    catalogue = world.rpc('connections.list')
    assert catalogue.get('default_connection_id') == connection['connection_id'], 'World did not select the expected default runtime'
    return connection


def room(world, connection, runtime):
    if runtime == 'herdr-core':
        return world.rpc('world.core.room.create', dict(connection_id=connection['connection_id'],
                         connection_generation=connection['generation'], label='Release walk core room'))['workspace_id']
    return world.rpc('workspace.create', {'label': 'Release walk TUI room', 'cwd': str(world.home)}, connection)['workspace']['workspace_id']


def profile(world, kind, marker):
    document = world.rpc('world.profiles.get')
    value = dict(document['profiles'][0])
    value.update(id='walk-' + kind, name='Walk ' + kind, harness=kind,
                 model='sonnet' if kind == 'claude' else '', effort='' if kind == 'claude' else 'low',
                 permission='plan' if kind == 'claude' else 'on-request', tools=['Read'], skills=[],
                 role=f'Release walk: quoted "argument", apostrophe\'s value.\nEnd: {marker}',
                 brief='', send_brief=False, home_room='', color=None, chime=None, town_master=False)
    world.rpc('world.profiles.save', {'profile': value})
    return value


def complete_arguments(invocation, kind, value, quick):
    argv = invocation['argv']
    if not quick:
        if kind == 'claude':
            definitions = json.loads(argv[argv.index('--agents') + 1])
            definition = next(iter(definitions.values()))
            assert definition['prompt'] == value['role'], 'Claude received an incomplete role argument'
            assert definition['model'] == value['model'] and definition['tools'] == value['tools'], 'Claude received different model or tools'
            assert argv[argv.index('--permission-mode') + 1] == value['permission'], 'Claude received different permissions'
        else:
            expected = ['-a', value['permission'], '-s', 'read-only', '-c', 'model_reasoning_effort="low"',
                        '-c', 'developer_instructions=' + json.dumps(value['role'], ensure_ascii=False, separators=(',', ':'))]
            assert argv == expected, 'Codex received incomplete arguments or settings'
    if kind == 'claude':
        settings = invocation['settings']
        # Core does not add the TUI usage tap; TUI quick/profile launches must.
        if settings:
            assert all(isinstance(item.get('statusLine', {}).get('command'), str) and
                       item['statusLine']['command'] for item in settings), 'Claude received incomplete status-line settings'


def pane_for(world, connection, launched, require_classified=False):
    classified = ('idle', 'working', 'blocked', 'done')
    def find(rows):
        current = next((row for row in rows if row['connection_id'] == connection['connection_id']), None)
        assert current and current['generation'] == connection['generation'], 'launch runtime generation changed'
        if current.get('stale') or not current.get('snapshot'):
            return None
        return next((pane for pane in current['snapshot']['panes']
                     if pane['terminal_id'] == launched['terminal_id'] and pane.get('agent') and
                     (not require_classified or pane.get('agent_status') in classified)), None)
    reason = ('World never showed a classified agent status' if require_classified
              else 'World never showed the launched agent')
    rows = world.observe(world.snapshot, lambda rows: bool(find(rows)), reason)
    pane = find(rows)
    # Signed-out onboarding has emitted no activity reports. The documented
    # read-model status is unknown, not a fabricated idle or blocked state.
    assert pane.get('agent_status') in (*classified, 'unknown'), 'World showed the agent without a status'
    return pane


def launch(world, fixture, connection, runtime, kind, workspace, quick=False):
    marker = secrets.token_hex(12)
    value = None if quick else profile(world, kind, marker)
    start = len(fixture.telemetry.items)
    params = dict(workspace_id=workspace, kind=kind, label='Walk ' + kind + ' ' + marker[:6], text='')
    if value:
        params['profile_id'] = value['id']
    if runtime == 'herdr-core':
        params.update(connection_id=connection['connection_id'], connection_generation=connection['generation'])
        result = world.rpc('world.core.launch', params)
    else:
        result = world.rpc('launcher.start', params, connection)
    world.last_launch = result
    _, invocation = fixture.telemetry.wait(lambda item: item['event'] == 'invoked' and item['kind'] == kind,
                                          start, timeout=15, reason='agent never started')
    complete_arguments(invocation, kind, value, quick)
    if runtime == 'herdr' and kind == 'claude':
        assert invocation['settings'], 'Claude usage settings never reached the terminal'
    fixture.telemetry.wait(lambda item: item['event'] == 'first-screen' and item['identity'] == invocation['identity'],
                           start, reason='real harness never displayed its first screen')
    assert result.get('terminal_id'), 'World did not identify the launched terminal'
    pane = pane_for(world, connection, result)
    return dict(result=result, workspace_id=workspace, invocation=invocation, pane=pane, connection=connection,
                runtime=runtime, kind=kind, marker=marker)


def input_reaches(world, fixture, agent):
    token = 'WALK_INPUT_' + agent['marker']
    pane = agent['pane']
    connection = agent['connection']
    if agent['runtime'] == 'herdr-core':
        stream = 'walk-' + agent['marker']
        world.rpc('world.core.watch', dict(connection_id=connection['connection_id'],
                  generation=connection['generation'], address=pane['terminal_id'], stream=stream))
        try:
            result = world.rpc('world.core.input', dict(stream=stream, data=base64.b64encode((token + '\r').encode()).decode(), cols=120, rows=40))
            assert result['sent'], 'World refused the prompt input'
        finally:
            world.rpc('world.core.unwatch', {'stream': stream})
    else:
        world.rpc('pane.send_input', dict(pane_id=pane['pane_id'], text=token, keys=['enter']), connection)
    fixture.telemetry.wait(lambda item: item['event'] == 'input' and
                           item['identity'] == agent['invocation']['identity'] and token in item['text'],
                           reason='prompt text never reached the real harness input')


def listing(world, agents, fixture=None):
    reason = 'aggregate/CLI listing never converged'
    last_failure = 'listing was not observed'
    last_rows = []

    def read():
        rows = world.snapshot()
        cli = json.loads(run([world.binary, 'ls', '--json'], {**world.env, 'HERDR_WORLD_URL': world.base}).stdout)
        result = cli.get('result') if isinstance(cli, dict) else cli
        # Current CLI results group runtimes by host and retain topology under
        # connections. Previous releases returned the connection array itself.
        entries = result.get('connections') if isinstance(result, dict) else result
        return rows, entries

    def complete(observation):
        nonlocal last_failure, last_rows
        last_rows = observation[0]
        try:
            assert_listing(*observation, agents)
            return True
        except AssertionError as error:
            last_failure = str(error)
            return False

    # Terminal input invalidates asynchronous topology. The CLI takes a
    # separate snapshot; wait for pushed changes just as launch detection does.
    # Every attempt must contain all agents, never accumulated partial passes.
    try:
        world.observe(read, complete, reason)
    except Exception as error:
        if fixture is not None:
            try:
                listing_diagnostics(last_rows, agents, fixture)
            except Exception:
                print('Listing diagnostic: unavailable', flush=True)
            try:
                capture_listing(last_rows, agents, fixture)
            except Exception:
                print('Listing failure artifact: unavailable', flush=True)
        if isinstance(error, AssertionError) and str(error) == reason:
            raise AssertionError(f'{reason}: {last_failure}') from None
        raise


def listing_diagnostics(rows, agents, fixture):
    """One failure-only read of the isolated core; never emit argv or paths."""
    for agent in agents:
        connection = next((row for row in rows if row['connection_id'] == agent['connection']['connection_id']), None)
        snapshot = (connection or {}).get('snapshot') or {}
        pane = next((item for item in snapshot.get('panes', [])
                     if item['pane_id'] == agent['result']['pane_id']), None)
        evidence = dict(runtime=agent['runtime'], harness=agent['kind'],
                        generation_matches=bool(connection and connection['generation'] == agent['connection']['generation']),
                        pane_present=pane is not None,
                        room_matches=bool(pane and pane.get('workspace_id') == agent['workspace_id']),
                        terminal_matches=bool(pane and pane.get('terminal_id') == agent['result']['terminal_id']),
                        harness_matches=bool(pane and pane.get('agent') == agent['kind']))
        if agent['runtime'] == 'herdr-core' and evidence['generation_matches']:
            try:
                result = run([fixture.tools / 'core/herdr-core', 'get', '--json', agent['result']['terminal_id']],
                             fixture.env, check=False, timeout=10)
                assert result.returncode == 0
                record = json.loads(result.stdout)
                state = record.get('state')
                foreground = record.get('foreground')
                code = record.get('exit_code')
                evidence.update(native_state=state if state in ('live', 'finished') else 'other',
                                native_exit_code=code if isinstance(code, int) else None,
                                native_foreground_present=isinstance(foreground, dict),
                                native_foreground_name_matches=bool(isinstance(foreground, dict) and
                                    foreground.get('name') == agent['kind']))
            except Exception:
                evidence['native_read'] = 'unavailable'
        print('Listing diagnostic: ' + json.dumps(evidence, sort_keys=True), flush=True)


def assert_listing(rows, entries, agents):
    assert isinstance(entries, list), 'herdr-world ls did not return runtime listings'
    for agent in agents:
        context = f'{agent["runtime"]}/{agent["kind"]}: '
        connection = next((row for row in rows if row['connection_id'] == agent['connection']['connection_id']), None)
        assert connection, context + 'aggregate omitted a connected runtime'
        assert connection['generation'] == agent['connection']['generation'], context + 'aggregate runtime generation changed'
        assert not connection['stale'] and connection['snapshot'], context + 'aggregate returned stale runtime topology'
        snapshot = connection['snapshot']
        # TUI launch returns pane/terminal IDs, not a workspace ID. Keep the
        # requested room and verify its binding through the actual topology.
        assert any(item['workspace_id'] == agent['workspace_id'] for item in snapshot['workspaces']), context + 'aggregate omitted a runtime room'
        assert any(item['pane_id'] == agent['result']['pane_id'] and
                   item['terminal_id'] == agent['result']['terminal_id'] and
                   item['workspace_id'] == agent['workspace_id'] and
                   item.get('agent') == agent['kind'] for item in snapshot['panes']), context + 'aggregate omitted the launched agent from its runtime room'
        assert any(item['pane_id'] == agent['result']['pane_id'] for item in snapshot['agents']), context + 'aggregate omitted a runtime agent'
        entry = next((item for item in entries if item['connection_id'] == connection['connection_id']), None)
        assert entry and entry['current'], context + 'herdr-world ls omitted a connected runtime'
        workspace = next((item for item in entry['workspaces'] if item['workspace_id'] == agent['workspace_id']), None)
        assert workspace, context + 'herdr-world ls omitted a runtime room'
        panes = [pane for tab in workspace['tabs'] for pane in tab['panes']]
        found = next((pane for pane in panes if pane['pane_id'] == agent['result']['pane_id']), None)
        assert found and found.get('agent') == agent['kind'], context + 'herdr-world ls omitted a runtime agent'


def chat_reply(world, fixture, agent):
    connection, pane = agent['connection'], agent['pane']
    params = dict(pane_id=pane['pane_id'])
    if agent['runtime'] == 'herdr-core':
        params['recipient'] = pane['core_recipient']
    world.rpc('agent_conversation.watch', {'pane_id': pane['pane_id']}, connection)
    read = lambda: world.rpc('agent_conversation.get', params, connection)
    conversation = world.observe(read,
                                 lambda item: bool(item.get('session_fingerprint')) or bool((item.get('pending_prompt') or {}).get('trust')),
                                 'Chat never bound the signed-in harness session')
    trust = conversation.get('pending_prompt') or {}
    if trust.get('trust'):
        world.rpc('agent_conversation.trust', {**params, 'prompt_fingerprint': trust['fingerprint'], 'choice': 'confirm'}, connection)
        conversation = world.observe(read, lambda item: bool(item.get('session_fingerprint')),
                                     'Chat never bound the trusted harness session')
    token = 'WALK_REPLY_' + secrets.token_hex(12)
    sent = world.rpc('agent_conversation.send', {**params, 'session_fingerprint': conversation['session_fingerprint'],
                     'text': f'Reply with exactly {token}. Do not use any tools.'}, connection)
    assert sent.get('status') in ('sent', 'pending'), 'Chat refused the signed-in prompt'
    reply = world.observe(lambda: world.rpc('agent_conversation.get', params, connection),
                          lambda item: any(message['role'] == 'assistant' and token in message['text']
                                           for message in item.get('messages', [])),
                          'model reply never became readable in Chat', timeout=180)
    assert any(message['role'] == 'user' and token in message['text'] for message in reply['messages']), 'Chat lost the sent prompt'
    pane_for(world, connection, agent['result'], require_classified=True)


def install(source, binary):
    """Put a release at the binary path as a new file, like an installer does.

    Copying over the previous binary rewrites the same inode. macOS caches a
    signed executable's code signature per vnode, so the new contents can be
    killed at exec before printing anything (darwin-x64 walk, #1246).
    """
    staged = binary.with_name(binary.name + '.new')
    shutil.copy2(source, staged)
    os.replace(staged, binary)


def upgrade(walk, candidate, baseline, fixture):
    binary = fixture.root / 'upgrade-world'
    install(baseline, binary)
    settings = fixture.root / 'world/settings.json'
    settings.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    settings.write_text(json.dumps(dict(version=1, title_suffix='Release walk preserved', repositories={},
                                       workspace_auto_sync={}, custom={'releaseWalk': True})))
    settings.chmod(0o600)
    with fixture.world(binary) as world:
        tui = world.ready('herdr')
        catalogue = world.rpc('connections.list')
        startup = next((item for item in catalogue['connections'] if item['id'] == tui['connection_id']), None)
        assert startup and startup['type'] == 'local', 'upgrade did not identify its isolated TUI connection'
        # HERDR_SESSION pins a read-only startup connection. Saving another
        # profile does not migrate it; explicitly save its observed endpoints.
        world.rpc('connections.create', {'profile': dict(id='walk-tui', label='Release walk TUI', type='local',
                  control_socket_path=startup['control_socket_path'], client_socket_path=startup['client_socket_path'],
                  auto_connect=True)})
        fixture.connect_core(world)
        cookie = world.cookie
    # Restart the baseline using both saved profiles: HERDR_SESSION pins a process
    # default and would refuse changing it through the connection selector.
    env = {key: value for key, value in fixture.env.items() if key != 'HERDR_SESSION'}
    with World(binary, fixture.root, env, cookie) as world:
        world.ready('herdr')
        world.ready('herdr-core')
        world.rpc('connections.set_default', {'id': 'walk-core'})
        cookie = world.cookie
        saved = json.loads((settings.parent / 'connections.json').read_text())
    install(candidate, binary)
    with World(binary, fixture.root, env, cookie) as world:
        assert world.request('/api/login', {'password': 'wrong-synthetic-password'}).status in (401, 403), 'upgrade accepted the wrong sign-in password'
        invalid_cookie = world.cookie.split('=', 1)[0] + '=invalid-synthetic-session'
        assert world.request('/', cookie=invalid_cookie).status in (401, 403), 'upgrade accepted an invalid browser session'
        default_connection(world, 'herdr-core')
        world.ready('herdr')
        upgraded = json.loads((settings.parent / 'connections.json').read_text())
        # Host discovery adds catalogue metadata to older registries. Every
        # previously saved field, including profiles/default, must stay exact.
        if 'hosts' not in saved:
            upgraded.pop('hosts', None)
        assert upgraded == saved, 'upgrade changed the saved connection profiles'
        kept = json.loads(settings.read_text())
        assert kept['title_suffix'] == 'Release walk preserved' and kept['custom']['releaseWalk'], 'upgrade lost settings'
