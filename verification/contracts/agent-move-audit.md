# Audit of the open agent-move candidate

## Frozen scope and intended requirements

PR [#990](https://github.com/IvoryHeart/herdr-world/pull/990), still open during
this audit, was inspected at `df398319a031f840668f7e6ea0dff765c5764c11`.
Its own `world-surfaces` delta requires quit-before-resume, at most one running
conversation, exact session and launch policy, and preservation or an explicit
loss report for identity, pins, appearance, strings and parent/child links.
Destination readiness precedes source-terminal closure; confirmed destination
closure precedes rollback. Busy/ambiguous evidence refuses before source quit.
The feature and its requirement are not imported into current delivered specs.

## Why the existing exhaustive check is sufficient for its controller

`server/src/agent/move/handoff.ts` awaits each port serially. For one admitted
conversation there are no overlapping internal port completions to permute.
The candidate's `handoff.test.ts` enumerates all 576 combinations of quit
(4), resume (4), destination stop (3), rollback (3), metadata (2) and old terminal
close (2) outcomes, distinguishing before-effect failure from lost acknowledgement.
Each boundary checks live source plus destination at most one, with confirmed
destination closure before rollback. Separate tests cover both pre-quit refusals
and exact call order. The audit ran those frozen source files in ignored files
inside this worktree: nine tests and 2,650 assertions passed. The matrix itself
took about 4 ms. A second model of these same serial outcomes adds no schedule.

Service admission has both a source-address lock and a harness/session identity
lock, held across the controller and released in `finally`. After the awaited
session read, identity check-and-insert is synchronous. Thus concurrent requests
in one service cannot both enter that conversation's controller. This reasoning
does not establish a lock shared across independent Worlds or external clients.

## Consumer boundaries and remaining acceptance

The candidate's `verification/contracts/agent-moves.md` maps the following real
consumers; the 576-controller run does not claim to have run them here:

- `server/src/agent/move/{session,processes,runtime}.test.ts`: exact argv,
  transcript, process/background admission, native readiness and generation fences.
- `server/src/world/{agent-rehome,agent-reattach}.test.ts`: reopened persistent
  Board details, shared desks, current edits, replaced occupants and superseded
  native parent stamps.
- `web/src/world/{agentMove.test.ts,AgentMove.browser.test.ts}`: single outstanding
  request, current destination, phone controls and refusal fixture.

Q57 remains pending merge and review of that exact consumer mapping. Current
runtime-leases, core and binding consumers establish only their existing shared
contracts. The candidate reports uncertain interruption rather than claiming
cross-host crash atomicity or resuming a competitor. Service crash/restart loses
its in-memory move lock; automatic recovery is not promised. Independent Worlds,
external user input, real harness startup/login and host outages remain explicit
platform/concurrency limits. A durable cross-service handoff would require a new
ownership/recovery contract and model; it is outside #990's current contract.
