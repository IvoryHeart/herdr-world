## MODIFIED Requirements

### Requirement: Runtime authority

Herdr SHALL own structural topology, agent lifecycle, terminal streams, saved machine profiles, and
native multihost connectivity. One managed World bridge SHALL consume Herdr's supported multihost
interface and expose its selected Local runtime and enabled saved-machine runtimes as separately
qualified runtimes. World SHALL own browser protocol adaptation, qualification, bounded command
admission, notes, pins, observed activity, and upload policy. The browser MAY retain explicit direct
World bridge profiles as a compatibility path.

#### Scenario: Saved machine becomes available

- **WHEN** an enabled saved machine establishes compatible full API and terminal streams through the
  Herdr multihost integration boundary
- **THEN** the serving World bridge exposes it as a qualified runtime without requiring a World
  installation, HTTP listener, or browser-reachable address on that machine

#### Scenario: One host becomes unavailable

- **WHEN** one Local, saved-machine, or direct-bridge runtime loses connectivity
- **THEN** other runtimes remain usable and cached topology from the failed runtime is marked stale
  without admitting control

#### Scenario: Saved machine is disabled or removed

- **WHEN** Herdr reports a saved machine disabled or removed
- **THEN** the bridge retires its live generation and the browser removes it from native runtime
  selection without stopping that machine's Herdr server or agents

#### Scenario: Local is unavailable during gateway startup

- **WHEN** the managed World bridge starts or restarts while Local is unavailable and at least one
  saved machine is healthy
- **THEN** the bridge binds its browser service, reports Local unavailable, and admits the healthy
  saved machine without waiting for Local to recover

#### Scenario: A second bridge targets the same runtime

- **WHEN** a bridge starts while another World bridge owns the same direct Local Herdr client socket
- **THEN** startup fails with bounded guidance to reuse the existing bridge or select a different
  session before the processes can compete for terminal attachment ownership

### Requirement: Qualified admission

The bridge and browser SHALL qualify actions, cached state, terminal sessions, and asynchronous
responses by gateway identity, runtime identity, and connection generation. Each native runtime
SHALL require the reviewed Herdr protocol and advertised capabilities before World dispatches
control.

#### Scenario: Colliding native identifiers

- **WHEN** two runtimes contain the same native pane identifier
- **THEN** an action for one runtime is sent only to that runtime and is never retried on the other

#### Scenario: Unsupported protocol

- **WHEN** a direct bridge reports an unsupported or malformed terminal protocol or omits a required
  capability
- **THEN** the browser rejects terminal attachment and control for that runtime

#### Scenario: Unsupported native capability

- **WHEN** a saved machine stream omits a reviewed API, terminal, launcher, or upload capability
  required for an operation
- **THEN** the bridge keeps the machine independently visible with bounded incompatibility guidance
  and does not dispatch or emulate the unsupported operation

#### Scenario: Native snapshot is admitted

- **WHEN** a saved machine supplies its initial snapshot and structural subscription through one
  compatible Herdr connection generation
- **THEN** World preserves authoritative workspaces, tabs, panes, terminal IDs, pane revisions,
  layouts, agents, and optional worktree data without inferring missing fields from client-selected
  state

#### Scenario: Response from a retired connection

- **WHEN** a snapshot, event, terminal frame, upload result, or command response arrives from an
  earlier generation after the same runtime reconnects
- **THEN** the bridge and browser discard it without changing current state or admitting input

#### Scenario: Machine API fails while its carrier remains present

- **WHEN** a saved machine's API or structural subscription fails while Herdr's underlying transport
  remains present
- **THEN** the bridge retires that runtime generation, makes its control paths non-actionable, and
  requires a fresh subscription and snapshot before readmitting it

## ADDED Requirements

### Requirement: Supported Herdr multihost dependency

