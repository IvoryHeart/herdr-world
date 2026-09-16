## MODIFIED Requirements

### Requirement: Explicit access policy

The serving bridge SHALL default to loopback and require explicit host admission for non-loopback
binding. Host, Origin, and CSP policy SHALL remain distinct from optional password authentication.
Native saved-machine traffic SHALL pass through that serving bridge and SHALL NOT require a
browser-reachable listener, browser password, Host admission, Origin admission, or CSP destination
on each saved machine. Explicit direct World bridge profiles SHALL retain their current destination
and origin policy.

#### Scenario: Password-protected connection

- **WHEN** a serving or direct bridge requires a password
- **THEN** unauthenticated protected traffic is rejected and admitted clients receive bounded
  sessions retained by the browser in tab-scoped storage

#### Scenario: Browser uses a native saved machine

- **WHEN** an admitted browser selects a Herdr saved machine exposed by its serving bridge
- **THEN** HTTP and WebSocket traffic stays on the serving bridge origin and the browser makes no
  direct request to the saved machine or Herdr integration surfaces

#### Scenario: Browser uses a direct bridge profile

- **WHEN** an admitted browser selects an explicitly configured direct World bridge origin
- **THEN** the serving page's CSP and the target bridge's Host, Origin, and authentication policy are
  enforced as before and the browser discovers every qualified runtime advertised by that gateway

#### Scenario: Android connects to an aggregate gateway

- **WHEN** the Android client connects to one World gateway profile that advertises Local and saved
  machine runtimes
- **THEN** the client discovers and operates those qualified runtimes through that one profile
  without separate URLs for the gateway's saved machines

## ADDED Requirements

### Requirement: Saved-machine browser boundary

The bridge SHALL expose only the bounded opaque machine identity, display label, state, capability,
and runtime data needed by World. It SHALL NOT expose credentials, connection targets, remote
executable or session details, Herdr transport controls, or a general Herdr command surface.
Browser operations SHALL target an already admitted opaque runtime ID and a narrow allow-listed
World operation.

#### Scenario: Browser supplies transport details

- **WHEN** a browser request supplies a profile target, session, remote executable, credential,
  transport option, or shell command instead of an admitted runtime ID and allow-listed operation
- **THEN** the bridge rejects it without invoking Herdr transport control or modifying Herdr's
  machine catalogue

#### Scenario: Browser invokes an arbitrary Herdr method

- **WHEN** a browser request names a Herdr method that has no corresponding allow-listed World
  operation
- **THEN** the bridge rejects it without forwarding the request to Local or a saved machine

#### Scenario: Serving bridge is exposed beyond loopback

- **WHEN** the operator enables non-loopback access to a serving bridge that aggregates native
  machines
- **THEN** the settings surface states that an admitted browser receives terminal-equivalent access
  to every enabled native machine exposed by that bridge
