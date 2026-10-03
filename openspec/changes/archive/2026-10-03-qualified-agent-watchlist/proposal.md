## Why

The four views can find agents, but they cannot keep a small, explicit set of panes in view while status and topology change. Workspace pins and Graph position pins identify different things and do not solve agent triage.

## What Changes

- Add one World-service-owned, connection-qualified, bounded watchlist for live agent and terminal panes, with Pin, Unpin and Pinned only controls shared by Office, Tree and Graph.
- Keep pins attached to the exact selected connection, runtime generation and terminal-backed entity; show unavailable targets without enabling stale actions.
- Synchronize pins across browsers connected to the same World service. Pins survive browser reload and selected-host switches, and clear on service restart or runtime generation replacement.
- Admit current-generation watched panes and their workspace/tab ancestry inside the bounded service snapshot, independently of the eight browser priority hints; report any service or view omission explicitly.
- Do not change workspace pins, Graph position pins, Herdr topology, or the single selected operational host model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: add a shared visual-view watchlist and its qualification, filtering and stale-target behavior.

## Impact

An in-memory World service registry, bridge-global watchlist RPC and change invalidation, service snapshot admission and coverage, shared browser shell state, common search/filter controls and per-view projections. No disk storage or new Herdr operation. This proposal restores the user workflow deferred in issue #95 without importing the retired Rust store.
