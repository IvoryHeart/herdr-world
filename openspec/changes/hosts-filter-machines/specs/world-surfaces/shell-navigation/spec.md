## ADDED Requirements

### Requirement: Hosts filter lists machines

The Hosts filter SHALL list one row per machine, where a machine is this
computer or one exact SSH destination, the same identity Town uses for its
machine buildings; a connection with no profile type SHALL be a machine of its
own. Each row SHALL be named by the machine's first runtime in catalogue order
and SHALL show one lifecycle state when all of its runtimes share it, otherwise
how many of its runtimes are in each state other than ready.

#### Scenario: One machine with two runtimes

- **WHEN** this computer runs a Herdr TUI connection and a herdr-core
  connection and the user opens Hosts
- **THEN** one row names this computer with a summary of both runtimes' states
- **AND** unchecking it hides both runtimes' rooms from Town and Board

### Requirement: Hosts filter selects whole machines

Checking or unchecking a row SHALL show or hide every runtime of that machine.
The top bar and the phone's corner menu SHALL show the same rows and change the
same selection.

The selection SHALL remain stored as connection IDs. A stored selection naming
any runtime of a machine SHALL show the whole machine. The filter SHALL stay
view-only: every operation SHALL remain qualified by its own connection ID and
generation, and per-runtime state SHALL remain in Manage connections.

#### Scenario: A selection saved per connection

- **WHEN** a stored Hosts selection names only a machine's Herdr TUI connection
- **THEN** the machine's row is checked and its herdr-core rooms are shown too,
  without rewriting the stored selection

#### Scenario: Unchecking the last selected machine

- **WHEN** one machine is selected, or the only machine is shown under All
  hosts, and the user unchecks it
- **THEN** the selection is explicitly empty, the menu reads No hosts and Town
  and Board show no rooms
- **AND** the empty selection is restored on reload until the user checks a
  machine or chooses All hosts

## MODIFIED Requirements

### Requirement: Persist host filters without operational side effects

The common shell SHALL offer All hosts and an explicit set of managed hosts as view
filters, independently of connection management and operation targets. An explicit
empty set SHALL show no hosts; it SHALL NOT mean All hosts.

#### Scenario: Persist host filters without operational side effects acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** All hosts SHALL be the
  initial scope. World SHALL restore an explicitly saved filter on reload, including an empty
  one, prune removed profile identities and restore All hosts with an explanation if no saved
  identity remains. A legacy
  operational-host preference SHALL NOT silently become a restrictive filter. Filter changes SHALL
  preserve open contexts, their resource state and their pending requests. A selected visual target
  hidden by filtering SHALL no longer supply visual Actions; its open Inspector SHALL retain its
  own independently qualified actions.

#### Scenario: Upgrade from a selected-host browser
- **WHEN** the browser has an old selected-host preference and no saved multi-host filter
- **THEN** World starts with All hosts and requires explicit current admission for operational work

#### Scenario: Restore a saved filter
- **WHEN** a browser reloads with two saved filter identities and one profile has been removed
- **THEN** it retains the remaining profile in the filter without connecting or disconnecting any host

#### Scenario: Every saved filter identity was removed
- **WHEN** no identity in a saved filter remains managed
- **THEN** World restores All hosts and explains the change

#### Scenario: Filter hides the selected visual entity
- **WHEN** the filter excludes a selected entity with an open Inspector and an open visual Actions menu
- **THEN** the visual selection/menu capture clears while the Inspector remains usable under its
  own admitted context and is labelled outside the filter
