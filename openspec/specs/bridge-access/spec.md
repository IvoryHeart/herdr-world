# Bridge access

## Purpose

Maintain the browser command and access boundary. See
[architecture](../../../docs/ARCHITECTURE.md), [deployment](../../../docs/DEPLOYMENT.md), and
`server/src/index.ts`.

## Requirements

### Requirement: Registered browser and agent verbs with actor policy

Browser RPC methods, agent CLI commands and browser pull-request actions SHALL
use a service-owned static registry with typed input/result schemas, required
capabilities, preconditions, recovery class and policy for each actor. Policies
SHALL be allow, acknowledge, confirm or deny. Adapters SHALL NOT grant themselves
actor policy. Existing effective permissions and acknowledgement flags SHALL be
preserved. Unregistered browser and CLI methods SHALL be refused before native
dispatch; invalid declared inputs and missing unconditional acknowledgements SHALL
be refused before runtime acquisition. Conditional target policy SHALL use the
resolved target owner and retain existing preview and witness checks.

The service SHALL recheck current socket/command authority and captured runtime
currency before dispatch. Native browser forwarding SHALL recheck immediately
before sending. The actors SHALL distinguish the owner's browser, verified and
unverified agent CLI, assistant, reconcilers and automation; this registry SHALL
NOT create an automation grant or widen internal assistant authority.

#### Scenario: Unregistered method
- **WHEN** the browser or agent CLI submits an unregistered method
- **THEN** World refuses it without forwarding it to Herdr or an adapter

#### Scenario: Existing acknowledgements
- **WHEN** a CLI desk move lacks `--herdr`, an exclusive role replacement lacks
  `--replace --yes`, or a one-time import lacks `--yes`
- **THEN** the operation is refused before host acquisition
- **AND** projected Room/Desk additions and moves that close a room retain their
  target-dependent `--herdr` and `--allow-close-room` checks

#### Scenario: Browser-only forge action
- **WHEN** either CLI actor requests PR merge, close or ready
- **THEN** World refuses it before contacting the forge
- **AND** the owner's browser retains its existing confirmation flow

#### Scenario: Authorization changes before native dispatch
- **WHEN** the browser socket loses authority or its captured runtime retires
  before a forwarded native command is sent
- **THEN** World refuses the send on that runtime without falling back to another

### Requirement: Staged command evidence

Command evidence SHALL distinguish accepted, stored, sent, observed, refused,
failed and uncertain. Memory admission SHALL report accepted; stored SHALL
require a durable commit receipt; sent SHALL require native acknowledgement and
name its owning connection and runtime generation. Observed SHALL require an
explicit observation identifier and SHALL NOT be inferred from successful dispatch.
Legacy handlers MAY conservatively report accepted rather than claim an
unproven stronger stage. Uncertain native input SHALL name its owning runtime
and SHALL NOT be automatically retried.

#### Scenario: Memory-only acceptance
- **WHEN** a command completes against an in-memory store without a durable receipt
- **THEN** its evidence reports accepted, not stored

#### Scenario: Durable record committed
- **WHEN** the durable ledger commits an ask, answer, result or change and supplies
  the committed record's receipt
- **THEN** its CLI reply can report stored with that receipt

#### Scenario: Native acknowledgement lost
- **WHEN** opaque native input may have been dispatched but no acknowledgement arrives
- **THEN** World reports uncertain with the captured runtime and does not retry it

### Requirement: Narrow command exposure
The World service SHALL expose only its documented browser RPC and resource operations, validate
typed parameters and connection identity, and revalidate the selected runtime generation before
forwarding an operation or publishing its result.

#### Scenario: Unsupported command
- **WHEN** a browser submits an unknown method or malformed parameters
- **THEN** the service rejects it without forwarding it to Herdr or invoking a host operation

### Requirement: Explicit access policy
World SHALL default to a loopback listener and SHALL use the Roamgate-derived trusted-single-user
boundary. All listeners, including loopback, SHALL require a generated persistent
login token or configured password. Configured passwords SHALL contain 8–1024
Unicode characters. World SHALL warn at startup when a configured password is
shorter than the recommended 15 characters for access beyond a trusted private network. Repeated failed login attempts SHALL receive a bounded cooldown. World SHALL not require users to
configure bridge Host allow-lists, browser Origin allow-lists or cross-origin connection CSP entries.
Before processing privileged browser HTTP or WebSocket traffic, World SHALL automatically require
the browser Origin authority to equal the request Host authority. A loopback listener SHALL reject a
non-loopback Host authority unless it equals the authority of one explicitly configured public
HTTP(S) origin and the browser Origin equals that exact origin. Originless native clients MAY
connect subject to the listener and authentication policy. World's authenticated session cookie
SHALL use a World-owned name that does not replace Roamgate's cookie on the same hostname.

