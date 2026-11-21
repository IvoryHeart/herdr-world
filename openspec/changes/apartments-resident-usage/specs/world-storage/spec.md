## ADDED Requirements

### Requirement: Resident usage agent IDs

A resident record SHALL carry optional `usage_agent_ids`: the agent IDs
`world.usage.analytics` counted the agent under (group `agent`) while World
watched it, newest last, at most 8, each a non-empty string of at most 100
characters. A new harness session in the same terminal SHALL add its own ID.
When a session moves in again and replaces its earlier record, the earlier
record's IDs SHALL be kept before the new ones. World SHALL read the field
leniently: a missing or malformed list reads as empty and bad entries are
dropped, without rejecting the resident. Writing it SHALL need no migration.

#### Scenario: Older resident record

- **WHEN** World reads a resident written before usage IDs were kept
- **THEN** the resident lists normally with no usage agent IDs

#### Scenario: Resumed session moves in again

- **WHEN** a resident's session runs again in a new terminal and ends
- **THEN** the one resident record holds the earlier run's ID and then the
  new run's ID
