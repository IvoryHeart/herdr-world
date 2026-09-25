## 1. Lock the deadline and identity behavior

- [ ] 1.1 Add request validation for optional `selected_connection_id` on the bridge-global `world.snapshot` method; verify missing hint compatibility and malformed/unknown hints reject without changing selected connection or invoking a fallback runtime.
- [ ] 1.2 Refactor per-host observation into one in-flight fetch per connection with a current-lease result check; verify coalesced concurrent requests do not multiply Herdr calls and a retired generation cannot write its cache.

## 2. Return useful partial observation

- [ ] 2.1 Prioritize the selected host, reserve one of four slots from inactive-host admission, and cap aggregate response at 20 seconds. Verify a deterministic 64-profile fixture returns all catalogue entries before the client timeout even when inactive hosts stall; also switch selection while background work is active and verify the incoming host queues ahead of inactive work.
- [ ] 2.2 For unfinished hosts, publish only stale, non-actionable cache or no child topology with a bounded reason; verify selected-host failure, no-cache, incompatible and disconnected cases preserve exact coverage and do not fabricate live children.
- [ ] 2.3 Admit a late result only for its original current lease and emit one coalesced invalidation when it changes observed state; verify browser fallback polls cannot stack duplicate work or loop on an unchanged result.
- [ ] 2.4 Send the selected-host hint from `WorldRuntimeStore` without adding connection identity to the global RPC envelope; verify a selected-host switch during refresh discards the earlier browser response and does not route an operation.

## 3. Prove and deliver the contract

- [ ] 3.1 Add focused service/browser checks for 64 slow profiles, selected-first scheduling, partial response, late success, reconnect, colliding IDs and World WebSocket loss; verify actionable targets only come from current-generation observations.
- [ ] 3.2 Measure serialized response size and refresh frequency in the bounded synthetic fixture; document any remaining capacity limit and verify the selected host remains usable without a second socket or operational client.
- [ ] 3.3 Update architecture/source maps and an Unreleased entry for the observation behavior, synchronize the accepted delta into current `runtime-federation`, run focused checks and `bun run check`, inspect the final diff/history, then open a ready PR with exact evidence for independent review.
