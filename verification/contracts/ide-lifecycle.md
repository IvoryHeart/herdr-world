# IDE server lifecycle

## Intended behavior

The [server lifecycle requirement](../../openspec/changes/world-code-view/specs/world-code-view/spec.md#requirement-bounded-server-lifecycle-and-resource-ownership)
lets IDE servers outlive World, its connections and its routes. Only the
person's Stop ends one. Every server that may run is listed, counted and
stoppable, including a start whose answer was lost. World keeps one server per
folder per host. A route reaches only the instance and connection generation it
was issued for. A retired route never reaches a server again, and nothing is
retargeted to another connection. The list is durable, so a restarted World lists
its servers before any host answers. A server whose SSH connection was removed
shows as unreachable, with the command that stops it on its host and Forget.

## Bounded model

`quint/ide-lifecycle.qnt` models two folders: one on World's computer (slot 0)
and one on an SSH host (slot 1). The limit allows one server at a time. Each
host keeps a claim directory per folder, the launch recorded in it, the begin
marks of unanswered starts, the leftovers of an interrupted Stop, the live
server trees and terminals re-parented out of them.

World runs one operation per folder and queues one more. It also keeps one list
per host and, for each folder, its entry, route and streams. A host script
advances in steps on its host. Its answer may be lost: the script then runs on
as a ghost or dies there. A World restart turns every unanswered script into a
ghost or a dead start.

The person can Open, Stop, Forget and stop by hand. The environment can
reconnect (a new generation), remove the SSH connection, disable or enable the
provider, drop the SSH forward, crash a server and restart World. Looks (lists)
run on reconcile and refresh.

These requested scenarios each map to model actions:

| Scenario | Model |
| --- | --- |
| start, lost start reply | `open`, `hostStep`, `lose` (ghost or dead) |
| attach route, retire/revoke route | `ready`, `request`, `forwardDrop`, release on every detach |
| Stop, Stop racing reattach | `stop` queued behind a reattach or start; `stopping` |
| reattach after World restart | `restart`, then `poll`; the entries survive as detached |
| SSH drop | `forwardDrop`, `reconnect` |
| two starts for one folder | ghost start racing a new start on one claim |
| re-parented terminal | `orph` set by the start; Stop ends every marked process |
| disable | `disable`, `enable` |
| connection removal, removed SSH host | `removeConn`, `stopByHand`, `forget` |
| server limit | `CAP = 1` with two folders |

`safety` combines these properties:

- `onePerFolder`: at most one server per folder per host, including an
  interrupted Stop's.
- `everyServerListed`: every server that may run is listed, so it is counted
  and stoppable. A lost start reply therefore counts as possibly running, and
  the durable list keeps it across restart.
- `stopEndsAll`: a Stop that finished ended every process of the server,
  re-parented ones too.
- `routesQualified`: every open stream belongs to the live route of its folder,
  under the attachment, launch and generation that route was issued for, and
  that generation is still admitted.
- `stopsFromStop`: World sends a stop script only for a person's Stop.

The removed-host case is enforced by guards. `stopByHand` and `forget` are
possible only while the entry is listed as unreachable, and Open and Stop are
refused there. The replay checks that the real service shows that entry as
unreachable, with the by-hand command.

The model has no browser. One World origin is a property of the route: the
browser reaches a server only through World's own IDE route. This is covered by
`server/src/ide/ide-route.test.ts` and `server/src/ide/proxy.test.ts`, not by
the model.

## Checks

The `ide-lifecycle` case of `bun run verification:gate` runs these checks:

1. TLC checks `safety` exhaustively on the default model, with both folders,
   one fault and four clicks per behaviour.
2. TLC checks the deep variant: the SSH folder only, with two faults.
3. Three seeds each export 100 traces of 30 steps from a sampled variant (four
   faults, six clicks). Each trace is replayed through World's real
   `IdeService` and `IdeInstances`, against a fake host that answers each host
   script as the trace does. After every step the replay compares each entry's
   state, Stop flag, pending script kinds, pending lists and streams with the
   model. Every seed must replay starts, stops, lost starts, pending lists,
   streams, connection removal, reconnects and a restart.
4. Each of eight flags turns one design decision back and must give a
   counterexample in the control variant: the SSH folder only, three faults
   and five clicks. That variant is too large to check in full within the
   gate's per-command bound; it is checked in full by hand when the model
   changes: on 2026-11-22 it gave no violation over 3,278,636 distinct
   states in under three minutes on a busy machine.
   - routes kept open;
   - a lost start counted as failed;
   - Stop ending only the tree;
   - the old list;
   - the old Stop;
   - no voiding;
   - the old start epoch;
   - the old queue.

Checks 1, 2 and 4 are independent. In CI the model owns a two-CPU shard and
runs them two at a time, longest first; local runs keep one at a time. Every
check, bound and expected result is the same either way.

## Counterexamples found and fixed

The model found two faults in the first implementation. Each is kept as a
replay witness in `ideCounterexamples`.

- **queued-open**: an Open queued behind a Stop ran after the SSH connection
  was removed. It started a server on the removed host after the person
  stopped the old one by hand, and Forget then hid it. Fix: a queued Open or
  reattach checks that its connection, generation and provider are still the
  ones it was asked under (`IdeStaleError`).
- **start-epoch**: a list sent before a start began answered "absent" after
  the start's answer was lost, and deleted the entry while its server ran.
  Fix: a start takes a new epoch, so a list sent earlier can't forget it.

For each witness, the gate runs these checks:

- It drives the model through the recorded steps, with the flag that restores
  the old design.
- It requires the fixed service to depart from the trace.
- It requires the service with that fix taken out to follow the trace to the
  violation. The faults `ide-queue` and `ide-start-epoch` take the fixes out in
  `quint/implementationMutation.ts`.

The first design also left an interrupted Stop and an overtaken start invisible.
`OLD_STOP`, `OLD_LIST` and `NO_VOID` keep those as model controls. The fixes
are:

- the stop leftovers listed as pending;
- begin marks voided by a Stop or a look;
- the `stopping` state on attach.

`server/src/ide/host.test.ts` covers them with real `sh` scripts.

A start voids no other start's begin mark. A first version did, and two
Worlds opening one folder at once could then fail the older start, or in a
narrow window launch neither, against the spec's "the other start reattaches
to it". Two starts meet at the folder's claim instead; `host.test.ts` checks
both a simultaneous pair and a newer start overtaking one waiting to claim.

## Assumptions and residuals

- The host side comes from the model. The replay checks World's decisions
  against the model's host answers. The real scripts' claim, begin mark, void
  and leftover handling are tested with real `sh` in `host.test.ts`.
- One step in the model can be two steps on the host:
  - Launch and pid recording are one model step.
  - Creating the begin mark is the start's first step.
  - Claim and consume are atomic.
  A void that lands between the begin check and `mkdir` is safe, because
  `mkdir` claims at most once.
- Not modelled: the server stopping on its own after a timeout (`stillRuns`),
  timeouts and downloads. The replay fixes the clock.
- The bounds are those above. No claim is made beyond them, or for more than
  one queued operation per folder: a look whose answer would queue a reattach
  behind an operation already queued is not taken in the model.
