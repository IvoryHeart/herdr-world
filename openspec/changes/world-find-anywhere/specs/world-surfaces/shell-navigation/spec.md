## ADDED Requirements

### Requirement: Find any agent from the command box

The command box SHALL find World's agents, rooms, tables and terminals on every
connected runtime and machine from every view, reading the one World object within
the Hosts filter; Spaces SHALL NOT keep its own agent list beside it. Enter SHALL open
a result on its own connection and runtime generation, never another; a second
action SHALL show it in Town, Board or Desk.

#### Scenario: Find an agent by any of its facts

- **WHEN** the user types part of an agent's name, room, table, machine, runtime,
  harness, status word or task summary
- **THEN** the agent is listed with its harness icon in its tab colour, its name,
  place, runtime and status mark, without a server request per keystroke and within
  100 ms for 300 agents

#### Scenario: Open an agent on another connection

- **WHEN** Spaces shows connection A and the user finds an agent on Herdr TUI
  connection B and presses Enter
- **THEN** World focuses B's exact workspace, tab and pane at B's current runtime
  generation and shows Spaces on B

#### Scenario: Open a herdr-core terminal

- **WHEN** the user presses Enter on a herdr-core terminal World watches
- **THEN** it opens in World's window Terminal tab, as Spaces shows Herdr TUI
  workspaces only

#### Scenario: Find an agent on an offline host

- **WHEN** the user finds an agent whose host is offline, stale or reconnecting and
  presses Enter
- **THEN** the result stays listed with its mark, World says why it cannot open it,
  and no other connection is focused

#### Scenario: Show instead of open

- **WHEN** the user is in Town, Board or Desk and presses Shift+Enter on a result, or
  its row's Show button
- **THEN** the view selects that node as clicking it there does, and the view does
  not change
