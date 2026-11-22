"""Run only in a disposable native user account. Never use the owner's services."""
import json
from pathlib import Path
import sys
from assets import executable, published, tools
from contract import PAIRS, Walk, digest, print_failure, validate_receipt
from journeys import Fixture, check_signed_out, default_connection, room, launch, input_reaches, listing, chat_reply, upgrade
from listing_batch import listing_batch
from processes import Telemetry, run
from service import services, service_guard
from validate import receipt_digest


def negative_control(binary, fixture):
    with fixture, fixture.world(binary) as world:
        connection = world.ready('herdr')
        workspace = room(world, connection, 'herdr')
        try:
            launch(world, fixture, connection, 'herdr', 'claude', workspace, quick=True)
        except AssertionError as error:
            assert str(error) == 'agent never started', 'v0.3.5 failed before the agent-start boundary'
            pane = world.last_launch.get('pane_id')
            assert pane, 'v0.3.5 did not create a launch terminal'
            screen = run([fixture.tools / 'tui/herdr', '--session', fixture.env['HC_SESSION'],
                          'pane', 'read', pane, '--source', 'recent', '--lines', '40'], fixture.env).stdout
            assert 'WALK_CONTINUATION>' in screen, 'v0.3.5 failure did not reproduce shell command truncation'
            print('PROVED v0.3.5: New agent starts: TUI quick Claude: agent never started (shell continuation prompt)', flush=True)
            return dict(tag='v0.3.5', status='expected-failure',
                        journey='New agent starts: TUI quick Claude', reason='agent never started', binary_sha256=digest(binary))
        raise AssertionError('v0.3.5 unexpectedly started the agent; negative control did not detect #984')


def main(config):
    root = Path(config['root'])
    service_guard(Path.home(), config['disposable'])
    archive = Path(config['archive'])
    candidate = executable(archive, root / 'herdr-world')
    assert run([candidate, '--version']).stdout.strip() == 'herdr-world ' + config['version'], 'release binary version mismatch'
    walk = Walk('signed-in' if config['signed_home'] else 'ci', config['commit'], config['version'],
                archive, candidate, config['baseline'])
    report_path = Path(config['report'])
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.with_name('listing-failure.json').unlink(missing_ok=True)
    report_path.with_name('listing-batch.json').unlink(missing_ok=True)
    try:
        tool_dir = tools(root, config)
        baseline = published(root, config['baseline'], config['platform'])
        telemetry = Telemetry(root / 'events.sock')
        try:
            if config['platform'] == 'linux-x64':
                old = published(root, 'v0.3.5', config['platform'])
                walk.report['negative_control'] = negative_control(old, Fixture(root / 'negative', tool_dir, telemetry, core=False))
            # Run this first so the old published build fails at the escaped
            # first action rather than at its independent core-only defect.
            with walk.journey('New agent starts: TUI quick Claude'), Fixture(root / 'quick', tool_dir, telemetry, core=False) as fixture, fixture.world(candidate) as world:
                check_signed_out(fixture)
                connection = world.ready('herdr')
                launch(world, fixture, connection, 'herdr', 'claude', room(world, connection, 'herdr'), quick=True)
            for name, tui, core, runtime in [('Fresh World: core only', False, True, 'herdr-core'),
                                              ('Fresh World: TUI only', True, False, 'herdr')]:
                with walk.journey(name), Fixture(root / runtime, tool_dir, telemetry, tui, core) as fixture:
                    check_signed_out(fixture)
                    with fixture.world(candidate) as world:
                        default_connection(world, runtime)
                        assert len(world.snapshot()) == 1, 'fresh installation added an absent runtime'
            with Fixture(root / 'both', tool_dir, telemetry) as fixture, fixture.world(candidate) as world:
                fixture.failure_artifact = report_path.with_name('listing-failure.json')
                fixture.failure_context = {key: walk.report[key] for key in
                                           ('commit', 'platform', 'archive_sha256', 'binary_sha256')}
                with walk.journey('Fresh World: both'):
                    check_signed_out(fixture)
                    tui = default_connection(world, 'herdr')
                    core = fixture.connect_core(world)
                connections = {'herdr': tui, 'herdr-core': core}
                rooms = {runtime: room(world, connection, runtime) for runtime, connection in connections.items()}
                agents = []
                for runtime, kind in PAIRS:
                    with walk.journey(f'New agent starts: {runtime}/{kind}'):
                        agents.append(launch(world, fixture, connections[runtime], runtime, kind, rooms[runtime]))
                for agent in agents:
                    with walk.journey(f'Prompt reaches input: {agent["runtime"]}/{agent["kind"]}'):
                        input_reaches(world, fixture, agent)
                with walk.journey('Every runtime is listed'):
                    listing(world, agents, fixture)
            with walk.journey('Previous release upgrade'), Fixture(root / 'upgrade', tool_dir, telemetry) as fixture:
                upgrade(walk, candidate, baseline, fixture)
            services(walk, candidate, baseline, root, config['disposable'])
            if config['signed_home']:
                with Fixture(root / 'signed', tool_dir, telemetry, signed_home=Path(config['signed_home'])) as fixture, fixture.world(candidate) as world:
                    connections = {'herdr': world.ready('herdr'), 'herdr-core': fixture.connect_core(world)}
                    rooms = {runtime: room(world, connection, runtime) for runtime, connection in connections.items()}
                    for runtime, kind in PAIRS:
                        with walk.journey(f'Prompt and Chat reply: {runtime}/{kind}'):
                            agent = launch(world, fixture, connections[runtime], runtime, kind, rooms[runtime])
                            chat_reply(world, fixture, agent)
            listing_batch(config, candidate, tool_dir, telemetry,
                          {key: walk.report[key] for key in
                           ('commit', 'platform', 'archive_sha256', 'binary_sha256')})
        finally:
            telemetry.close()
    finally:
        walk.write(report_path)
    validate_receipt(walk.report, config['commit'])
    print('PASS release walk: every required journey completed', flush=True)
    if config['signed_home']:
        print('Release walk signed-in receipt: ' + receipt_digest(walk.report), flush=True)


if __name__ == '__main__':
    try:
        main(json.loads(Path(sys.argv[1]).read_text()))
    except Exception as error:
        print_failure('release walk', error)
        sys.exit(1)
