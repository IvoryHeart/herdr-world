## MODIFIED Requirements

### Requirement: Agent relations

World SHALL relate two terminals of one connection when either a spawn or a
manual Team says so, and SHALL show each relation with its evidence: its
source, whether it holds now and its system of record.

#### Scenario: Agent relations acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** A spawn is the child
  pane's Herdr metadata token `spawned_by` (the parent pane) or
  `spawned_by_terminal` (the parent terminal, which wins), which any tool may
  write; Herdr is its record while the token lives, and World's saved claim,
  recorded by the service only from a live snapshot of the connection's current
  runtime, is the record after the token is cleared. A manual Team is joined or
  left by the user in Town or Board, or by the World service's clients, and World
  is its record. A relation SHALL NOT cross connections, except a saved spawn
  claim carried by an explicit agent move between runtimes, and the service
  SHALL refuse a Team that would. A spawned desk SHALL show its parent's colour
  across such a move too. Evidence whose terminals are not in a current
  snapshot SHALL be shown as stale, and the service SHALL drop a saved claim or
  Team member once a current snapshot that lists every pane of its connection
  shows its terminals closed. Herdr SHALL remain the record for layout: a group
  moves a tab only through Herdr's own tab moves.

#### Scenario: An agent spawns another

- **WHEN** a pane carries `spawned_by` naming another pane on its connection
- **THEN** Town walls the two desks in and connects them, Board strings their cards, and the child takes its parent's colour

#### Scenario: Group desks by hand

- **WHEN** the user joins one desk to another's team in Town or Board
- **THEN** World saves the group and shows both as one team in every view

#### Scenario: A relation's host is offline

- **WHEN** the connection holding a related terminal is cached after a failure
- **THEN** the relation is kept and shown as stale

#### Scenario: A Team across connections

- **WHEN** a client asks to group terminals of two connections
- **THEN** the service refuses and saves nothing

#### Scenario: Herdr restarts

- **WHEN** a complete current snapshot no longer lists a saved claim's terminals
- **THEN** the service drops the claim, and a new stamp makes a new one

#### Scenario: A spawned agent moves to another runtime

- **WHEN** a spawned agent whose desk shows its parent's teal moves to a herdr-core room
- **THEN** the spawn line still joins it to its parent and its desk stays teal
