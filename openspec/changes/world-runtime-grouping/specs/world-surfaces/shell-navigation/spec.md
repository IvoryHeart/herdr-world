## ADDED Requirements

### Requirement: One runtime grouping for every view

World SHALL keep one Group runtimes setting, in Settings under This World:
one per machine (the default) or one per runtime, where a machine is the
Hosts filter's identity. Town's buildings, the common navigator and Desk's
other-host summaries SHALL each derive their grouping from this one value
through one shared derivation over World's host catalogue.

#### Scenario: Runtime grouping acceptance rules

- **WHEN** World stores, loads or applies Group runtimes
- **THEN** the World service SHALL store the value in its UI settings and
  push changes to every connected browser; a browser MAY keep a read-through
  copy for the first paint and SHALL adopt the service's value when it
  arrives. While the service holds no value, a browser whose earlier Town
  buildings choice was one per runtime SHALL send that choice once; once the
  service holds a value, no browser's earlier choice SHALL replace it. A
  failed save SHALL restore the last value the service confirmed. Grouping
  SHALL stay presentation only: hosts, rooms, agents and operations SHALL
  remain qualified by their own connection ID and generation, and a group's
  state SHALL summarise its runtimes' lifecycle states without hiding a stale
  or failed runtime.

#### Scenario: One machine with two runtimes, grouped per machine

- **WHEN** this computer runs a Herdr TUI connection and a herdr-core
  connection and Group runtimes is one per machine
- **THEN** Town shows one building for it, the navigator shows one heading for
  it with a Herdr TUI row and a herdr-core row beneath, and Desk counts it as
  one host in its other-host summaries
- **AND** selecting a workspace under either row acts on that runtime's own
  connection and generation

#### Scenario: Grouped per runtime

- **WHEN** the user sets Group runtimes to one per runtime
- **THEN** Town, the navigator and Desk each show the two runtimes apart, in
  every open browser, without a reload

#### Scenario: An earlier Town choice moves once

- **WHEN** a browser had chosen one building per runtime before this setting
  existed and the World service holds no Group runtimes value
- **THEN** the browser keeps one per runtime and saves it for every browser
- **AND WHEN** another browser that also holds an earlier choice connects later
- **THEN** it adopts the service's value and sends nothing
