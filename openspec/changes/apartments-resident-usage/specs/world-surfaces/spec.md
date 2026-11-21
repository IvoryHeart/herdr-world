## ADDED Requirements

### Requirement: Apartments resident usage

The Apartments window SHALL show, under each resident in its list and in the
opened resident view, the resident's usage over the seven days Usage keeps,
summed over its usage agent IDs and worded as an agent card's line: time at
work, time waiting on you and tokens. A resident of a harness World reads no
token log of SHALL read "tokens and cost not available for this harness". A
resident with no usage agent ID, or none counted in those seven days, SHALL
read "This week: usage unknown", never zero. While the read is not in, the
line SHALL be empty. When Town is shown, activating any resident's line,
including one whose usage is unknown, SHALL close Apartments and open Usage on
Breakdown filtered to that resident; otherwise the line SHALL be text only.

#### Scenario: Resident with counted runs

- **WHEN** a resident ran twice this week under two usage agent IDs
- **THEN** its line shows the two runs' time and tokens added together

#### Scenario: Resident found in a harness history

- **WHEN** a resident World found asleep in its harness's history is listed
- **THEN** its line reads "This week: usage unknown"

#### Scenario: Opening a resident with no usage this week

- **WHEN** Town is shown and a resident whose line reads "This week: usage
  unknown" is activated
- **THEN** Breakdown opens filtered to that resident and says nothing was
  measured for it

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
