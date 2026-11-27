## ADDED Requirements

### Requirement: Compatible resident appearance records

A resident record SHALL carry an optional `appearance` with `profile_id`,
`look` and `color`, read while the agent was live and written at move-in.

#### Scenario: Resident appearance compatibility

- **WHEN** World reads or writes resident appearance
- **THEN** World SHALL read it leniently: a missing record reads as `null`, and a part
  that is missing or invalid (a look or colour from another build, a profile
  ID that is not a valid name) reads as `null` without rejecting the resident.
  Writing it SHALL need no migration of existing residents. When reading an
  agent's appearance fails, World SHALL keep the last appearance read while it
  lived; with no reader at all it SHALL record `null`.

#### Scenario: Older resident record

- **WHEN** World reads a resident written before appearances were kept
- **THEN** the resident lists normally with `appearance: null`

#### Scenario: Look from another build

- **WHEN** a stored appearance holds a look this build cannot parse
- **THEN** the resident lists with that look as `null` and its other
  appearance fields intact