World SHALL build a bounded thin native integration only after supported, versioned Herdr
connection and terminal surfaces pass their Local and saved-machine checkpoints. World SHALL NOT
enable, accept, or merge native saved-machine federation until the complete Herdr contract and
product pass end-to-end acceptance. The complete interface SHALL provide bounded machine discovery,
authoritative snapshots and subscriptions, structural commands and launchers, terminal-ID streams
with compatible output, input, focus, resize, scroll, graphics, and bell behavior, connection
generations, structured transport errors, and bounded remote byte delivery. The supported
integration boundary MAY use separate entry points and SHALL NOT require one aggregate daemon.
World SHALL NOT launch SSH, invoke a remote shell, reproduce private executable discovery or
bootstrap, or copy a private Herdr transport to provide native federation.

#### Scenario: Connection and terminal checkpoints pass

- **WHEN** one exact Herdr release or commit passes the live connection and terminal checkpoints
- **THEN** World may pin those proven surfaces and build an explicitly incomplete thin integration
  for Local and one saved machine

#### Scenario: Complete Herdr contract passes conformance

- **WHEN** an exact Herdr revision preserves the proven connection and terminal surfaces and also
  passes generation, restart, structured failure, and remote byte-delivery conformance
- **THEN** World may update its pin and complete the remaining product work but does not accept or
  enable the feature until final end-to-end acceptance passes

#### Scenario: Long-lived operations run concurrently

- **WHEN** the conformance fixture holds an event subscription and two terminal-ID streams open
  while it dispatches structural commands and launcher operations
- **THEN** events, commands, launchers, and both terminals make progress independently with the
  required terminal message semantics

#### Scenario: Herdr contract is missing or unproven

- **WHEN** the installed or proposed Herdr version has not passed the connection and terminal
  checkpoints
- **THEN** even the thin native integration remains unavailable and direct World bridge profiles
  remain usable without World creating an SSH or private-command substitute

#### Scenario: Thin integration has incomplete acceptance

- **WHEN** the connection and terminal checkpoints pass but complete upstream or product acceptance
  has not passed
- **THEN** the integration remains explicitly incomplete and cannot be enabled or treated as
  merge-ready

#### Scenario: Herdr reports a machine transport error

- **WHEN** profile selection, authentication, host-key handling, remote discovery, bootstrap, or
  connectivity fails
- **THEN** Herdr owns the error classification and recovery guidance while World scopes the
  resulting state to that machine

#### Scenario: Herdr contract version changes

- **WHEN** World adopts a different Herdr protocol version, release, commit, or capability contract
- **THEN** the conformance fixture passes again and World's compatibility and provenance record is
  updated before that contract is admitted

#### Scenario: Thin integration crosses the ownership boundary

- **WHEN** proving the integration would require World-side SSH, bootstrap, a duplicate machine
  catalogue, browser-visible connection metadata, or a topology path outside `WorldModel`
- **THEN** implementation stops and this design is revisited before more product code is added

### Requirement: Herdr machine catalogue authority

The bridge SHALL discover native runtimes from Herdr's supported catalogue surface and use Herdr's
opaque machine ID as their stable runtime identity. The trusted local bridge MAY consume supported
catalogue output containing sensitive target or session metadata, but SHALL NOT persist or log those
fields, expose them to the browser, or use them to construct or choose transport behavior. World
SHALL NOT maintain a second target catalogue, modify Herdr profiles, accept browser-supplied targets,
or store transport credentials. It SHALL request native connectivity from Herdr by the already
admitted opaque machine ID.

#### Scenario: Herdr catalogue changes

- **WHEN** a saved machine is added, renamed, enabled, disabled, or removed through Herdr
- **THEN** the serving bridge reflects the new identity, label, and availability without requiring
  an equivalent World connection profile

#### Scenario: Supported catalogue includes connection metadata

- **WHEN** Herdr's supported catalogue returns target, session, or other connection metadata with an
  admitted machine ID
- **THEN** the trusted bridge selects the opaque ID, discards the connection metadata before
  browser serialization, and leaves transport decisions to Herdr

#### Scenario: Machine requires interactive attention

- **WHEN** authentication, host-key approval, installation, update, or restart requires operator
  attention
- **THEN** World marks only that machine as requiring Attention and presents Herdr-owned recovery
  guidance without answering a prompt or changing the profile

#### Scenario: Herdr native integration surface is unavailable

- **WHEN** the supported Herdr catalogue or native transport entry points are unavailable while the
  existing Local provider is healthy
