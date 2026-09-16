## MODIFIED Requirements

### Requirement: Explicit access policy

The serving bridge SHALL default to loopback and require explicit host admission for non-loopback
binding. Host, Origin, and CSP policy SHALL remain distinct from optional password authentication.
SSH-backed Herdr traffic SHALL pass through that serving bridge and SHALL NOT require a World HTTP
listener, browser password, Host admission, Origin admission, or CSP destination on each remote
machine. Explicit direct World bridge profiles SHALL retain their current destination and origin
policy. Remote connection CRUD, Herdr profile discovery/import, and target/session disclosure SHALL
reuse the existing local-management boundary and require the request's actual TCP peer to be
loopback; an admitted remote runtime session or configured password SHALL NOT grant that authority.

#### Scenario: Password-protected connection

- **WHEN** a serving or direct bridge requires a password
- **THEN** unauthenticated protected traffic is rejected and admitted clients receive bounded
  sessions retained by the browser in tab-scoped storage

#### Scenario: Browser uses an SSH-backed runtime

- **WHEN** an admitted browser selects a remote Herdr runtime exposed by its serving bridge
- **THEN** HTTP and WebSocket traffic stays on the serving bridge origin and the browser makes no
  direct request to the remote machine, its Herdr socket, or the SSH-backed connection

#### Scenario: Browser uses a direct bridge profile

- **WHEN** an admitted browser selects an explicitly configured direct World bridge origin
- **THEN** the serving page's CSP and the target bridge's Host, Origin, and authentication policy are
  enforced as before and the browser discovers every qualified runtime advertised by that gateway

#### Scenario: Android connects to an aggregate gateway

- **WHEN** the Android client connects to one World gateway profile that advertises Local and
  SSH-backed Herdr runtimes
- **THEN** the client discovers and operates those qualified runtimes through that one profile
  without separate URLs for the remote machines

## ADDED Requirements

### Requirement: Remote connection and adapter boundary

The bridge SHALL expose a narrow, actual-loopback local-management surface and a separate bounded
runtime surface. Connection management MAY accept a validated label, OpenSSH target or alias, an
optional named Herdr session selector, and enabled state; omitting the session SHALL select Herdr's
default. It SHALL NOT accept or expose passwords, private keys, arbitrary SSH options, executable
paths, user-supplied remote commands, shell programs, shell text, or upload destinations. Routine
runtime descriptors SHALL expose only opaque identity, label, state, generation, capabilities, and
World runtime data. Browser runtime operations SHALL target an admitted opaque runtime-binding ID
and an allow-listed World operation.

#### Scenario: Local-management user edits a connection

- **WHEN** a request from an actual loopback TCP peer passes Host and Origin checks and submits
  bounded fields through the explicit remote-connection settings surface
- **THEN** the bridge validates and persists those fields, retires any changed live generation, and
  does not disclose credential material or accept a user-supplied shell command

#### Scenario: Remote admitted user edits a connection

- **WHEN** a non-loopback browser presents a valid runtime session or password and requests
  connection CRUD, Herdr profile discovery/import, or target/session details
- **THEN** the bridge rejects it because runtime admission does not grant local-management authority

#### Scenario: Local settings discover Herdr profiles

- **WHEN** an actual loopback TCP peer passes Host and Origin checks and opens connection settings
- **THEN** the bridge may return bounded Herdr import candidates and accept explicit import actions
  without exposing credentials, arbitrary SSH settings, commands, or unrelated profile metadata

#### Scenario: Runtime request supplies transport details

- **WHEN** a snapshot, command, terminal, or upload runtime request supplies an SSH target, session,
  connection option, executable, credential, remote path, or shell command instead of an admitted
  runtime ID and allow-listed operation
- **THEN** the bridge rejects it without starting transport, modifying a connection, or forwarding
  the request to Herdr

#### Scenario: Browser invokes an arbitrary Herdr method

- **WHEN** a browser request names a Herdr method that has no corresponding allow-listed World
  operation
- **THEN** the bridge rejects it without forwarding the request to Local or a remote runtime

#### Scenario: Browser attempts a general SSH proxy

- **WHEN** a browser asks the bridge to connect to an unpersisted target, relay arbitrary bytes, or
  run a remote command
- **THEN** the bridge rejects the request and exposes no general transport endpoint

#### Scenario: Serving bridge is exposed beyond loopback

- **WHEN** the operator enables non-loopback access to a serving bridge with enabled remote
  connections
- **THEN** the settings surface states that an admitted browser receives terminal-equivalent access
  to Local and every enabled connection exposed by that bridge

#### Scenario: Connection details appear in routine output

- **WHEN** the bridge serializes runtime snapshots, model events, diagnostics, or ordinary logs
- **THEN** OpenSSH targets, sessions, source Herdr profile IDs, usernames, agent socket paths,
  environment values, and credential-shaped data are omitted or redacted
