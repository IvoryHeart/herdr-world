## 1. Contract and parity tests

- [x] 1.1 Write the contract: each output of the 5 s timer with its source, freshness and repair; shared acquisition with reference-counted interest; Desk watches.
- [x] 1.2 Add the browser half of T2 (`web/src/store/pollReplacement.test.ts`): two ready hosts, a simulated World service and a manual clock; new behaviour as expected failures, unchanged behaviour as guards.
- [ ] 1.3 Owner approval of the contract (committee decision 3).

## 2. Service

- [ ] 2.1 Interest registry: per-socket declarations replaced whole, holder counts per owner and Desk target, release on hide and socket close, rejection of malformed declarations; test exhaustively over two sockets, two owners, visible, hidden and closed, and a generation bump.
- [ ] 2.2 Focused observer per held owner: the enriched lists every 5 s without overlap, a digest without activity times, `world_focused_changed` on change, the lease and generation fence; write the service half of T2 first, with two browser sockets and two simulated hosts.
- [ ] 2.3 Activity cache and `world_agent_activity`: today's reading limits, the whole map on change and on declaration, `agent.list` reading the cache while observed.
- [ ] 2.4 `world_connections_changed` on profile changes, connection state or generation changes and socket open or close.
- [ ] 2.5 Verify on a disposable `herdr --session` that `pane.layout` reflects a change once its `layout.updated` arrives (design D6).

## 3. Browser

- [ ] 3.1 Remove the metadata timer; keep the update check, reconnection and return-to-page catch-up.
- [ ] 3.2 Handle `world_focused_changed` (scoped re-list) and `world_connections_changed` (`bridge.status`, one in flight and one queued), admitted only for ready owners with the matching generation; retry a failed catalogue fetch or held re-list once per period until it succeeds (design D7).
- [ ] 3.3 Keep the recency map per owner and generation, join it into panes, and ignore recency in `agent.list` replies.
- [ ] 3.4 Declare interest: the active connection plus Inspector owners, which hold and release through the store; empty when hidden; again after a generation is admitted. Add the T2 case: an Inspector's hold declares its host, which then receives its recency.
- [ ] 3.5 Flip every T2 expected failure to a normal test.

## 4. Desk

- [ ] 4.1 Service screen and receipt watches with holder counts, per-host queues and `world_desk_reads`; two-browser tests first.
- [ ] 4.2 Desk declares its chosen targets with `world.desk.observe` instead of reading them; release on hide and close.
- [ ] 4.3 Update the Desk browser fixture and the Desk tests that count reads.

## 5. Evidence and documentation

- [ ] 5.1 Map the new tests in `verification/coverage.json` (Q04, Q15, Q24) and run the complete verification gate.
- [ ] 5.2 Update the architecture and knowledge-map entries that describe polling, and add a changelog fragment for the lower idle cost.
