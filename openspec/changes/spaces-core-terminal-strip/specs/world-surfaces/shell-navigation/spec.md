## ADDED Requirements

### Requirement: Switch herdr-core terminals in Spaces

While Spaces shows a herdr-core terminal, its tab strip SHALL list the live
terminals of that connection and runtime generation from the World object, grouped
by World's rooms, labelled by agent name or terminal label, the open one marked.
Choosing a tab by click or the TUI tab keys SHALL show that terminal and send nothing
to herdr-core. Navigator rows on a live core host SHALL only choose. Herdr TUI hosts
SHALL keep their strip.

#### Scenario: Choose a herdr-core agent in Spaces' navigator

- **WHEN** a live herdr-core host is listed in Spaces' navigator and the user clicks
  one of its agents
- **THEN** Spaces shows that agent's terminal, and the row offers no Herdr TUI menu,
  dragging or new workspace

#### Scenario: Switch between a core host's terminals

- **WHEN** Spaces shows a herdr-core terminal and the user clicks another tab in the
  strip, or presses the next, previous or numbered tab key
- **THEN** Spaces shows that terminal and marks its tab open, and no request is sent
  to herdr-core

#### Scenario: Terminals start and stop

- **WHEN** a terminal starts or stops on the core host while Spaces shows one of its
  terminals
- **THEN** the strip adds or drops that tab; if the open terminal stops it stays in
  the strip as gone, and Spaces moves to no other connection or runtime generation

#### Scenario: Core strip on a phone

- **WHEN** Spaces shows a herdr-core terminal on a phone
- **THEN** the strip scrolls when it overflows and hides while the host has one
  terminal, as the Herdr TUI strip does
