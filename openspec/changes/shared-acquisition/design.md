## Context

References are to `origin/main` at `501a78c6`. **Verified** means read in source or
observed in a test; **inferred** is marked as such.

### What the 5 s timer does today (verified)

- `startMetadataPolling` (`web/src/store/updates.ts:263-279`) runs every 5 s while
  the document is visible and the bridge is connected. Each tick:
  - schedules a focused re-list of the browser's **active connection only**
    (`scheduleRefresh()` with the default lease, `:275`);
  - calls `bridge.status` for the connection catalogue and browser count (`:276`).
- A focused re-list (`web/src/store/refresh.ts:84-312`) calls `workspace.list`,
  `tab.list`, `pane.list` and the enriched `agent.list`, then `pane.layout` for the
  active tab. One runs per connection and generation, with one queued successor
  and an 80 ms debounce (`:327-339`). An unchanged result publishes nothing
  except `lastTopologyObservationStartedAt` (`:293-299`, `store/sessions.ts:376-410`).
- Herdr events already trigger the same re-list, for **every** ready connection
  whose generation matches (`web/src/store.ts:811-838`). The browser does not
  apply event payloads; it re-lists.
- Reconnection (`store.ts:1025-1043`) and the page becoming visible, focused or
  online (`store.ts:1061-1080`) re-list and fetch `bridge.status`.
- The focused store handles one bridge control, `pause_connection`
  (`store.ts:1052-1059`). `world_invalidated`, which the service sends on every
  connection status change (`server/src/index.ts:541-551`), reaches only the
  aggregate store (`web/src/world/runtimeStore.ts:407-411`).

### Outputs that only the timer refreshes (verified)

1. **Agent recency.** `last_activity_at` is the session file's modification time,
   added by `listWithActivity` (`server/src/rpc/agent.ts:47-53`,
   `server/src/agent/agent-sessions.ts:107-111`, `agent-activity.ts:9-74`). Herdr
   has no such field or event: `herdr api schema --json` (Herdr 0.9.3, protocol
   22) contains no `last_activity_at`. The browser joins it into panes
   (`web/src/agentOrder.ts:120-179`). The attention sort orders idle agents by it
   (`:181-206`); `WorkspaceTree.tsx:372` consumes that order.
2. **Connection catalogue and browser count.** A runtime replaced by anything
   other than this browser's own action (SSH recovery, restart, another browser)
   reaches the focused store only through `bridge.status`. Until then, events
   carrying the new generation are dropped (`store.ts:811-826`).
3. **World-enriched workspace fields.** `workspace.list` gains worktree parents,
   git status, `navigation_mode`, `tab_move_supported` and
   `endpoint_availability` (`server/src/index.ts:1208-1218`). Git status has a
   4 s cache (`server/src/workspace/status.ts:31`) and feeds tree badges, the tab
   bar and the pull-request lookup (`web/src/workspaceTreeBadges.ts:41`,
   `components/TabBar.tsx:211`, `useWorktreePullRequests.ts:60`). Endpoint
   availability changes when any browser attaches or releases a shared terminal
   (`server/src/bridge/terminal-bridge.ts:1548-1557`). Navigation mode and
   tab-move support depend on the runtime's protocol, so they change only with a
   new generation (`terminal-bridge.ts:178-190`).
4. **Changes whose event never arrived.** World does not subscribe to
   `workspace.metadata_updated` (`server/src/connections/runtime.ts:81-104`). A
   lifecycle event lost to overflow closes the subscription and triggers
   resynchronization after the next acknowledgement (`runtime.ts:639-644`), but
   per-pane status sampling can coalesce transitions
   (`.agents/firstmate/research/herdr-event-inventory.md`).
5. **Retries after a failure.** A failed catalogue fetch is "retried on the next
   status poll" (`store.ts:559-561`); `store.test.ts:2101` exercises that
   recovery. A failed re-list stores its error and nothing retries it except the
   next tick, for the active host only (`store/refresh.ts:303-305`).

The timer is also a redundant re-read of the active tab's layout and of
completion transitions; both have event sources. `bridgeStatus.terminals` is
stored (`store.ts:349`) but has no consumer.

