# Captured lifecycle drain composition

## Intended behavior

Requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `server/src/connections/manager.ts`; accepted source PR #145. Runtime
administration and delayed transport/background startup share a captured lifecycle that must drain.

Allowed: cleanup finishes before or after transport; replacement/removal/shutdown
retire a connecting runtime; a current error retires through failed-runtime cleanup;
transport/background failure cleans up without publishing retired readiness. Forbidden: retired
transport starting background work, readiness being transiently restored, removal
finishing before captured work drains, or another runtime being constructed during
retirement. Best-effort removal/shutdown may finish despite cleanup failure;
ordinary stop/replacement must report it. Failed-runtime cleanup preserves its
original error state and failed start preserves the transport error.

## Model and implementation mapping

`runtime-drain.qnt` models fresh scenario incarnations rather than pretending
reset generation belongs to the same registered connection. `choose` constructs
one manager with a default peer and one controlled connecting runtime, generation 1.
`kind` chooses stop/replacement/removal/shutdown/current-error retirement/failed start.
`retire` begins the real operation; replacement generation is 3 and the others 2.
Failed-start rejection is already transport completion; its cleanup follows.
For the five administrative cases, `finishFirst` independently completes transport
or cleanup; `finishSecond` completes the other and awaits both captured tasks.
`backgroundWait` chooses a second asynchronous startup boundary. `enterBackground`
finishes transport while the current runtime enters a separately controlled
background promise. Retirement then occurs before background completion/failure;
`finishFirst`/`finishSecond` independently complete background or cleanup in either
order. Cleanup and background startup can each fail. No new runtime is constructed
during the scenario.

`runtime-drain.ts` calls the real manager and retains real task results. The status
observer records every readiness publication, including transient readiness later
overwritten by stop. Background construction is counted. Membership, generation,
status and absence of ready leases are checked at every boundary. Each scenario
fully drains before a new manager is created. Finally releases pending gates and
awaits all owned tasks.

## Properties, witnesses and negative controls

`safety` forbids any retired readiness and removal before both completion gates.
Real replay witnesses distinguish each operation, both completion orders and
failed drain, retirement during background startup and background failure. The model fault permits retired readiness; its counterexample must
fail `drain.ready.seen` against production. Two independent compiled controls each remove only one currency fence while
preserving the other. The post-transport control must reject forbidden background
work; the post-background control must fail `drain.ready.seen`. Their killing
traces/observations are separately recorded, so one compound kill cannot claim
coverage of both boundaries. Generic exceptions
and cleanup failures cannot count as a fault kill.

The direct regression replays all 62 configurations: five administrative operations
by two completion orders by two cleanup outcomes, plus two failed-start cleanup
outcomes, plus 40 delayed-background configurations (five operations, two
startup outcomes, two cleanup outcomes and two completion orders). It also verifies actual witnesses, rather than only executing the calls.

## Domain, environment and limitations

One controlled runtime and unstarted default peer per fresh scenario, generation
0–3, one replacement, bounded transport, background and cleanup promises. Seeded generated
paths contain multiple fully drained scenarios. TLC verifies finite safety; three
seeds each replay 100 paths of up to 25 transitions. The direct matrix covers the
entire 62-configuration domain. No temporal progress proof, transport protocol,
background protocol internals, reconnect timing or same-ID reincarnation claim is made.
Those consumer/platform behaviors retain dedicated integration evidence.

## Evidence and promotion

Run maintained verification/typecheck commands and normal Bun tests. This closes
the explicitly stated delayed-transport administrative composition gap for the
bounded scenarios. Review 5516249164 independently accepts administration, lease and drain composition within the documented bounds. Three-seed larger-bound and host-order checks and actual consumer/platform obligations remain required by the implemented local/protected gate. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
