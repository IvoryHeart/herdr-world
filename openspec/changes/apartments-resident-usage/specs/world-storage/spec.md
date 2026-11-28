## ADDED Requirements

### Requirement: Resident usage agent IDs

A resident record SHALL carry optional `usage_agent_ids`: the agent IDs
`world.usage.analytics` counted the agent under (group `agent`) while World
watched it, newest last, at most 8, each a non-empty string of at most 100
characters.

#### Scenario: Resident usage identity and compatibility

- **WHEN** World reads or writes resident usage IDs
- **THEN** They SHALL be the IDs of the resident's own harness session
  only: another session in the same terminal (after `/clear`, or a new run
  after the program left) SHALL NOT inherit them, while runs of the same
  session (resumed in that terminal) add their IDs. When a session moves in again and replaces its earlier record, the earlier
  record's IDs SHALL be kept before the new ones. World SHALL read the field
  leniently: a missing or malformed list reads as empty and bad entries are
  dropped, without rejecting the resident. Writing it SHALL need no migration.

#### Scenario: Older resident record

- **WHEN** World reads a resident written before usage IDs were kept
- **THEN** the resident lists normally with no usage agent IDs

#### Scenario: Another session in a reused terminal

- **WHEN** session A ends into the shell, session B starts in the same
  terminal, and the terminal closes
- **THEN** the resident is session B with only B's usage agent ID

#### Scenario: Resumed session moves in again

- **WHEN** a resident's session runs again in a new terminal and ends
- **THEN** the one resident record holds the earlier run's ID and then the
  new run's ID

### Requirement: Found residents keep watched usage

A resident found in a harness's history whose session World watched at
work until it left into a shell (its terminal still open) SHALL carry that
session's usage agent IDs, also when a later run has since taken that
terminal, and only when World knows the IDs are that session's. World keeps
them in memory until the census finds the session, so a World restart in
between forgets them. A later census refresh of a found record SHALL keep
the IDs it has.

#### Scenario: Agent left into a shell

- **WHEN** World watched session A at work, A's program leaves while its
  terminal stays open, and the census finds A in its harness's history
- **THEN** the found resident carries A's usage agent IDs, and a found
  session World never watched carries none

#### Scenario: Runs that follow each other in one shell terminal

- **WHEN** World watched session A at work in a shell terminal, A left,
  session B then ran and left in that terminal, and the census finds both
- **THEN** A carries A's usage agent IDs and B carries B's
