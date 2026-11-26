"""Opt-in repeated listing evidence; a failure stops the batch, never retries."""
import json
from pathlib import Path
from contract import PAIRS
from codex_update import check_codex_update_policy
from journeys import Fixture, check_signed_out, default_connection, room, launch, input_reaches, listing


def listing_batch(config, candidate, tools, telemetry, context):
    count = config.get('listing_repetitions', 0)
    if not count:
        return
    assert type(count) is int and 1 <= count <= 100, 'Invalid listing repetition count'
    path = Path(config['report']).with_name('listing-batch.json')
    report = dict(schema=1, **context, requested=count, runs=[], status='fail',
                  cached_codex_update='999.0.0')
    try:
        check_codex_update_policy(Path(config['root']) / 'update-control', tools)
        report['update_policy_control'] = 'pass'
        for index in range(1, count + 1):
            item = dict(index=index, status='fail')
            report['runs'].append(item)
            print(f'RUN listing repetition {index}/{count}', flush=True)
            with Fixture(Path(config['root']) / f'repeat-{index}', tools, telemetry) as fixture:
                # Force the formerly timing-dependent update popup on every
                # repetition if the pinned fixture update policy regresses.
                (Path(fixture.env['CODEX_HOME']) / 'version.json').write_text(json.dumps(dict(
                    latest_version='999.0.0', last_checked_at='2099-01-01T00:00:00Z', dismissed_version=None)))
                fixture.failure_artifact = path.with_name('listing-failure.json')
                fixture.failure_context = context
                check_signed_out(fixture)
                with fixture.world(candidate) as world:
                    connections = {'herdr': default_connection(world, 'herdr'),
                                   'herdr-core': fixture.connect_core(world)}
                    rooms = {runtime: room(world, connection, runtime)
                             for runtime, connection in connections.items()}
                    agents = [launch(world, fixture, connections[runtime], runtime, kind, rooms[runtime])
                              for runtime, kind in PAIRS]
                    for agent in agents:
                        input_reaches(world, fixture, agent)
                    listing(world, agents, fixture)
            item['status'] = 'pass'
            print(f'PASS listing repetition {index}/{count}', flush=True)
        report['status'] = 'pass'
    finally:
        path.write_text(json.dumps(report, indent=2) + '\n')
