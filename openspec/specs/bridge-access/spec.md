# Bridge access

## Purpose

Maintain the browser command and access boundary. See
[architecture](../../../docs/ARCHITECTURE.md), [deployment](../../../docs/DEPLOYMENT.md), and
`server/src/index.ts`.

## Requirements

### Requirement: Narrow command exposure
The World service SHALL expose only its documented browser RPC and resource operations, validate
typed parameters and connection identity, and revalidate the selected runtime generation before
forwarding an operation or publishing its result.

#### Scenario: Unsupported command
- **WHEN** a browser submits an unknown method or malformed parameters
- **THEN** the service rejects it without forwarding it to Herdr or invoking a host operation

### Requirement: Explicit access policy
World SHALL default to a loopback listener and SHALL use the Roamgate-derived trusted-single-user
boundary. Loopback listeners SHALL not require login. Managed non-loopback service installation
SHALL require a generated login token or configured password. World SHALL not require users to
configure bridge Host allow-lists, browser Origin allow-lists or cross-origin connection CSP entries.

#### Scenario: Local application
- **WHEN** World runs with its default loopback listener
- **THEN** the browser can open the same-origin application without connection-policy setup

#### Scenario: Managed non-loopback service
- **WHEN** World installs a service that listens beyond loopback
- **THEN** it creates or uses an authentication secret and unauthenticated protected traffic is
  rejected

#### Scenario: Password-protected connection
- **WHEN** a non-loopback World service requires a configured password
- **THEN** unauthenticated protected traffic is rejected and an admitted browser receives a bounded
  authenticated session

#### Scenario: Remote Herdr over SSH
- **WHEN** a loopback World service connects to a remote Herdr using a saved SSH profile
- **THEN** the browser continues to use the one World origin without learning remote socket paths,
  SSH credentials or another bridge URL