### Per-client acquisition elsewhere (verified)

- Desk polls `pane.read` for up to 16 panes every 4 s and `agent_turn.get` for up
  to 40 agents every 20 s, per open Desk (`web/src/world/paneScreen.ts:12-13`,
  `handoffs.ts:80-81`, `:290-340`), as `world-surfaces` "Bounded Desk
  observation" requires.
- The aggregate store refreshes every 15 s as a fallback
  (`web/src/world/runtimeStore.ts:16`, `:419-422`). That is the aggregate
  contract (Q14) and stays; `world-protocol-identity` retires it.

## Goals

- No browser timer re-lists a host or fetches the catalogue.
- Every output stays at least as fresh as today for the hosts a visible browser
  shows, and no less correct after a missed event, a reconnect or a runtime
  replacement.
- Periodic acquisition happens once per resource on the service, whatever the
  number of browsers, and stops when no visible browser holds it.

## Non-goals

- Changing the aggregate refresh, the snapshot wire format or the six refetch
  channels (`world-protocol-identity` v1 and v2).
- Unmounting Spaces, or any change to look, controls or behaviour.
- Applying Herdr event payloads in the browser. Re-listing stays the only way a
  focused store learns topology.

## Decisions

### D1. The poll moves into the service, once per held owner

The service runs one **focused observer** per owner, keyed by connection ID and
runtime generation, while at least one visible browser holds that owner. Every
5 seconds after its previous observation ends, it reads what a browser re-list
reads: the enriched `workspace.list`, `tab.list`, `pane.list` and `agent.list`,
plus session-file activity. It never overlaps two observations of one owner, and
it drops a result whose runtime lease or generation is no longer current.

It compares a digest of the lists, excluding activity times, with its previous
observation. On a difference it sends `world_focused_changed` to the sockets that
hold the owner, and each browser re-lists as it does for a Herdr event. It sends
activity changes as values (D2).

*Alternatives rejected.* Deleting the timer freezes recency and the catalogue
(committee objection A). A browser activity-only refresh is still per-client
polling. Pushing whole focused observations is subscriptions v1 and v2 work.

*Why notify on every difference.* An observer cannot tell whether a browser's
event-driven re-list already saw a change: the event may precede a second,
unannounced change. Notifying on every digest change costs an interested
browser at most one extra re-list per period while a host changes, and nothing
while it is idle.

### D2. Recency is pushed as values, with one source in the browser

The observer's activity readings fill a per-owner cache. `world_agent_activity`
carries the owner's whole map when any entry changes, and is sent to a socket
when it starts holding the owner. The browser keeps the latest admitted map per
owner and generation, and joins it into that owner's panes whenever either the
panes or the map change. It ignores `last_activity_at` in `agent.list` replies,
so a re-list reply that was computed before a push can't roll recency back.
`agent.list` keeps enriching for other callers, reading the cache while the
owner is observed.

An entry applies to a pane only when the pane ID, terminal ID and agent match,
and the agent session matches when both carry one. A replaced session never
inherits another's time. Today's extra rule, that agent and pane status agree,
stays for `state_change_seq` and the agent name. Recency no longer drops out for
one re-list during a status change.

The reading keeps today's limits: four concurrent reads, a 1.5 s deadline, and
no local session lookup for a remote connection (`agent-activity.ts:9-74`).

### D3. The catalogue and browser count are change notices

The service sends `world_connections_changed` with a revision whenever a profile
is created, edited, removed or made default, a connection's state or generation
changes, or a socket opens or closes. The browser then fetches `bridge.status`
once, keeping one fetch in flight and one queued, and applies it exactly as
today (`store.ts:331-356`, `:432-547`). This is World's existing pattern for
watchlists, Desk marks, Board and profiles. No periodic repair is needed: the
service owns this state, and a lost socket triggers reconnection, which
refetches.

### D4. Interest is explicit, visible-only and released on close

- A browser holds its active connection, plus each connection that owns an open
  Inspector window, while its page is visible. Inspector owners hold and release
  through the store, so a host filter or another window's focus never changes
  them. Loading a host's session (`store.loadConnectionSession`) or re-listing
  it after an event does not hold it.
