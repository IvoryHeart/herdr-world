## MODIFIED Requirements

### Requirement: Durable Town room placement

Town room spots SHALL use the shared Board layout and qualified workspace card
identities, preserving layout-ID inheritance and serialized persistence. Drag,
neighbour moves, Tidy and Undo SHALL share per-room authority independent of
rename, preserve fixed spots and retain native ancestry. Only TUI rooms SHALL
synchronize Spaces order on their exact connection and generation. Undo SHALL
use current layout and authority and refuse unsafe conflicts.

#### Scenario: Placement authority follows each room's runtime

- **WHEN** drag, Move before/after, Tidy or Undo evaluates a room
- **THEN** a live TUI room can move when its owning connection can reorder workspaces
- **AND** a live core room, including an app space, can move using only its World spot
- **AND** stale or unavailable rooms stay in place, including when another room
  would overlap them; other movable rooms arrange clear of their spots
- **AND** World spots stay within the room's building without moving native
  workspaces or agents

#### Scenario: Another device edits room placement

- **WHEN** one browser saves positions or attempts Undo after another edit
- **THEN** other devices adopt the saved layout and a conflicting conditional
  Undo reports the conflict without silently restoring obsolete positions

#### Scenario: A core app space leads a mixed machine building

- **WHEN** a machine building has a core app space first in reading order and
  live TUI rooms, and the user chooses Tidy rooms then Undo
- **THEN** Tidy rearranges the rooms without a rename refusal and Undo restores
  their spots; only the TUI rooms synchronize Spaces order
- **AND** One per runtime applies the same authority and Undo rules to each building

#### Scenario: A room is unavailable during placement or before Undo

- **WHEN** Tidy, Undo, a drag or a neighbour move encounters an immovable room
- **THEN** that room retains its spot and other moved rooms remain clear of it
- **AND** Tidy and Undo name skipped rooms and their current unavailability reasons
- **AND** a fully movable building produces no skipped-room warning
