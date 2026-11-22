## ADDED Requirements

### Requirement: Hosts filter lists machines

The Hosts filter SHALL list one row per machine, where a machine is this
computer or one exact SSH destination, the same identity Town uses for its
machine buildings; a connection with no profile type SHALL be a machine of its
own. Each row SHALL be named by the machine's first runtime in catalogue order
and SHALL show one lifecycle state when all of its runtimes share it, otherwise
how many of its runtimes are in each state other than ready. Checking or
unchecking a row SHALL show or hide every runtime of that machine. The top bar
and the phone's corner menu SHALL show the same rows and change the same
selection.

The selection SHALL remain stored as connection IDs. A stored selection naming
any runtime of a machine SHALL show the whole machine. The filter SHALL stay
view-only: every operation SHALL remain qualified by its own connection ID and
generation, and per-runtime state SHALL remain in Manage connections.

#### Scenario: One machine with two runtimes

- **WHEN** this computer runs a Herdr TUI connection and a herdr-core
  connection and the user opens Hosts
- **THEN** one row names this computer with a summary of both runtimes' states
- **AND** unchecking it hides both runtimes' rooms from Town and Board

#### Scenario: A selection saved per connection

- **WHEN** a stored Hosts selection names only a machine's Herdr TUI connection
- **THEN** the machine's row is checked and its herdr-core rooms are shown too,
  without rewriting the stored selection