- The browser sends the whole set with `world.focused.observe`, replacing its
  previous declaration. It sends an empty set when the page is hidden, and the
  set again when it is shown.
- Owners are `{connection_id, connection_generation}`. After a runtime
  replacement, the browser declares the new generation once the catalogue admits
  it. The old generation's interest is fenced and lapses.
- The service counts holders per owner across sockets. A closed socket releases
  its declarations. The last release stops the observer and clears its activity
  cache. Malformed declarations are rejected; well-formed unknown owners are
  ignored, as for snapshot priority hints.
- Interest is not authority. It does not select a host, change a filter, admit
  an operation or wake a disconnected runtime.

### D5. Desk screens and receipts are watched once per target

The browser's Desk keeps choosing its targets as today (urgency order, fair
share between hosts, 16 screens and 40 receipts), then declares them with
`world.desk.observe` instead of reading them. Screen targets are keyed by
connection, generation, pane and agent session; receipt targets add the
browser's current trigger (status, activity and observed stop).

The service keeps one watch per target, with a holder count:
- It reads a screen every 4 s, and a receipt every 20 s and whenever a holder's
  trigger changes.
- It keeps today's per-host queues and never overlaps two reads of the same kind
  on one host.
- It sends `world_desk_reads` to the holders when a result changes, and the
  latest result to a new holder.
- It publishes nothing for a released target or a retired generation.

A hidden page or a closed Desk releases its declarations. Search and lanes still
don't release targets, as today. Hosts held by two browsers with different
filters read the union of their targets.

### D6. Layouts stay event-driven

`layout.updated` is a lifecycle event: ordered, and an overflow is signalled and
followed by resynchronization (event inventory, codes L and G). Every re-list
still reads the active tab's layout, and a changed re-list still triggers the
visible-tab reads that depend on `lastRefresh` (`web/src/visibleTabLayout.ts:333-347`).
The 5 s re-read of an unchanged active tab is dropped. *Inferred, to verify in
the implementation PR:* Herdr emits `layout.updated` after the layout is
readable, because the event carries the new layout.

### D7. Failures are retried, not polled

A failed catalogue fetch, and a failed re-list of a held owner, are retried
once per period until one succeeds, the owner is retired or released, or the
page is hidden. A success stops the retry. This keeps today's recovery without
a standing timer: nothing runs while everything succeeds.

### D8. What stays exactly as it is

- Herdr event admission and the scoped re-list, including Inspectors on other
  hosts (`store.ts:811-838`).
- Pending-focus settlement, browser-local navigation and selection validity
  (`store/refresh.ts:145-212`).
- Attachment begin, complete and revoke, and their protection during a re-list
  (`store.ts:844-920`, `store/refresh.ts:281-292`).
- The completion tracker and notification modes (`store/notifications.ts:136-182`,
  `:572-592`). A bootstrap or reconnect observation is never a completion.
- Return-to-page catch-up, the aggregate store, the update check and Spaces
  staying mounted.

## The contract, output by output

"Held" means a visible browser holds the owner (D4). "Re-list" is the existing
scoped focused re-list. "Period" is the observer's 5 s.

