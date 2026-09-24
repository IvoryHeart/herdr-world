## Why

Office and Graph currently derive separate, presentation-specific hierarchies from the same
runtime snapshots, and Graph treats spaces as roots even though hosts are the stable ownership and
failure boundary. A shared World model will give every theme one authoritative hierarchy while
allowing each theme to interpret that hierarchy visually.

## What Changes

- Introduce one pure World model derived from configured host profiles and admitted Herdr
  snapshots.
- Define the current hierarchy as host → space → agent or terminal, with agents and unattached
  shells represented as sibling leaf kinds backed by stable pane and terminal references.
- Make Graph render hosts as its primary nodes and connect each presented space to its exact owning
  host without merging equal labels across hosts.
- Derive Office and Graph from the shared model while retaining their existing theme-specific
  layout, actions, presentation bounds, and terminal ownership.
- Keep the parent relationship extensible so a future authoritative agent relationship can place a
  subagent beneath its parent without guessing from labels, paths, processes, or timing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: Require one shared host-qualified World hierarchy across themes and a host-first
  Graph interpretation.

## Impact

The change affects the browser-owned World runtime adapter, shared projection types, Office and
Graph projections, Graph layout and semantic navigation, tests, and current World documentation.
It adds no bridge route, Herdr protocol field, runtime owner, external dependency, or cross-host
project identity.
