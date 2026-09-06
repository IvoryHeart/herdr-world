# Runtime federation

## Purpose

Preserve host-local runtime authority and qualified actions. See
[architecture](../../../docs/architecture.md) and [federation](../../../docs/federation.md).

## Requirements

### Requirement: Runtime authority
Herdr SHALL own structural topology, agent lifecycle and terminal streams. Each bridge
SHALL target exactly one selected Herdr runtime; federation SHALL occur in the browser.

#### Scenario: One host becomes unavailable
- **WHEN** one bridge loses connectivity
- **THEN** other hosts remain usable and cached topology from the failed host is stale
  without admitting control

### Requirement: Qualified admission
The client SHALL qualify actions and terminal sessions by host and connection generation,
and require compatible capabilities before dispatch.

#### Scenario: Colliding native identifiers
- **WHEN** two hosts contain the same native pane identifier
- **THEN** an action for one host is sent only to that host and never retried on the other

#### Scenario: Unsupported protocol
- **WHEN** a host reports a terminal protocol other than 20, a malformed protocol, or
  missing required capabilities
- **THEN** the client rejects terminal attach and control for that host