| Output | Consumers | Source after this change | Freshness while held | Repair |
|---|---|---|---|---|
| Topology, labels, order, focus flags, agent status and presentation, agent names, pane tokens | Spaces tree, shell, Inspectors, creation controls | Herdr lifecycle events and the per-pane status stream, then a re-list; the observer's digest when no event arrives | After the event's re-list; without an event, within one period, one observation and one re-list | Loss or reconnect of the Herdr subscription: resynchronization after the acknowledgement, then a re-list for every holder. Browser reconnect: catalogue, declaration, re-list |
| Agent recency | Attention sort of idle agents in the Spaces tree | Observer's session-file reading, pushed as `world_agent_activity` | Within one period and the 1.5 s reading deadline, with no Herdr event needed | Declaring an owner sends its current map: on show, reconnect and generation admission |
| Connection catalogue (state, generation, labels, default) and browser count | Event admission, connection switcher, settings menu, reattachment | `world_connections_changed`, then `bridge.status` | One fetch after the change | Reconnect and return-to-page fetch it, as today |
| Navigation mode, tab-move support | Navigation projection, tab moves | Fixed per runtime generation | With the generation's admission and first re-list | As topology |
| Focus hints, pending focus, selection validity | App shell, Spaces selection | Herdr focus events and the post-action re-list | After the event or the action's re-list | As topology. A pending focus is still released only by an observation started after its action settled |
| Endpoint availability | Terminal actions, scroll, creation | Observer digest (shared terminal registry); this browser's own attachments update at once | Within one period for other browsers' attachments; at once for this browser's | Disconnect clears it, as today; then a re-list |
| Git status, worktree parents, hook settings | Tree badges, tab bar, pull-request lookup, worktree lifecycle | Observer digest of the enriched workspace list | Within one period plus the 4 s git status cache | Reconnect re-lists |
| Active tab layout, visible tab layouts, cache pruning | Terminals, pane maps, Inspectors | `layout.updated` and every re-list; `lastRefresh` for visible tabs | After the event's re-list | Resynchronization or reconnect re-lists; a stale layout retries through the debounce, as today |
| Completions and fallback notifications | Browser notifications when Herdr's own are unavailable | Status transitions between consecutive observations of one owner | After the status event's re-list; a missed status change within one period | Tracker reset on generation change or reconnect; current state is never a completion |
| Inspector removal evidence | Inspector windows | Any re-list of that owner (`lastTopologyObservationStartedAt`) | After the closing event's re-list | As topology |
| Recovery from a failed fetch or re-list | Every output above | A retry once per period while failing (D7) | Within one period of the failure | Stops on success, retirement, release or hiding |

Workspace metadata tokens change without an event World subscribes to
(`workspace.metadata_updated`). No browser code reads them today (only pane
tokens, which `pane.updated` announces); the observer's digest covers them
within one period, as the timer did for the active host.

**Hidden page.** The browser releases its interest. Herdr events still trigger
re-lists, so completions are still noticed. On return it declares again, gets
the current recency, and re-lists and fetches the catalogue, as today.

**Runtime replacement.** The service sends `world_connections_changed`. The
browser admits the new generation from `bridge.status`, declares it, and
re-lists. Pushes and replies for the old generation are discarded.

## Wire messages

All are bridge-global. Existing methods and controls keep their meaning.

- `world.focused.observe` `{owners: [{connection_id, connection_generation}]}`
  → `{ok: true}`. Replaces this socket's focused interest; `[]` releases it.
  At most 64 owners.
- `world_focused_changed` `{type, connection_id, connection_generation, revision}`:
  the owner's observation changed. Holders re-list that owner.
- `world_agent_activity` `{type, connection_id, connection_generation, revision,
  agents: [{pane_id, terminal_id, agent, session, last_activity_at}]}`: the
  owner's whole recency map. `session` is the agent session value or `null`.
  A browser keeps the highest revision per owner and generation.
- `world_connections_changed` `{type, revision}`: fetch `bridge.status`.
- `world.desk.observe` `{screens: [{connection_id, connection_generation,
  pane_id, session}], receipts: [{…, trigger}]}` → `{ok: true}`. Replaces this
  socket's Desk interest. At most 16 screens and 40 receipts.
- `world_desk_reads` `{type, kind: "screen" | "receipt", connection_id,
  connection_generation, pane_id, session, revision, result | error}`: a
  target's latest read.

Pushes travel on the live socket, so they don't carry the service incarnation
(`world-protocol-identity`). A lost socket reconnects and declares again.

## Cost

| Work | Today | After |
|---|---|---|
| Focused lists, idle host | each visible browser, active host, every 5 s | the service, each held owner, every 5 s; no browser re-list |
| Recency reads | each re-list, per browser | once per period per held owner |
| Catalogue | each visible browser every 5 s | one fetch per browser per change |
| Desk screens | each Desk, up to 16 panes, every 4 s | the service, the union of declared targets, every 4 s |
| Desk receipts | each Desk, up to 40 agents, every 20 s and on trigger | the service, the union of declared targets, every 20 s and on trigger |
| Browser work on an idle host | one store emit every 5 s | none |

