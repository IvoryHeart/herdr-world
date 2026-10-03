## MODIFIED Requirements

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
Before processing privileged browser HTTP or WebSocket traffic, World SHALL automatically require
the browser Origin authority to equal the request Host authority. A loopback listener SHALL reject a
non-loopback Host authority unless it equals the authority of one explicitly configured public
HTTP(S) origin and the browser Origin equals that exact origin. Originless native clients MAY
connect subject to the listener and authentication policy. World's authenticated session cookie
SHALL use a World-owned name that does not replace Roamgate's cookie on the same hostname.

#### Scenario: Local application
- **WHEN** World runs with its default loopback listener
- **THEN** the browser can open the same-origin application without connection-policy setup

#### Scenario: Cross-origin browser request
- **WHEN** a browser submits a privileged HTTP or WebSocket request whose Origin and Host
  authorities differ
- **THEN** World rejects it before processing the resource operation or RPC

#### Scenario: Rebound loopback authority
- **WHEN** a loopback listener receives a browser request using a non-loopback Host authority
- **THEN** World rejects it without requiring a configured Host allow-list

#### Scenario: Authenticated loopback reverse proxy
- **WHEN** an independently authenticated HTTPS reverse proxy forwards the exact configured public
  Origin and Host authority to a loopback World listener
- **THEN** World admits its privileged HTTP resources and WebSocket transport while rejecting other
  non-loopback authorities

#### Scenario: Managed non-loopback service
- **WHEN** World installs a service that listens beyond loopback
- **THEN** it creates or uses an authentication secret and unauthenticated protected traffic is
  rejected

#### Scenario: Password-protected connection
- **WHEN** a non-loopback World service requires a configured password
- **THEN** unauthenticated protected traffic is rejected and an admitted browser receives a bounded
  authenticated session

#### Scenario: World and Roamgate share a hostname
- **WHEN** authenticated World and Roamgate services run on different ports of the same hostname
- **THEN** logging in to either service does not overwrite the other service's session cookie

#### Scenario: Remote Herdr over SSH
- **WHEN** a loopback World service connects to a remote Herdr using a saved SSH profile
- **THEN** the browser continues to use the one World origin without learning remote socket paths,
  SSH credentials or another bridge URL

## REMOVED Requirements

### Requirement: Owned restart boundary
**Reason**: The former requirement governed browser-editable settings that rewrote a separate
Herdr Web bridge listener. The Roamgate-derived service owns its listener lifecycle directly and
does not expose the old Host/Origin/CSP configuration workflow.

**Migration**: Configure the World service with its supported CLI or environment settings and use
the in-product connection catalogue only for downstream Herdr profiles.
