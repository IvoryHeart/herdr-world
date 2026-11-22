## ADDED Requirements

### Requirement: Breakdown filtered to one agent

Usage's Breakdown SHALL accept a filter of one agent's usage IDs and name.
While filtered it SHALL group by agent, show only that agent's rows under its
name, replace Group by with a chip naming the agent, and total the shown rows
as "This agent". An agent with no row in the window SHALL read "Nothing
measured". Clearing the chip SHALL show every agent again.

#### Scenario: Clearing the filter

- **WHEN** Breakdown is filtered to one resident and the chip's clear button
  is pressed
- **THEN** Breakdown lists every agent with the week's total and Group by
