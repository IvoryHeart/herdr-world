## ADDED Requirements

### Requirement: Find any agent from the command box

The command box SHALL find World's agents, rooms, tables and terminals on every
connected runtime and machine from every view, reading the one World object whatever
the Hosts filter shows; Spaces SHALL NOT keep its own agent list beside it. Opening a
result SHALL show its terminal in Spaces on its own connection and runtime generation,
whichever runtime runs it, never another connection; choosing follows One search.

#### Scenario: Find an agent by any of its facts

- **WHEN** the user types part of an agent's name, room, table, machine, runtime,
  harness id or name (such as `Claude Code`), status word or task summary
- **THEN** the agent is listed with its harness icon in its tab colour, its name,
  place, runtime and status mark, without a server request per keystroke and within
  100 ms for 300 agents

#### Scenario: Open an agent on another connection

- **WHEN** Spaces shows connection A and the user finds an agent on Herdr TUI
  connection B and chooses it
- **THEN** World focuses B's exact workspace, tab and pane at B's current runtime
  generation and shows Spaces on B

#### Scenario: Open a herdr-core agent in Spaces

- **WHEN** the user finds a live herdr-core agent and opens it (choosing it in Spaces,
  or the open action from Town, Board or Desk)
- **THEN** World switches to Spaces and shows that agent's terminal there, on its
  connection at that connection's current runtime generation, named with its room
  and tab and marked herdr-core, as it opens a Herdr TUI agent
- **AND** a core room opens its focused terminal, else its first agent or terminal,
  and Spaces never follows the agent to another generation or connection

#### Scenario: Open a found agent over an expanded Inspector

- **WHEN** Spaces shows an expanded Inspector, or any Inspector on a phone, and the
  user finds an agent on any runtime and chooses it
- **THEN** the Inspector closes and Spaces shows the agent's terminal and its controls,
  as choosing a terminal in Spaces does

#### Scenario: Find an agent on a host the Hosts filter hides

- **WHEN** the Hosts filter shows only machine A and the user finds an agent on
  connected machine B
- **THEN** the agent is listed and choosing it opens it, because the view does not
  show B, and the row says so

#### Scenario: Find an agent on an offline host

- **WHEN** the user finds an agent whose host is offline, stale or reconnecting and
  opens it
- **THEN** the result stays listed with its mark, World says why it cannot open it,
  and no other connection is focused
