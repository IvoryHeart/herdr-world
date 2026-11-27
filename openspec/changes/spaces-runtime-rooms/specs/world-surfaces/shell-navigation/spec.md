## ADDED Requirements

### Requirement: List every runtime's rooms and tabs in Spaces

Spaces' navigator SHALL list every connected runtime's rooms, each room's tabs in
the runtime's order and each tab's terminals under it, with Town's runtime mark on
each room. Room and tab names SHALL be the ones World publishes and Town shows; the
navigator SHALL NOT derive its own or read them from another connection. A saved
agent layout SHALL NOT take terminals out of their rooms.

#### Scenario: A TUI room and a herdr-core room

- **WHEN** World holds a Herdr TUI room with two tabs and a herdr-core room with
  three tabs of one terminal each
- **THEN** Spaces lists two rooms with two and three tab rows, each room marked with
  its runtime, and the room and tab names equal Town's for the same World

#### Scenario: Choose a core tab

- **WHEN** the user chooses a tab of a herdr-core room in Spaces' navigator
- **THEN** Spaces shows that tab's agent, or its first terminal, and sends nothing
  to herdr-core; choosing an agent or terminal row opens it as before