A browser holding Inspectors on other hosts adds those hosts to the service's
observations (default 2 in the proposal).

## Parity tests (T2)

The committee's T2: two browsers, two open hosts, recency moves, and status,
navigation, availability, layouts and completions stay intact. No timing
assertions: a manual clock that never fires a timer unless the test runs it, and
completion signals from the store.

**Browser half, in this change** (`web/src/store/pollReplacement.test.ts`). It
runs the real focused store against a simulated World service, through the
bridge's public surface, with two ready hosts: the active host and one held by
an Inspector. Cases that need the new behaviour are `test.failing` today and are
flipped by the implementation. Cases that already hold are guards.

| Case | Today |
|---|---|
| Both hosts load, with the active host's recency and the catalogue | guard |
| A status event updates that host's panes, on the active and the Inspector's host | guard |
| A focus event re-lists only the host that sent it | guard |
| This browser's own attachment updates availability at once | guard |
| `layout.updated` re-reads the active tab's layout | guard |
| A working→idle transition notifies once; later re-lists don't | guard |
| A failed re-list is retried within one period | guard (today the timer retries it) |
| No browser timer re-lists a host or fetches the catalogue | expected failure |
| Recency moves without a status change, on both hosts; a late push for a retired generation changes nothing | expected failure |
| A focused change notice re-lists that host only (git status) | expected failure |
| Another browser connecting updates the browser count | expected failure |
| Hiding the page releases interest; showing it declares again and catches up | expected failure |
| A runtime replaced elsewhere is admitted after a catalogue notice, then its events are | expected failure |

Each expected failure was checked to fail at its first intended assertion, not
in the harness. Pending-focus settlement keeps its own tests
(`web/src/store.test.ts:3319-3527`), which call the re-list directly and don't
use the timer. The simulated service follows the contract: it sends an owner's
recency when a browser declares it. Holding an Inspector's host needs the hold
API, so task 3.4 adds that case.

**Service half, in the implementation change.** It needs the observer, so it is
written there first, with two browser sockets and two simulated hosts:
- Two browsers holding one owner cause one observation per period, and both
  receive its notices and recency.
- One browser hidden: the other keeps receiving; the hidden one receives nothing
  and gets the current recency on return.
- A closed socket releases its interest; the last release stops the observer.
- A runtime replaced during an observation publishes nothing for the old
  generation.
- An idle host for many periods: zero notices, zero recency pushes.
- Desk: two browsers declaring the same screen cause one read per 4 s.
  Releasing one keeps the other's reads. A read completing after release or
  retirement is not published.

Once `createWorldService(deps)` exists (committee item 9), one composed
in-process case joins these: two real browser stores, one service, two hosts.

## Verification mapping

- **Q15** (focused operational contexts, owner `web/src/store.ts`): the browser
  half of T2 joins its tests. Properties added: no browser timer drives focused
  observation; notices and recency are admitted only for a ready owner with the
  matching generation.
- **Q04** (subscriptions): resynchronization after acknowledgement stays the
  repair for Herdr event loss; the observer adds bounded repair for unannounced
  changes.
- **Q24** (Desk receipts and review marks): Desk reads move to service watches
  with holder counts.
- **Q14** (aggregate refresh): unchanged.
- The interest registry is small: two sockets, two owners, visible, hidden and
  closed, plus a generation bump. The implementation tests it exhaustively over
  that space instead of adding a Quint model, and maps it to Q04 and Q15. The
  existing `quint/runtime-leases.qnt` keeps covering the lease fence the
  observer uses.

## Risks

- **More observation for multi-host Inspector use.** Bounded by default 2; the
  owner can limit holding to the active host.
- **Union of Desk targets across browsers.** Two browsers with different host
  filters read more targets than either alone. Each declaration stays capped,
  and the service never reads a target twice per period.
- **An unannounced layout change.** Covered only by the next re-list of that
  owner; see D6.
