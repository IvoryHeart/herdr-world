## Why

World is meant to be one object: derived from the sources of record and shown by
every view. Today it is not. The browser builds its own World object from raw runtime
topology, Spaces keeps a second copy of that topology, and the views each work out
names, colours, groups, pins, status and attention in their own code. Most renames,
moves, reorders and launches go straight to the runtime instead of through World. The
result is the class of bug where a fix works in one view only: a tab pinned in Spaces
is not pinned on the phone, Town groups runtimes differently from the navigator, Board
colours a card through its own derivation, and the CLI shows raw labels.

[audit.md](audit.md) lists the breaks by fact, with file paths.

## What Changes

This change is a design. It adds no product code.

- A new `world-model` capability states the rule as a contract: the sources of record
  World reads, one World object derived on the service, views that only display it,
  and one write path back through World to the source of record.
- [sources.md](sources.md) lists every source of record and the facts it owns.
- [design.md](design.md) gives the target: where World is derived, how views receive
  it, the write path and what a view shows between a write and its observation,
  refusals, offline hosts, and history and undo. It also says how this fits the agent
  record (#1315), the single-model plan and the central wiring series.
- [tasks.md](tasks.md) is the migration: ordered steps of about 300 lines, each
  leaving `main` working and moving at least one fact fully onto the World path in
  every view. Grouping and colour go first.
- [write-path.qnt](write-path.qnt) is a design-stage Quint model of the write path:
  late observations, late acknowledgements, direct source changes and offline hosts.

## Capabilities

### New Capabilities

- `world-model`: World as one object; sources of record, derivation on the service,
  display-only views, the write path, offline behaviour, history and undo.

### Modified Capabilities

None. Later steps carry their own deltas for the surfaces they move.

## Impact

Documentation only: this change folder, the capability notes and a section of
`docs/ARCHITECTURE.md`. No API, storage, dependency or behaviour change. Each
migration step in [tasks.md](tasks.md) is a separate PR with its own evidence.
