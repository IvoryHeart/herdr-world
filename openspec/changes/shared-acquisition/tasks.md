## 1. Contract and parity tests

- [x] 1.1 Write the contract: each output of the 5 s timer with its source, freshness and repair; shared acquisition with reference-counted interest; Desk watches; the capability.
- [x] 1.2 Add the browser half of T2 (`web/src/store/pollReplacement.test.ts`): two ready hosts, a simulated World service that follows declarations, a manual clock and completion signals. New behaviour is checked in as expected failures, and unchanged behaviour as guards. A guard covers the capability fallback after a service restart.
- [x] 1.3 Measure on a disposable `herdr --session`: which list fields change with output alone, and whether `pane.layout` is current once `layout.updated` arrives (design, "Measured").
- [x] 1.4 Owner approval of the contract (committee decision 3).

## 2. Service

The service half of T2 is written first and must be green before task 3.1.

- [ ] 2.1 Interest registry: per-socket declarations replaced whole, holder counts per owner and Desk target, release on hide and socket close, rejection of malformed declarations. Test it exhaustively over two sockets, two owners, visible, hidden and closed, and a generation bump.
- [x] 2.2 Focused observer per held owner:
  - the enriched lists every 5 s, with no overlap and the lease and generation fence;
  - per-socket records of the lists last sent in replies to marked calls (`focused_observation`), and only those;
  - `world_focused_changed` to a holder whose record differs, leaving out activity times and `panes[].scroll`.

  Write the service cases from the design first, with two browser sockets and two simulated hosts. They include a one-off list call from another caller, which must not suppress a notice.
- [x] 2.3 Activity cache and `world_agent_activity`: today's reading limits; `agent.list` reading the cache while it's fresh; the whole map on change, to holders only, never before a reading.
- [ ] 2.4 Advertise `world_shared_acquisition`. Send `world_connections_changed` on profile changes, connection state or generation changes, and socket open or close.

Focused registry and catalogue notices are implemented in the observer/notices
part. Task 2.1 stays open for Desk target reference counts; task 2.4 stays open
until the complete focused and Desk paths can advertise the capability together.
Owner approval (1.4) is recorded in the implementation brief for merged #551.

## 3. Browser

- [ ] 3.1 Keep the metadata timer only when the hello lacks the capability; keep the update check, reconnection and return-to-page catch-up. Mark the focused re-list's four list calls with `focused_observation: true` on the frame, and no other call.
- [ ] 3.2 Handle the notices, admitted only for ready owners with the matching generation:
  - `world_focused_changed`: a scoped re-list;
  - `world_connections_changed`: `bridge.status`, one in flight and one queued.

  Retry a failed catalogue fetch or held re-list once per period until it succeeds (design D7).
- [x] 3.3 Keep the latest recency time per pane, terminal, agent and session, from `agent.list` and from pushes, and join it into panes. Status agreement still gates `state_change_seq` only.
- [ ] 3.4 Declare interest: the active connection plus Inspector owners, which hold and release through the store; an empty set when hidden; again after a generation is admitted.
  - Re-list on each new hold: an admitted Inspector conversation, and every held owner when the page is shown.
  - Add the T2 cases: an Inspector's hold declares its host and receives its recency, and a preview of an already-closed tab is removed.
- [ ] 3.5 Flip every T2 expected failure to a normal test.

## 4. Desk

- [ ] 4.1 Service screen and receipt watches: holder counts, per-host queues, `world_desk_reads` in read order, and no placeholder. Write the two-browser tests first.
- [ ] 4.2 When the hello advertises `world_shared_acquisition`, Desk declares its chosen targets with `world.desk.observe` instead of reading them, and releases them on hide and close. Without it, Desk keeps its own 4 s and 20 s reads.
- [ ] 4.3 Update the Desk browser fixture and the Desk tests that count reads, and cover the fallback without the capability.

## 5. Evidence and documentation

- [ ] 5.1 Map the new tests in `verification/coverage.json` (Q04, Q15, Q24) and run the complete verification gate.
- [ ] 5.2 Update the architecture and knowledge-map entries that describe polling. Add a changelog fragment for the lower idle cost.
