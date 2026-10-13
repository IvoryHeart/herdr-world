# Captured lifecycle drain composition

## Intended behavior

Requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `server/src/connections/manager.ts`; accepted source PR #145. Runtime
administration and delayed transport share a captured lifecycle that must drain.

Allowed: cleanup finishes before or after transport; replacement/removal/shutdown
retire a connecting runtime; a current error retires through failed-runtime cleanup;
transport failure cleans up without publishing readiness. Forbidden: retired
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
Cleanup can fail. No new runtime is constructed during the scenario.

`runtime-drain.ts` calls the real manager and retains real task results. The status
observer records every readiness publication, including transient readiness later
overwritten by stop. Background construction is counted. Membership, generation,
status and absence of ready leases are checked at every boundary. Each scenario
fully drains before a new manager is created. Finally releases pending gates and
awaits all owned tasks.

## Properties, witnesses and negative controls

`safety` forbids any retired readiness and removal before both completion gates.
Real replay witnesses distinguish each operation, both completion orders and
failed drain. The model fault permits retired readiness; its counterexample must
fail `drain.ready.seen` against production. The compiled code fault bypasses the
two post-transport/background currency guards; generated replay must reject
retired background work/readiness through named observations. Generic exceptions
and cleanup failures cannot count as a fault kill.

The direct regression replays all 22 configurations: five administrative operations
by two completion orders by two cleanup outcomes, plus two failed-start cleanup
outcomes. It also verifies actual witnesses, rather than only executing the calls.

## Domain, environment and limitations

One controlled runtime and unstarted default peer per fresh scenario, generation
0–3, one replacement, bounded transport and cleanup promises. Seeded generated
paths contain multiple fully drained scenarios. TLC verifies finite safety; three
seeds each replay 100 paths of up to 25 transitions. The direct matrix covers the
entire 22-configuration domain. No temporal progress proof, transport protocol,
background-start failure, reconnect timing or same-ID reincarnation claim is made.
Those consumer/platform behaviors retain dedicated integration evidence.

## Evidence and promotion

Run maintained verification/typecheck commands and normal Bun tests. This closes
the explicitly stated delayed-transport administrative composition gap for the
bounded scenarios. The administration, lease and drain mappings still require
independent review together before promotion. Broader host order/bounds and actual
consumer composition remain pending; owner acceptance of the spike does not approve
this new model.
