## Why

Every visible browser re-lists its active host every 5 seconds
(`web/src/store/updates.ts:263-279`). Herdr events already drive most refreshes,
but this timer is the only refresh of several outputs: agent recency, the
connection catalogue and browser count, git status, endpoint availability and
changes whose Herdr event never arrived. Deleting it would freeze "most active
first" and leave a replaced runtime's events unadmitted. Each Desk also polls up
to 16 screens every 4 seconds and 40 turn receipts every 20 seconds, per browser.

The architecture committee (2026-10-30, stage 2, item 14) asked for a written
contract that keeps every output current without per-client polling, approved
by the owner once parity tests exist, and then shared acquisition: the service
acquires once and pushes recency, and watches Desk screens and turns once per
pane with reference counts.

## What Changes

- **The 5 s browser timer goes.** A browser re-lists a host only when something
  says it changed: a Herdr event or resynchronization, a World change notice, its
  own action, a catalogue change, reconnection, or the page becoming visible.
- **The poll moves into the service, once per host.** For each host that a
  visible browser holds, the service observes the same lists every 5 seconds,
  whatever the number of browsers, and sends a change notice only when the
  result differs. Idle hosts cost browsers nothing.
- **Recency is pushed.** The service reads session-file activity once per host
  and pushes changed values. The browser keeps one recency source.
- **The connection catalogue and browser count are pushed** as a change notice,
  as World already does for watchlists, Desk marks, Board and profiles.
- **Desk screens and turns are watched once per pane** on the service, with
  reference counts from the browsers that show them.
- **Interest is explicit.** A browser declares the hosts and Desk targets it
  shows while its page is visible and releases them when hidden. A closed socket
  releases everything. Interest is keyed by connection ID and runtime
  generation, plus pane and agent session for session-scoped targets.
- **Parity tests (T2)** cover recency, status, navigation, availability, layouts,
  completions, the catalogue and enriched workspace fields, on two open hosts.
  Tests that need the new behaviour are checked in as expected failures.

Spaces stays mounted. Look, controls and behaviour stay the same. The aggregate
World refresh (Town, Board and Desk models) is unchanged; subscriptions v1 and v2
in `world-protocol-identity` replace its fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: focused observation without per-client polling, and
  shared acquisition with reference-counted interest.
- `world-surfaces`: bounded Desk observation reads each declared screen and
  receipt once on the service for every browser that shows it.

## Impact

- **Service:** a focused observer and interest registry beside
  `server/src/world/snapshot.ts`; the activity cache behind `agent.list`
  (`server/src/agent/agent-activity.ts`); catalogue change notices from the
  connection manager, profile service and socket open/close
  (`server/src/index.ts`); Desk watches beside `server/src/world/desk-*`.
- **Browser:** `web/src/store/updates.ts` (timer removed), `web/src/store.ts`
  (notices, recency slice, interest), `web/src/agentOrder.ts`,
  `web/src/world/paneScreen.ts` and `web/src/world/handoffs.ts` (Desk timers
  replaced by declarations).
- **Evidence:** T2 in `web/src/store/pollReplacement.test.ts`; service tests
  with two browser sockets; `verification/coverage.json` Q04, Q15, Q24.
- **Wire:** new bridge method `world.focused.observe`, `world.desk.observe`;
  new controls `world_connections_changed`, `world_focused_changed`,
  `world_agent_activity`, `world_desk_reads`. Existing methods and controls
  keep their meaning.

No new dependency.

## Owner decision

Committee decision 3: approve this contract once the T2 parity tests exist.

## Defaults chosen here (the owner may override any)

1. **The observation period stays 5 seconds,** today's bound for the active host.
2. **Hosts with an open Inspector count as held,** so their recency and enriched
   fields also refresh within 5 seconds. Today only each browser's active host
   is polled; other hosts refresh on events alone.
3. **A recency push carries the whole map for that host,** and only when
   something in it changed. Each entry is a few identifiers and one time, far
   less than the four lists a poll fetches today. Deltas can come with
   subscriptions v2.
4. **The active tab's layout is not re-read on a timer.** `layout.updated` is a
   lifecycle event, ordered and loss-signalled; every re-list still reads it.
5. **No capability negotiation.** The page and the service ship together; an
   older page still polls and is still answered.
