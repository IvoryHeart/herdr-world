## Why

Board needs one typed registry and real memory, saved log, document and link
sources for its presentation follow-up (#1030). Issue #1016 owns data and API only.

## What Changes

- Register all eleven existing/new kinds without changing existing behavior.
- Persist revisioned new source references through the existing SQLite Board writer.
- Expose bounded project reads and shared types/list/put/delete/read RPC and CLI.
- Preserve released Apartments migrations and recover the early Board preview collision.
- Let a memory element reference a Library memory and a log its Apartments
  resident, with reader actions that open the Library and the apartment (#1221).

## Capabilities

### New Capabilities

- `world-board-elements`: registry, durable references, private bounded sources and API/CLI.

### Modified Capabilities

- `world-storage`: registered Board rows and atomic predecessor-schema upgrades.

## Impact

Shared registry, Board storage, Files consumers, service composition, RPC/CLI,
source tests, Q50 evidence and capability usage notes. No new screens, art or
plugin protocol. Memory elements may reference a Library memory and logs their
Apartments resident (#1221); the memory service and Apartments keep owning reads
and residents. Existing API examples remain in
`docs/board-elements-api.md`. The feature contracts move to deltas under the
landed OpenSpec workflow; their intended behavior is unchanged.