- **THEN** same-origin Local and explicit direct bridge profiles remain usable and native machine
  discovery reports a bounded diagnostic without inventing profiles or invoking SSH

### Requirement: Unified WorldModel ingestion

The browser SHALL convert Local, saved-machine, and direct compatibility runtime sources through
the same qualified `WorldModel` ingestion path. Tree, graph, office, and other topology
projections SHALL consume that unified model rather than a native-machine-specific topology store.

#### Scenario: One gateway advertises multiple runtimes

- **WHEN** a serving gateway advertises Local and one or more saved-machine runtimes
- **THEN** each admitted runtime becomes a qualified source in one `WorldModel` and remains
  independently selectable

#### Scenario: Native and direct sources are both configured

- **WHEN** the browser admits native runtimes and explicit direct bridge profiles together
- **THEN** both source types use the same model ingestion and projection path while retaining their
  distinct gateway and runtime identities

#### Scenario: One runtime reconnects

- **WHEN** one runtime advances to a new connection generation
- **THEN** model ingestion replaces only that qualified source and does not rebuild another
  runtime's authority from the reconnecting source

### Requirement: Independent browser terminal surfaces

The serving bridge SHALL let bounded concurrent browser viewers observe and control different
terminal IDs on the same or different Herdr machines through Herdr's terminal-ID streams without
changing shared pane focus or routing another viewer's input to the wrong pane. A viewer SHALL
become controllable only after its runtime generation and requested terminal are current.

#### Scenario: Viewers select different saved-machine panes

- **WHEN** two browser terminal viewers select different panes on one saved machine
- **THEN** each receives the requested terminal surface and its input, scroll, focus, and resize
  actions remain scoped to that pane and viewer connection

#### Scenario: Native client changes focus or zoom

- **WHEN** an existing native Herdr client changes pane focus or zoom in the same tab observed by a
  World terminal viewer
- **THEN** the World viewer remains attached to its qualified terminal ID and does not send input to
  the newly focused native pane

#### Scenario: Viewers share one terminal

- **WHEN** multiple browser viewers observe one terminal at different dimensions
- **THEN** each continues receiving current output, resize arbitration remains explicit, and a
  viewer can reassert its dimensions through the existing refit behavior

#### Scenario: Another client owns the terminal attachment

- **WHEN** a native gateway path requests a terminal already attached through another native client
  or direct gateway
- **THEN** Herdr preserves the current owner, World performs only bounded conflict retries, and the
  browser reports the terminal as attached elsewhere without silently taking it over

#### Scenario: Viewer reconnects

- **WHEN** a terminal viewer survives a machine reconnect
- **THEN** its previous stream stays non-actionable until a fresh compatible generation and surface
  arrive, after which the bridge reattaches it or reports a bounded failure

### Requirement: Machine-qualified World data

World SHALL qualify note attachments, agent pins, observed activity, snapshot pruning, and upload
operations by runtime and native identity. World SHALL own upload admission and policy, while bytes
for a saved machine SHALL travel only through Herdr's supported remote-delivery capability. The
result SHALL be a path on that machine before World inserts or reports it to the terminal, subject
to declared bounds and stale-generation checks.

#### Scenario: Upload to a saved machine

- **WHEN** an admitted browser uploads a supported file to a current pane on a saved machine
- **THEN** World validates the upload, Herdr delivers the bytes to a bounded private path on that
  machine, and only that remote path is delivered to the selected pane

#### Scenario: Remote upload fails

- **WHEN** remote delivery, generation validation, or endpoint insertion fails
- **THEN** World reports the failure without inserting a local path into the remote terminal or
  silently rerouting the upload to another runtime

#### Scenario: Browser supplies a remote destination

- **WHEN** an upload request includes a remote path, profile target, or shell text
- **THEN** World rejects that field and never passes it to Herdr's remote-delivery capability

#### Scenario: Equal pane IDs on two machines

- **WHEN** notes, pins, or activity refer to equal native pane IDs owned by different machines
- **THEN** each record remains associated only with its qualified machine and pane and one
  machine's snapshot cannot prune or overwrite the other's records
