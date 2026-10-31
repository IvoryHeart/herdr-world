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
   `workspace.metadata_updated` (`server/src/connections/runtime.ts:81-104`).
   Herdr 0.9.3 keeps 512 events of history
   ([`event_hub.rs:19`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/event_hub.rs#L19)).
   A subscriber that falls behind gets `events_lost`
   ([`subscriptions.rs:330-334`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/subscriptions.rs#L330-L334)),
   and its connection ends
   ([`server.rs:926-939`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/server.rs#L926-L939)).
   World then resubscribes and resynchronizes after the next acknowledgement
   (`runtime.ts:639-644`). A per-pane status subscription with no matching
   history samples the pane's current state against the last status it saw
   ([`subscriptions.rs:300-315`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/subscriptions.rs#L300-L315),
   [`:506-517`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/subscriptions.rs#L506-L517)),
   so a transition that returns to its starting state between samples isn't
   reported.
5. **Retries after a failure.** A failed catalogue fetch is "retried on the next
   status poll" (`store.ts:559-561`); `store.test.ts:2101` exercises that
   recovery. A failed re-list stores its error and nothing retries it except the
   next tick, for the active host only (`store/refresh.ts:303-305`).

The timer is also a redundant re-read of the active tab's layout and of
completion transitions; both have event sources. `bridgeStatus.terminals` is
stored (`store.ts:349`) but has no consumer.

### Measured on a disposable Herdr 0.9.3 session (verified)

These runs used `herdr --session <name>` with synthetic panes only. No World
instance and no other session was involved.

- **A busy pane.** One pane printed a line every 0.4 s while a synthetic agent
  reported `working`. Over 20 one-second samples of the four lists:
  - no event arrived;
  - the only field that changed was `panes[].scroll.max_offset_from_bottom`,
    in 9 samples;
  - `revision` and the titles did not change.

  No browser code reads a pane's `scroll`.
- **Layouts.** Eight splits and resizes each emitted one `layout.updated`. A
  `pane.layout` read made as soon as the event arrived equalled a read 300 ms
  later. Its only difference from the event's payload was the float formatting
  of a split's `ratio`.

### Per-client acquisition elsewhere (verified)

- Desk polls `pane.read` for up to 16 panes every 4 s and `agent_turn.get` for up
  to 40 agents every 20 s, per open Desk (`web/src/world/paneScreen.ts:12-13`,
  `handoffs.ts:80-81`, `:290-340`), as `world-surfaces` "Bounded Desk
  observation" requires.
- The aggregate store refreshes every 15 s as a fallback
  (`web/src/world/runtimeStore.ts:16`, `:419-422`). That is the aggregate
  contract (Q14). It stays unchanged, outside this change.

## Goals

- No browser timer re-lists a host or fetches the catalogue.
- Every output stays at least as fresh as today for the hosts a visible browser
  shows, and no less correct after a missed event, a reconnect or a runtime
  replacement.
- Periodic acquisition happens once per resource on the service, whatever the
  number of browsers, and stops when no visible browser holds it.

## Non-goals

- Changing the aggregate refresh and its 15 s fallback, the snapshot wire
  format or the six refetch channels.
- Event-driven re-lists. Each browser still re-lists a host after its events,
  as today; that cost belongs to observation v1 (`world-protocol-identity`).
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

**Notices compare with what each browser received.** The service serves every
browser's list replies. So it records, per socket and owner, a digest of each
list it last sent that socket. After an observation, it sends
`world_focused_changed` to a holder only when some list differs from that
holder's record, and the browser re-lists as it does for a Herdr event:
- A holder that never received a list, or received it before a change, gets
  one notice.
- A change the holder already re-listed after its event costs nothing more.
- A restarted observer has no silent baseline, because the comparison is with
  what the browser has, not with the observer's last reading.

**Only the focused re-list updates the record.** Its four list calls carry
`focused_observation: true` on the request frame, which the service doesn't
forward to Herdr, and only replies to marked calls update the record. Other
callers of the same methods leave the record alone, so a reply they get can't
hide a change from the focused store:
- the worktree dialog calls `workspace.list`
  (`web/src/components/WorktreeLifecycleDialog.tsx:145`);
- Town moves call `tab.list` (`web/src/world/town/townMoves.ts:152`).

**Digests leave out what no browser reads and what output alone changes.**
These are activity times, which are pushed (D2), and `panes[].scroll`, which
changes with output and no event (measured above). Activity changes go out as
values (D2).

*Alternatives rejected.*
- Deleting the timer freezes recency and the catalogue (committee objection A).
- A browser activity-only refresh is still per-client polling.
- Comparing each observation with the observer's previous one misses a change
  for a new holder, and re-lists every holder again after each evented change.
- Pushing whole focused observations is subscriptions v1 and v2 work.

### D2. Recency is pushed as values and never moves backwards

- **The service reads once.** The observer's readings fill a per-owner cache.
  While the cache is at most one period old, `agent.list` replies are enriched
  from it. Otherwise they are enriched by a reading with today's limits: four
  concurrent reads, a 1.5 s deadline, and no local session lookup for a remote
  connection (`agent-activity.ts:9-74`).
- **It pushes changes, never placeholders.** When a reading changes any entry,
  the service sends `world_agent_activity` with the owner's whole map to the
  owner's holders. It sends nothing before its first reading exists. A new
  holder's own re-list (D4) brings current recency through `agent.list`, so
  nothing is pushed on declaration.
- **The browser keeps the latest time it has seen.** Per pane identity (pane,
  terminal, agent and agent session), it keeps the latest time from either
  source, `agent.list` or a push. So:
  - a reply computed before a push can't roll recency back;
  - the first render keeps today's recency;
  - pushes need no revision, because taking the latest time gives the same
    result in any order;
  - a new generation starts with empty operation/observation admission. A separate
    read-only history may rejoin the exact connection, pane, terminal, agent and
    session after admission; World restarting and resetting its counters does
    not lower the same external session's maximum. This history grants no lease
    or operation authority and never admits an obsolete-generation control;
  - identities awaiting the first pane/layout publication retain independent
    maxima, even when two sessions share the same pane ID in in-flight pushes.
- **Sessions don't share times.** An entry for another agent session never
  applies, so a replaced session never inherits another's time.
- **What changes in the join.** Today's rule that agent and pane status agree
  stays for `state_change_seq` only. The agent name still joins whenever pane,
  terminal and agent match (`agentOrder.ts:138-149`). Recency no longer drops
  out for one re-list during a status change.

### D3. The catalogue and browser count are change notices

The service sends `world_connections_changed` with a revision whenever a profile
is created, edited, removed or made default, a connection's state or generation
changes, or a socket opens or closes. The browser then fetches `bridge.status`
once, keeping one fetch in flight and one queued, and applies it exactly as
today (`store.ts:331-356`, `:432-547`). This is World's existing pattern for
watchlists, Desk marks, Board and profiles. No periodic repair is needed: the
service owns this state, and a lost socket triggers reconnection, which
refetches. A failed fetch is retried (D7).

### D4. Interest is explicit, visible-only and released on close

- A browser holds its active connection, plus each connection that owns an open
  Inspector window, while its page is visible. Inspector owners hold and release
  through the store, so a host filter or another window's focus never changes
  them. Loading a host's session (`store.loadConnectionSession`) or re-listing
  it after an event does not hold it.
- The browser sends the whole set with `world.focused.observe`, replacing its
  previous declaration. It sends an empty set when the page is hidden, and the
  set again when it is shown.
- Starting to hold an owner re-lists it once. That happens:
  - when the active connection changes, as today;
  - when the page is shown, for every held owner, not only the active one;
  - when an Inspector conversation is admitted, even on an owner already held.

  An Inspector's removal needs a re-list that started after its window opened
  (`web/src/world/useWorldInspectorController.ts:327`, `:677-681`). A preview
  skips the focus action that would otherwise provide one (`:319`).
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
`world.desk.observe` instead of reading them. Every physical watch is keyed by
kind, connection, generation, pane and the session fingerprint used by
`receiptIdentity`. A receipt trigger (status, activity and observed stop) is
per-holder declaration data, never part of that key.

The service keeps one watch per target, with a holder count:
- It reads a screen every 4 s, and a receipt every 20 s. Any holder's trigger
  change makes one successor read due; changes during a read coalesce.
- It keeps independent per-host queues and never overlaps two reads of the same
  kind on one host, including while retired work settles.
- At read start it captures each holder's declared trigger. Each holder receives
  its own captured trigger in `world_desk_reads`; the browser stores
  `receiptAfterRead(receipt, trigger)`. A holder that declared after read start
  gets that actual result with trigger `null` (shown, never current), and its
  declaration makes a successor read due.
- A successful delivery is suppressed only when both its result and that
  holder's captured trigger are unchanged. An identical receipt read for a new
  stop must arrive so the stop can become markable.
- Every failed read is delivered. The notice includes a consecutive failure
  count for that holder's captured trigger, reset by success or a different
  captured trigger. The browser independently keeps today's count for that
  trigger and calls `receiptAfterError(previous, trigger, count)`; it never
  substitutes a watch-level count for its own history.
- A new holder gets the latest result only once a read exists, never a placeholder.
  Results arrive in read order, because reads of one target never overlap, so
  they need no revision.
- Session validation surrounds native reads. It publishes nothing for a released
  target, replaced session or retired generation. Last release clears cached
  results, cancels queued reads and stops scheduling.

A hidden page or a closed Desk releases its declarations. Search and lanes still
don't release targets, as today. Hosts held by two browsers with different
filters read the union of their targets.

### D6. Layouts stay event-driven

`layout.updated` is a lifecycle event. It is ordered, and an overflow is
signalled and followed by resynchronization (Context, item 4). Every re-list
still reads the active tab's layout, and a changed re-list still triggers the
visible-tab reads that depend on `lastRefresh`
(`web/src/visibleTabLayout.ts:333-347`). The 5 s re-read of an unchanged
active tab is dropped. Verified on Herdr 0.9.3 (measured above): once
`layout.updated` arrives, `pane.layout` already returns the new layout.

### D7. Failures are retried, not polled

A failed catalogue fetch, and a failed re-list of a held owner, are retried
once per period until one succeeds, the owner is retired or released, or the
page is hidden. A success stops the retry. This keeps today's recovery without
a standing timer: nothing runs while everything succeeds.

The browser's only other timers are a re-list's own: the 80 ms debounce, and the
follow-ups it schedules after a stale layout, a changed navigation target, an
attachment change during the read, or a queued successor
(`store/refresh.ts:243`, `:269`, `:291`, `:309`).

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

### D9. One capability gates the whole change

The service advertises `world_shared_acquisition` in its hello. A browser that
doesn't see it keeps today's acquisition:
- the 5 s re-list and catalogue fetch;
- Desk's own reads: screens every 4 s, receipts every 20 s and on their trigger.

So:
- a newer page on an older service, for example after a rollback, still
  refreshes;
- the service can stop advertising the capability to fall back without a
  release.

`world-protocol-identity` negotiates v1 and v2 the same way. The last T2 case
keeps the fallback working: after the service restarts without the capability,
the timer resumes.

## The contract, output by output

"Held" means a visible browser holds the owner (D4). "Re-list" is the existing
scoped focused re-list. "Period" is the observer's 5 s. "Notice" is a
`world_focused_changed` sent when the observation differs from the lists that
browser last received (D1).

| Output | Consumers | Source after this change | Freshness while held | Repair |
|---|---|---|---|---|
| Topology, labels, order, focus flags, agent status and presentation, agent names, pane tokens | Spaces tree, shell, Inspectors, creation controls | Herdr lifecycle events and the per-pane status stream, then a re-list; a notice when no event arrives | After the event's re-list; without an event, within one period, one observation and one re-list | Herdr subscription loss or reconnect: resynchronization after the acknowledgement, then a re-list for every holder. Browser reconnect: catalogue, declaration, re-list. A new holder re-lists once (D4) |
| Agent recency | Attention sort of idle agents in the Spaces tree | `agent.list` on every re-list, and the observer's readings pushed as `world_agent_activity`; the browser keeps the latest time per session | Within one period and the 1.5 s reading deadline, with no Herdr event needed | A new holder's re-list brings current recency; nothing is pushed before a reading exists |
| Connection catalogue (state, generation, labels, default) and browser count | Event admission, connection switcher, settings menu, reattachment | `world_connections_changed`, then `bridge.status` | One fetch after the change | Reconnect and return-to-page fetch it, as today; a failed fetch is retried (D7) |
| Navigation mode, tab-move support | Navigation projection, tab moves | Fixed per runtime generation | With the generation's admission and first re-list | As topology |
| Focus hints, pending focus, selection validity | App shell, Spaces selection | Herdr focus events and the post-action re-list | After the event or the action's re-list | As topology. A pending focus is still released only by an observation started after its action settled |
| Endpoint availability | Terminal actions, scroll, creation | A notice (the shared terminal registry is in the enriched workspace list); this browser's own attachments update at once | Within one period for other browsers' attachments; at once for this browser's | Disconnect clears it, as today; then a re-list |
| Git status, worktree parents, hook settings | Tree badges, tab bar, pull-request lookup, worktree lifecycle | A notice for the enriched workspace list | Within one period plus the 4 s git status cache | Reconnect and a new hold re-list |
| Active tab layout, visible tab layouts, cache pruning | Terminals, pane maps, Inspectors | `layout.updated` and every re-list; `lastRefresh` for visible tabs | After the event's re-list (verified current, D6) | Resynchronization or reconnect re-lists; a stale layout retries through the debounce, as today |
| Completions and fallback notifications | Browser notifications when Herdr's own are unavailable | Status transitions between consecutive observations of one owner | After the status event's re-list; a missed status change within one period | Tracker reset on generation change or reconnect; current state is never a completion |
| Inspector removal evidence | Inspector windows | Any re-list of that owner, including the one when its window is admitted (D4) | After the closing event's re-list, or at admission | As topology |
| Recovery from a failed fetch or re-list | Every output above | A retry once per period while failing (D7) | Within one period of the failure | Stops on success, retirement, release or hiding |

Workspace metadata tokens change without an event that World subscribes to
(`workspace.metadata_updated`). No browser code reads them today; it reads only
pane tokens, which `pane.updated` announces. A notice covers them within one
period, as the timer did for the active host.

**Hidden page.** The browser releases its interest. Herdr events still trigger
re-lists, so completions are still noticed. On return, it declares again,
re-lists every held owner and fetches the catalogue.

**Runtime replacement.** The service sends `world_connections_changed`. The
browser admits the new generation from `bridge.status`. Admission resets the
active owner's lease, which re-lists it (`store.ts:496-502`, `:392-430`). The browser then
declares the new generation. Frames and replies for the old generation are
discarded. An Inspector bound to the old generation is retired, as today
(`useWorldInspectorController.ts:693-697`).

## Wire messages

All are bridge-global. Existing methods and controls keep their meaning.

- Hello capability `world_shared_acquisition: true` (D9). It gates the focused
  path and Desk together.
- Request-frame field `focused_observation: true` on the focused re-list's four
  list calls. It sits beside `connection_id`, not in `params`, so it never reaches
  Herdr. Only replies to marked calls update the service's per-socket record
  (D1).
- `world.focused.observe` `{owners: [{connection_id, connection_generation}]}`
  → `{ok: true}`:
  - replaces this socket's focused interest, and `[]` releases it;
  - accepts at most 64 owners;
  - pushes nothing in reply.
- `world_focused_changed` `{type, connection_id, connection_generation}`: sent
  to one holder whose last received lists differ from the observation. That
  holder re-lists the owner.
- `world_agent_activity` `{type, connection_id, connection_generation,
  agents: [{pane_id, terminal_id, agent, session, last_activity_at}]}`:
  - the owner's whole recency map, sent to its holders after a reading changes
    it;
  - `session` is the agent session value or `null`;
  - it carries no revision, because the browser keeps the latest time per
    session.
- `world_connections_changed` `{type, revision}`: fetch `bridge.status`. The
  revision follows the other `world_*_changed` channels.
- `world.desk.observe` `{screens: [{connection_id, connection_generation,
  pane_id, session}], receipts: [{…, trigger}]}` → `{ok: true}`. It replaces
  this socket's Desk interest, with at most 16 screens and 40 receipts.
- `world_desk_reads` `{type, kind: "screen" | "receipt", connection_id,
  connection_generation, pane_id, session, trigger, result | error, failures?}`:
  a target's latest read, in read order. `session` is the receipt session
  fingerprint (or `null`), rather than the recency channel's session value.
  `trigger` is this holder's value captured at read start, or `null` for a late
  holder (also `null` for screens). Success includes `result`; failure includes
  an error string and `failures`, counted per holder and captured trigger. Every
  failed read arrives, even with identical error text. Browser failure currency
  uses its own per-trigger count as described in D5.

Pushes travel on the live socket, so they don't carry the service incarnation
(`world-protocol-identity`). A lost socket reconnects and declares again.

## Cost

| Work | Today | After |
|---|---|---|
| Focused lists, idle host | each visible browser, active host, every 5 s | the service, each held owner, every 5 s; no browser re-list |
| Focused lists, busy host | each visible browser: every 5 s, plus after each event | the service: every 5 s. Each browser: after each event, as today, plus one re-list for a change it hasn't received. Output alone causes none (measured) |
| Recency reads | each re-list, per browser | once per period per held owner; re-lists read the cache |
| Catalogue | each visible browser every 5 s | one fetch per browser per change |
| Desk screens | each Desk, up to 16 panes, every 4 s | the service, the union of declared targets, every 4 s |
| Desk receipts | each Desk, up to 40 agents, every 20 s and on trigger | the service, the union of declared targets, every 20 s and on trigger |
| Browser store work, host with output but no event | one publication every 5 s (each poll returns new `scroll` values) | none |

A browser holding Inspectors on other hosts adds those hosts to the service's
observations (default 2 in the proposal).

**The stage-2 exit "acquisitions don't multiply with browsers".** It holds for
everything this change acquires periodically: observations, recency, the
catalogue and Desk reads. Re-lists after events stay per browser, as today
(non-goals). Observation v1 owns that cost.

## Parity tests (T2)

The committee's T2: two browsers, two open hosts, recency moves, and status,
navigation, availability, layouts and completions stay intact. The tests make
no timing assertions:
- a manual clock never fires a timer unless the test runs it;
- waits await completion signals registered before their trigger: a store
  emission that meets a named condition, a completed re-list
  (`lastTopologyObservationStartedAt`), or the service receiving a call;
- frames are handled in order, so a frame the browser must ignore is followed
  by one it applies before the check.

**Browser half, in this change** (`web/src/store/pollReplacement.test.ts`).
- It runs the real Bridge and focused store against a simulated World service,
  with two ready hosts: the active host, and one loaded for an Inspector.
- The simulator follows the contract:
  - notices and recency reach only the sockets that declared the owner;
  - nothing is pushed on declaration;
  - the hello advertises the capability.
- Cases that need the new behaviour are `test.failing`; the implementation
  flips them. Cases that already hold are guards.

| Case | Today |
|---|---|
| Both hosts load; the active host's first re-list carries its recency, with no push | guard |
| Control frames reach the bridge's control handlers | guard |
| A status event updates that host's panes, on the active and the Inspector's host | guard |
| A focus event on one host keeps the active host's selection, pending focus and layout | guard |
| This browser's own attachment updates availability at once | guard |
| List calls from other callers, made as the worktree dialog and Town moves make them, stay unmarked (D1) | guard |
| `layout.updated` re-reads the active tab's layout | guard |
| A working→idle transition notifies once; a later re-list does not | guard |
| Showing the page re-lists the active host and fetches the catalogue | guard |
| A failed re-list is retried within one period | guard (today the timer retries it) |
| No browser timer re-lists a host or fetches the catalogue | expected failure |
| Recency moves without a status change, with no re-list. Another session's entry and a retired generation's push change nothing | expected failure |
| A focused change notice re-lists that host only (git status, endpoint availability) | expected failure |
| Another browser connecting updates the browser count | expected failure |
| Hiding the page releases interest; showing it declares again | expected failure |
| A runtime replaced elsewhere is repaired by the catalogue notice: its dropped event's change appears, no completion is announced across generations, and late old-generation frames change nothing | expected failure |
| After reconnecting to a service without the capability, the 5 s re-list and catalogue fetch resume (D9) | guard |
| The focused re-list marks its four list calls (D1) | expected failure |

How this was checked:
- Each expected failure fails at its first intended assertion, not in the
  harness.
- A throwaway browser-side prototype turned all seven green without changing a
  guard. It covered D2, D3, D4 (the active host only), D7, D9 and the call
  marker of D1. It wasn't committed.
- Pending-focus settlement keeps its own tests
  (`web/src/store.test.ts:3319-3527`), which call the re-list directly and
  don't use the timer.
- Holding an Inspector's host needs the hold API, so task 3.4 adds those cases.

**Service half, in the implementation change.** It needs the observer, so it is
written first there, with two browser sockets and two simulated hosts. It must
be green before task 3.1 removes the timer:
- Two browsers holding one owner cause one observation per period; both receive
  its notices and recency.
- A change a holder already re-listed after its event causes no notice to that
  holder.
- A holder that declares after a quiet change gets one notice. A restarted
  observer has no silent baseline.
- A pane that only prints (`scroll` changes) causes no notice.
- A one-off `workspace.list` or `tab.list` from another caller doesn't update
  the record, and doesn't suppress the next notice.
- No recency push is sent before the first reading; pushes reach holders only.
- One browser hidden: the other keeps receiving; the hidden one receives
  nothing.
- A closed socket releases its interest; the last release stops the observer.
- A runtime replaced during an observation publishes nothing for the old
  generation.
- Desk: two browsers declaring the same screen cause one read per 4 s.
  Releasing one keeps the other's reads. A read completing after release or
  retirement is not published. Without the capability, Desk keeps its own
  reads (task 4.3).

Once `createWorldService(deps)` exists (committee item 9), one composed
in-process case joins these: two real browser stores, one service, two hosts.

## Verification mapping

- **Q15** (focused operational contexts, owner `web/src/store.ts`): the browser
  half of T2 joins its tests. Properties added:
  - no browser timer re-lists a host or fetches the catalogue periodically;
  - the only timers that re-list a host or fetch the catalogue retry a failed
    fetch or re-list, or are a re-list's own debounce and follow-ups;
  - the focused re-list marks its four list calls;
  - notices and recency are admitted only for a ready owner with the matching
    generation.
- **Q04** (subscriptions): resynchronization after acknowledgement stays the
  repair for Herdr event loss. The observer adds bounded repair for unannounced
  changes.
- **Q24** (Desk receipts and review marks): Desk reads move to service watches
  with holder counts.
- **Q14** (aggregate refresh): unchanged.
- **The interest registry** is small: two sockets, two owners, visible, hidden
  and closed, plus a generation bump. The implementation tests it exhaustively
  over that space instead of adding a Quint model, and maps it to Q04 and Q15.
  The existing `quint/runtime-leases.qnt` keeps covering the lease fence the
  observer uses.

## Risks

- **More observation for multi-host Inspector use.** Bounded by default 2; the
  owner can limit holding to the active host.
- **Union of Desk targets across browsers.** Two browsers with different host
  filters read more targets than either alone. Each declaration stays capped,
  and the service never reads a target twice per period.
- **Fields that change with output alone.** On Herdr 0.9.3 this is
  `panes[].scroll`, which the digest leaves out. A future Herdr field of this
  kind would cost holders a re-list per period until it's left out too. The
  service tests name the digest's exclusions, so adding one is deliberate.
