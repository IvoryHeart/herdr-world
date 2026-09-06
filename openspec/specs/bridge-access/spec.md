# Bridge access

## Purpose

Maintain the browser command and access boundary. See [federation](../../../docs/federation.md),
`web/src/commands.ts` and `bridge/src/web_bridge.rs`.

## Requirements

### Requirement: Narrow command exposure
The bridge SHALL allow-list browser commands and validate typed parameters before forwarding.

#### Scenario: Unsupported command
- **WHEN** a browser submits a method outside ALLOWED_COMMANDS to /api/command
- **THEN** the bridge rejects it without forwarding it to Herdr

### Requirement: Explicit access policy
The bridge SHALL default to loopback and require explicit host admission for non-loopback binding.
Host, Origin and CSP policy SHALL remain distinct from optional password authentication.

#### Scenario: Password-protected connection
- **WHEN** a bridge requires a password
- **THEN** unauthenticated protected traffic is rejected and admitted clients receive bounded
  sessions retained by the browser in tab-scoped storage

### Requirement: Owned restart boundary
Restart-dependent network settings SHALL use a controller-owned restart boundary.

#### Scenario: Standalone development launch
- **WHEN** no controller-owned restart boundary exists
- **THEN** restart-dependent settings are read-only rather than pretending a change applied
