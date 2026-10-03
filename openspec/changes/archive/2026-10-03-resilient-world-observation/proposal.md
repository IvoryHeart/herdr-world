## Why

`world.snapshot` waits for every managed host before returning one response. At the 64-profile catalogue limit, four-at-a-time five-second host calls can exceed the browser's 30-second RPC timeout and withhold an otherwise healthy selected host.

## What Changes

- Give aggregate observation a bounded response deadline and publish each completed host independently within a complete managed-host catalogue.
- Attempt the selected operational host first. Hosts that miss the deadline retain only explicitly stale, non-actionable cached topology until a later admitted refresh.
- Coalesce in-flight refreshes and reject late results from replaced runtime generations without changing the single selected operational host model.
- Preserve existing `world.snapshot` topology, coverage and connection-qualified action boundaries; add only the minimum request context needed to prioritize observation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: bound aggregate observation latency and admit partial host progress without cross-host authority.

## Impact

World snapshot scheduling/cache, browser aggregate refresh request and selected-host status presentation. No additional browser origin, per-host operational client or unbounded polling loop.