#### Scenario: Local application
- **WHEN** World runs with its default loopback listener
- **THEN** the browser authenticates with its configured password or generated token and opens
  the same-origin application without connection-policy setup

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
- **WHEN** a World service requires a configured password
- **THEN** unauthenticated protected traffic is rejected and an admitted browser receives a bounded
  authenticated session

#### Scenario: World and Roamgate share a hostname
- **WHEN** authenticated World and Roamgate services run on different ports of the same hostname
- **THEN** logging in to either service does not overwrite the other service's session cookie

#### Scenario: Remote Herdr over SSH
- **WHEN** a loopback World service connects to a remote Herdr using a saved SSH profile
- **THEN** the browser continues to use the one World origin without learning remote socket paths,
  SSH credentials or another bridge URL

#### Scenario: Short configured password
- **WHEN** a user configures an 8-character password
- **THEN** World accepts it and warns that 15 or more characters are recommended beyond a trusted private network
- **AND** passwords shorter than 8 or longer than 1024 Unicode characters are rejected


### Requirement: Independent session signing and optional PIN
Session cookies SHALL use independently stored random signing keys. Credential
changes SHALL rotate signing keys while ordinary restarts SHALL retain them.
Optional PIN login SHALL preserve password/token recovery and maintain separate
per-client throttling plus a bounded global failure cooldown.

#### Scenario: PIN lockout recovery
- **WHEN** PIN failures reach the global cooldown limit
- **THEN** password and generated-token login remain available

#### Scenario: Credential replacement
- **WHEN** a configured login credential changes and the listener starts
- **THEN** cookies signed before the change no longer authenticate

### Requirement: One listener per data folder
Each running World listener SHALL own its data folder exclusively: the default
platform folder, or `HERDR_WORLD_DATA_DIR` when set. Its signing key SHALL be the
folder's single `session-secret.json`. A listener started on a folder another
running listener holds SHALL stop before loading signing state, naming the
holder's process and port. A folder whose holder no longer runs SHALL be taken
over. Management commands and the agent CLI SHALL NOT take the folder. Tests
SHALL NOT use the user's data folder.

#### Scenario: A second instance shares a folder
- **WHEN** a World listener starts on a data folder a running World holds
- **THEN** it exits naming that World and leaves the folder's files unchanged

#### Scenario: Separate folders on one home
- **WHEN** two listeners run with different `HERDR_WORLD_DATA_DIR` folders
- **THEN** each keeps its own sessions across restarts and credential changes

### Requirement: Local agent command line
The World service SHALL accept agent CLI calls at `/api/world/cli` only from a
loopback peer without an Origin header, authenticated with a bearer token
derived from the session signing secret that no other route accepts; failed
bearer attempts SHALL receive the login cooldown, counted apart from logins so
they never block the owner's login. The service SHALL attribute a call to the
Herdr pane it names only when the calling process, found from its connection,
or one of its ancestors is that pane's shell or foreground process on a local
Herdr; otherwise it SHALL label the call unverified, as a terminal with no
pane when none is named, and SHALL refuse a claim that is not a Herdr pane ID. Calls SHALL never merge, delete Herdr objects or reach
outside World; a change to Herdr's layout SHALL require explicit confirmation
(display-only spawn metadata excepted), every change SHALL be recorded with
its actor and time, and an undo SHALL be refused once what it would restore
has changed since.

#### Scenario: Spoofed pane
- **WHEN** a process in one pane calls with another pane's `HERDR_PANE_ID`
- **THEN** the call is labelled unverified; `me` and `spawned-by`, which act as that pane, are
  refused, and other commands act on the default host attributed to the unverified claim
- **AND** a process connecting from another address on the same port is never taken for the
  pane's process

#### Scenario: Remote or browser caller
- **WHEN** a request reaches `/api/world/cli` from another machine or with an Origin header
- **THEN** the service refuses it before reading credentials or the body
