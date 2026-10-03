## MODIFIED Requirements

### Requirement: Runtime authority
Herdr SHALL own structural topology, agent lifecycle and terminal streams. One World service SHALL
own the saved connection catalogue and SHALL isolate each local or SSH Herdr connection in its own
runtime, transport, subscription, cache and reconnect generation. The browser SHALL communicate
with that World service rather than connecting to independently deployed bridges.

#### Scenario: One host becomes unavailable
- **WHEN** one managed connection loses connectivity
- **THEN** other hosts remain usable and cached topology from the failed host is stale without
  admitting control

#### Scenario: Browser loses the World service
- **WHEN** the browser disconnects from World or aggregate observation fails
- **THEN** every retained host observation becomes stale and non-actionable until a newly admitted
  snapshot restores it

#### Scenario: Continuous aggregate invalidation
- **WHEN** topology invalidations arrive faster than an aggregate snapshot round trip
- **THEN** World keeps at most one browser refresh in flight, admits its current-generation result,
  and then services one coalesced follow-up refresh

#### Scenario: User disconnects a connection
- **WHEN** a user disconnects or removes a managed profile
- **THEN** World stops only its runtime and transport without stopping that Herdr server, session,
  workspace or agent

#### Scenario: A second bridge targets the same runtime
- **WHEN** another managed profile or World process attempts to own the same Herdr client socket
- **THEN** it is rejected before the runtimes can compete for terminal attachment ownership

#### Scenario: SSH transport cannot authenticate
- **WHEN** an SSH profile fails host-key or noninteractive authentication checks
- **THEN** that profile reports an actionable bounded failure and World does not retry the request
  against another profile

### Requirement: Qualified admission
The service and client SHALL qualify snapshots, events, actions, resources and terminal sessions by
connection and runtime generation, and SHALL require compatible capabilities before dispatch.
The browser SHALL maintain exactly one selected operational connection. Aggregate observation MAY
describe every managed runtime, but a mutation, resource request or terminal attachment SHALL be
admitted only when its target belongs to the selected connection and its current runtime generation.
Selecting an observed entity SHALL NOT change the operational connection; host activation SHALL be
an explicit use of the existing managed-connection workflow.

#### Scenario: Colliding native identifiers
- **WHEN** two hosts contain the same native pane identifier
- **THEN** an action for one host is sent only to that host and never retried on the other

#### Scenario: Replaced runtime
- **WHEN** a saved profile reconnects or is replaced while a request or stream remains in flight
- **THEN** results from the retired generation cannot update or control the replacement runtime

#### Scenario: Unsupported protocol
- **WHEN** a host reports an unsupported or malformed Herdr terminal protocol or misses required
  capabilities
- **THEN** World rejects terminal attach and control for that host without blocking profile
  management or compatible hosts

#### Scenario: Select an entity on an inactive ready host
- **WHEN** a user selects an observed entity whose ready host is not the selected operational
  connection
- **THEN** World preserves its bounded observational detail but does not dispatch an operation or
  change the selected connection

#### Scenario: Explicitly activate another host
- **WHEN** a user explicitly activates another managed host
- **THEN** World advances through the existing selected-connection lifecycle, retires scoped
  requests and terminals from the outgoing lease, and admits new operations only after the target
  host and runtime generation are current

## ADDED Requirements

### Requirement: Managed connection catalogue
World SHALL provide one UI-managed catalogue of local and SSH Herdr profiles. A user SHALL be able
to add, test, connect, disconnect, edit and remove profiles without installing a remote World or
Roamgate web service. SSH profiles SHALL use the service user's OpenSSH configuration and SHALL not
store passwords, private keys, passphrases or arbitrary SSH options.

#### Scenario: Add an SSH host
- **WHEN** a user saves a valid OpenSSH alias or `user@host` and the remote Herdr sockets are ready
- **THEN** World establishes the connection and exposes its workspaces, agents, terminals and
  supported resources through the same application

#### Scenario: Several hosts are connected
- **WHEN** two or more compatible profiles are ready
- **THEN** the service keeps their isolated runtimes and qualified observations connected
  concurrently while each browser presents and operates exactly one selected profile
