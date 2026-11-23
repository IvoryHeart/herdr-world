## ADDED Requirements

### Requirement: Board zones follow Group runtimes

Board SHALL group its host zones by World's Group runtimes setting through the
same shared derivation as Town, the navigator and Desk: one zone per group,
so under one per machine a machine's runtimes share one zone, and under one
per runtime each runtime keeps its own zone.

#### Scenario: Board runtime grouping acceptance rules

- **WHEN** Board presents hosts while Group runtimes is set
- **THEN** each zone SHALL hold its group's runtimes side by side, and a zone
  with several runtimes SHALL name the machine once with a row per runtime
  showing that runtime's colour, name, counts, new-workspace action or
  recovery state. Grouping SHALL stay presentation only: each runtime's
  workspace and tab cards, saved positions, selection and operations SHALL
  remain keyed and qualified by that runtime's own connection ID and
  generation, so switching Group runtimes SHALL NOT move or forget a saved
  card. Dragging a zone SHALL move every runtime in it. A runtime that
  appears beside an already placed runtime of its group SHALL be placed next
  to that runtime's cards, not after every other zone. A zone SHALL be shown
  stale only when all its runtimes are stale, and a stale runtime's row and
  cards SHALL stay visibly stale and non-actionable.

#### Scenario: One machine with two runtimes on Board

- **WHEN** this computer runs a Herdr TUI connection and a herdr-core
  connection and Group runtimes is one per machine
- **THEN** Board shows one zone for this computer with a Herdr TUI row and a
  herdr-core row, and each row's new-workspace action creates the workspace on
  that runtime's own connection
- **AND WHEN** the user sets Group runtimes to one per runtime
- **THEN** Board shows the two runtimes as separate zones, with every card
  where it was
