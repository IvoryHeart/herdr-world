## ADDED Requirements

### Requirement: Current caller location

World SHALL resolve a verified CLI caller's current pane, tab and room from its
runtime, using launch-time IDs only as lookup aliases. New caller labels and
actor snapshots SHALL use that location on the qualified connection. Previously
recorded actor snapshots SHALL retain their recorded location. Resolution SHALL
preserve process-ancestry verification and original answer-recipient authority.

#### Scenario: TUI pane moved with a launch alias

- **WHEN** a local caller retains its launch-time pane ID after Herdr moves the
  pane and resolves that alias to its current location
- **THEN** `whoami`, new asks, results and Board history attribute the caller to
  the returned current pane, tab and room, with the same witnessed terminal
- **AND** history, asks and results recorded before the move keep their old actor

#### Scenario: Core terminal moved between rooms

- **WHEN** a local verified herdr-core terminal moves to another desk and room
- **THEN** new caller snapshots carry its current tab and room from World, while
  retaining the core terminal's native ID

#### Scenario: Agent resumed in another runtime

- **WHEN** an agent resumes on the destination of a move between TUI and core
- **THEN** its new requests are attributed to its verified destination connection,
  pane, tab and room, even when the process inherits a claim for the other runtime
- **AND** earlier actor snapshots retain their source location

#### Scenario: A launch alias does not verify the caller

- **WHEN** a process claims another terminal's launch alias after that terminal moves
- **THEN** the alias alone does not grant verified identity or original answer
  recipient authority
