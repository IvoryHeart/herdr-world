## MODIFIED Requirements

### Requirement: Local Settings integration management

Settings → Agent integrations SHALL extend World's state, version and path
beside Herdr's from the delivered local service host to each qualified SSH host,
with Install, Update and Remove. World SHALL run a remote installer only through
that host's current qualified connection; unreachable hosts SHALL retain stale
rows without actions. Install and uninstall SHALL remain operator-only and
agent-originated calls SHALL remain denied.

#### Scenario: Install from local Settings
- **WHEN** the operator chooses Install for a supported local harness
- **THEN** the local World row reports the installed release's integration
  and Herdr's integration remains unchanged

#### Scenario: An agent tries to install
- **WHEN** an agent invokes a World integration install or uninstall verb
- **THEN** admission refuses it before filesystem mutation

#### Scenario: Install on an SSH host
- **WHEN** the operator installs an integration on an SSH host from Settings
- **THEN** only that host changes, through its qualified connection, and its row
  reports the result

#### Scenario: Unreachable host
- **WHEN** an SSH host is offline
- **THEN** its rows show the last known state as stale and offer no actions

## ADDED Requirements

### Requirement: Qualified integration refresh on upgrade

The remaining SSH/update and Herdr-upgrade integration SHALL refresh only
World integrations already installed and outdated on that qualified host,
without installing a new remote integration. Delivered local installer and
World-update discovery SHALL retain the current capability's removal preferences
and opt-out rules.

#### Scenario: Upgrade with one remote integration installed
- **WHEN** a qualified host is upgraded with an outdated `claude` integration and
  no `codex` integration
- **THEN** `claude` is reinstalled at the new version and `codex` stays not installed
