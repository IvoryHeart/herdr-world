## ADDED Requirements

### Requirement: Apartments resident usage

Apartments SHALL show, under each listed resident and in the opened
resident, its usage over the seven days Usage keeps, summed over its usage
agent IDs and worded as an agent card's line: time at work, waiting on you
and tokens. A harness World reads no token log of SHALL read "tokens and
cost not available for this harness". With none counted in those days it
SHALL read "Usage unknown" and why, never zero, and SHALL be empty while the
read is not in.

#### Scenario: Resident with counted runs

- **WHEN** a resident ran twice this week under two usage agent IDs
- **THEN** its line shows the two runs' time and tokens added together

### Requirement: Resident unknown usage says why

A resident's unknown usage SHALL name its reason: one found in its
harness's history without usage agent IDs reads "Usage unknown: World did
not see it run, only found it in its history"; another without them reads
"Usage unknown: World did not record it while it ran"; one with IDs but no
row this week reads "Usage unknown: nothing recorded this week". Breakdown
opened from a resident without IDs SHALL give the same reason.

#### Scenario: Resident found in a harness history

- **WHEN** a resident World found asleep in its harness's history is listed
- **THEN** its line reads "Usage unknown: World did not see it run, only
  found it in its history"

### Requirement: Resident usage opens Breakdown

When Town is shown, activating any resident's usage line, including one
whose usage is unknown, SHALL close Apartments and open Usage on Breakdown
filtered to that resident. Otherwise the line SHALL be text only.

#### Scenario: Opening a resident with no usage this week

- **WHEN** Town is shown and a resident whose usage is unknown is activated
- **THEN** Breakdown opens filtered to that resident and says nothing was
  measured for it
