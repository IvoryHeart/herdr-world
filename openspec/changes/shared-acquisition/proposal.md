## Why

Every visible browser re-lists its active host every 5 seconds
(`web/src/store/updates.ts:263-279`). Herdr events already drive most refreshes,
but this timer is the only refresh of several outputs:
- agent recency;
- the connection catalogue and browser count;
- git status and endpoint availability;
- changes whose Herdr event never arrived;
- retries after a failed fetch.

Deleting it would freeze "most active first", and would leave a replaced
runtime's events unadmitted. Each Desk also polls up to 16 screens every 4
seconds and 40 turn receipts every 20 seconds, per browser.

The architecture committee (2026-10-30, stage 2, item 14) asked for two things.
First, a written contract that keeps every output current without per-client
polling, approved by the owner once parity tests exist. Then shared
acquisition: the service acquires once and pushes recency, and watches Desk
screens and turns once per pane with reference counts.

## What Changes

- **The 5 s browser timer goes.** A browser re-lists a host only when something
  says it changed: a Herdr event or resynchronization, a World change notice,
  its own action, a catalogue change, reconnection, or the start of a hold. Its
  only timers retry a failure or belong to a re-list itself.
- **The poll moves into the service, once per host.** For each host that a
  visible browser holds, the service observes the same lists every 5 seconds,
  whatever the number of browsers. It sends a browser a change notice only when
  the result differs from what that browser last received. Idle hosts, and
  hosts that only print output, cost browsers nothing.
- **Recency is pushed.** The service reads session-file activity once per host
  and pushes changes. The browser keeps the latest time it has seen per agent
  session, so recency never moves backwards.
- **The connection catalogue and browser count are pushed** as a change notice,
  as World already does for watchlists, Desk marks, Board and profiles.
- **Desk screens and turns are watched once per pane** on the service, with
  reference counts from the browsers that show them.
- **Interest is explicit.**
  - A browser declares the hosts and Desk targets it shows while its page is
    visible, and releases them when hidden. A closed socket releases everything.
  - Interest is keyed by connection ID and runtime generation, plus pane and
    agent session for session-scoped targets.
  - Starting a hold re-lists that host once.
- **A capability gates it.** Without `world_focused_observation` in the
  service's hello, a browser keeps the 5 s timer.
- **Parity tests (T2)** cover recency, status, navigation, availability,
  layouts, completions, the catalogue and enriched workspace fields, on two open
  hosts. Tests that need the new behaviour are checked in as expected failures.

Spaces stays mounted. Look, controls and behaviour stay the same. The aggregate
World refresh (Town, Board and Desk models) and its 15 s fallback are
unchanged, and outside this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: focused observation without per-client polling, and
  shared acquisition with reference-counted interest.
- `world-surfaces`: bounded Desk observation reads each declared screen and
  receipt once on the service for every browser that shows it.

## Impact

- **Service:**
  - a focused observer and an interest registry beside
    `server/src/world/snapshot.ts`;
  - per-socket records of the lists each browser last received, kept where the
    connection RPC replies are sent (`server/src/index.ts`);
  - the activity cache behind `agent.list`
    (`server/src/agent/agent-activity.ts`);
  - catalogue change notices from the connection manager, the profile service
    and socket open and close;
  - Desk watches beside `server/src/world/desk-*`.
- **Browser:**
  - `web/src/store/updates.ts`: the timer, kept only without the capability;
  - `web/src/store.ts`: notices, recency and interest;
  - `web/src/agentOrder.ts`;
  - Inspector admission in `web/src/world/useWorldInspectorController.ts`;
  - `web/src/world/paneScreen.ts` and `web/src/world/handoffs.ts`: Desk timers
    replaced by declarations.
- **Evidence:**
  - T2 in `web/src/store/pollReplacement.test.ts`;
  - service tests with two browser sockets;
  - `verification/coverage.json` Q04, Q15 and Q24.
- **Wire:**
  - a new hello capability, `world_focused_observation`;
  - new bridge methods `world.focused.observe` and `world.desk.observe`;
  - new controls `world_connections_changed`, `world_focused_changed`,
    `world_agent_activity` and `world_desk_reads`.

  Existing methods and controls keep their meaning.

No new dependency.

## Owner decision

Committee decision 3: approve this contract. The approval rests on:
- the contract;
- the browser half of T2, which is in this change;
- a measured run on a disposable Herdr 0.9.3 session.

The service half of T2 needs the observer. It is written first in the
implementation, and must be green before task 3.1 removes the timer.

## Defaults chosen here (the owner may override any)

1. **The observation period stays 5 seconds,** today's bound for the active
   host.
2. **Hosts with an open Inspector count as held,** so their recency and
   enriched fields also refresh within 5 seconds. Today only each browser's
   active host is polled; other hosts refresh on events alone.
3. **A recency push carries the whole map for that host,** and only when a
   reading changed it. Each entry is a few identifiers and one time, far less
   than the four lists a poll fetches today. The browser keeps the latest time
   per session, so pushes need no order. Deltas can come with subscriptions v2.
4. **The active tab's layout is not re-read on a timer.** `layout.updated` is a
   lifecycle event, ordered and loss-signalled. On Herdr 0.9.3, `pane.layout`
   already returns the new layout when the event arrives (measured). Every
   re-list still reads the active tab's layout.
5. **A capability gates the change.** The service advertises
   `world_focused_observation`; without it, a browser keeps the 5 s timer. A
   newer page on an older service still refreshes, and the service can stop
   advertising it to fall back without a release.
