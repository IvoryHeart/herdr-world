## Context

`WorldSnapshotService.snapshot()` currently maps all managed statuses with four concurrent host fetches and awaits the complete array. A host fetch calls `workspace.list`, `tab.list`, `pane.list` and optional `agent.list` with five-second call limits. The profile catalogue allows 64 entries; the browser's default RPC deadline is 30 seconds. Browser `WorldRuntimeStore` already coalesces aggregate invalidations and marks failed observation stale.

## Goals / Non-Goals

**Goals:** Return useful selected-host observation within the browser deadline, keep every profile represented, and preserve generation-fenced stale semantics under late host completion.

**Non-Goals:** Simultaneous operational hosts, unbounded per-host polling, streaming protocol replacement, or making cached topology actionable without a current lease.

## Decisions

### Bound the aggregate response, not every host's total work

Accept `selected_connection_id` inside the global `world.snapshot` params, validate it against the managed catalogue, and order that host first. Retain at most four concurrent host fetches and one in-flight fetch per connection. Limit inactive-host admissions to three while reserving the fourth slot for the selected host when it needs a fetch; older clients without a selected hint may use all four slots in catalogue order. On a host switch, stop admitting new inactive work until the new selected host has entered a slot; already-running work remains generation fenced. Give the request an overall 20-second deadline. At the deadline, return a complete catalogue using completed current snapshots and `fallback()` for unfinished hosts. A ready host with a cached but unfinished snapshot is explicitly stale/non-actionable in that response. This meets the browser's 30-second RPC deadline without pretending a slow host is current.

### Keep late work safe and useful

An in-flight host fetch may finish after the response. Cache it only if the original ready lease remains current and signal one coalesced world invalidation; the next request reads or refreshes that host's result. On runtime replacement, discard the old fetch. On browser disconnect, existing client behavior marks all retained entries stale. Per-host in-flight bookkeeping prevents each 15-second browser fallback poll from stacking another set of slow calls.

### Preserve the response contract

Keep `WorldSnapshotResult.connections` complete and ordered as the managed catalogue. Reuse `stale`, `actionable`, `snapshot_generation` and `snapshot_error` to describe deadline misses; no new browser connection or terminal route is introduced. A missing selected hint is accepted for older clients and uses catalogue order, but an explicitly invalid hint fails rather than defaulting to another host. The browser sends its currently selected connection as a hint without changing that selection.

## Risks / Trade-offs

- [A partial response repeats indefinitely] → Coalesce per-host work, publish invalidation only when an admitted late result changes the cache, and bound fallback polling.
- [Cache writes cross a runtime replacement] → Recheck connection ID, generation and lease at write and publication time, including after all four Herdr calls settle.
- [The selected host changes while its reserved slot is busy with the previous selection] → Queue it ahead of inactive work and return stale/non-actionable if it still misses the deadline; never attach the old host's result to the new selection.
- [The 20-second response still carries a large catalogue] → Keep existing record and view bounds, measure payload size in the 64-profile scenario and tighten the observation budget if needed without omitting profiles.

## Migration Plan

The new request hint is optional and the result envelope remains compatible. Rollback can restore the prior scheduler, though high-cardinality timeout behavior would return. Any implementation that alters the envelope requires a separate compatibility decision and updated bridge-access contract.
