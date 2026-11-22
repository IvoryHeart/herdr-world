# World integrations

## Purpose

Define the user-facing integrations contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Read-only integrations registry over existing owners

World SHALL expose one Integrations screen and read-only registry for runtime
connections, local harness skills, Sources, metrics and vault availability.
Rows SHALL project their existing owner's status and control route, retaining
connection ID and generation for runtime controls. Reading the registry SHALL
NOT install, enable or start integrations. A failing owner SHALL omit its rows
without hiding healthy owners; source refresh remains owned by Sources.

#### Scenario: One owner fails during registry observation

- **WHEN** a provider cannot supply its integration status
- **THEN** other owners' rows remain available and the failure grants no fallback
  control authority over another connection or provider

### Requirement: Private named integration vault

Integration tokens SHALL remain in the service's private named vault. Browser
status SHALL expose only supported secret names, labels and their consumers,
never stored values. The file backend SHALL use atomic replacement and private
permissions, refuse unsafe read targets and preserve supported legacy Jira-token
reads across format migration. An unreadable vault SHALL report that tokens
must be set again, and a closed storage owner SHALL refuse further writes.

#### Scenario: Legacy token or unavailable vault

- **WHEN** the vault contains the old Jira token format or cannot be read safely
- **THEN** the old supported token can be used and rewritten in the named format,
  or status explains unavailability without disclosing a token value
