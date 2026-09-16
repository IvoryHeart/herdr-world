## MODIFIED Requirements

### Requirement: Runtime authority

Herdr SHALL remain authoritative for structural topology, agent lifecycle, commands, launchers, and
terminal protocol behavior. One managed World bridge SHALL expose its selected Local Herdr runtime
and enabled World-owned remote Herdr connections as separately qualified runtimes. World SHALL own
its connection list, local and SSH connection lifecycle, browser access and routing, qualification,
reconnect generations, bounded command admission, notes, pins, observed activity, and upload
policy. A Herdr-specific adapter SHALL own API requests, snapshot/event ordering, native entity and
capability mapping, commands, launchers, terminal semantics, compatibility checks, and the pinned
relay command. Local-socket and SSH process handling SHALL remain below that adapter and SHALL NOT
depend on Herdr entity or World presentation types. OpenSSH SHALL remain authoritative for SSH
target resolution, authentication material, host verification, proxying, and connection policy.
The browser MAY retain explicit direct World bridge profiles as a compatibility path.

#### Scenario: Remote Herdr connection becomes available

- **WHEN** an enabled World remote connection establishes compatible Herdr API and terminal
  connections through SSH
- **THEN** the serving bridge exposes it as a qualified runtime without requiring a World
  installation, HTTP listener, or browser-reachable address on that machine

#### Scenario: One host becomes unavailable

- **WHEN** one Local, SSH-backed, or direct-bridge runtime loses connectivity
- **THEN** other runtimes remain usable and cached topology from the failed runtime is marked stale
  without admitting control

#### Scenario: Remote connection is disabled or removed

- **WHEN** an actual-loopback local-management user disables or removes a World remote connection
- **THEN** the bridge retires its connection generation and removes it from runtime selection
  without stopping the remote Herdr server or its agents

#### Scenario: Herdr plugin starts World

- **WHEN** the Herdr plugin installs, starts, or opens the local World bridge
- **THEN** it may bootstrap the existing Local socket but does not own or limit World's connection
  list, and remote connections reach their selected Herdr sessions without routing through Local

#### Scenario: Local is unavailable during gateway startup

- **WHEN** the managed World bridge starts while Local is unavailable and one remote connection is
  healthy
- **THEN** the bridge binds its browser service, reports Local unavailable, and admits the healthy
  remote runtime without waiting for Local to recover

#### Scenario: Every remote connection is unavailable

- **WHEN** SSH, agent access, or every configured remote target is unavailable while Local is
  healthy
- **THEN** Local and explicit direct bridge profiles remain usable and each remote connection
  reports only its bounded connection-local state

#### Scenario: A second bridge targets the same runtime

- **WHEN** a bridge starts while another World bridge owns the same direct Local Herdr client socket
- **THEN** startup fails with bounded guidance to reuse the existing bridge or select a different
  session before the processes can compete for terminal attachment ownership

### Requirement: Qualified admission

The bridge and browser SHALL qualify actions, cached state, terminal sessions, and asynchronous
responses by gateway identity, runtime identity, and connection generation. The Herdr adapter SHALL
apply the reviewed API, terminal, relay, and capability compatibility checks before World dispatches
control.

#### Scenario: Colliding native identifiers

- **WHEN** two runtimes contain the same native pane or terminal identifier
- **THEN** an action for one runtime is sent only to that runtime and is never retried on the other

#### Scenario: Unsupported protocol

- **WHEN** a Local, SSH-backed, or direct runtime reports an unsupported or malformed protocol or
  omits a required capability
- **THEN** World rejects the affected terminal attachment or operation for that runtime without
  emulating it through a remote shell

#### Scenario: Remote snapshot is admitted

- **WHEN** an SSH-backed runtime supplies its initial snapshot and buffered structural events from
  one compatible connection generation
- **THEN** World preserves authoritative workspaces, tabs, panes, terminal IDs, pane revisions,
  layouts, agents, and optional worktree data without inferring missing fields from client-selected
  state

#### Scenario: Response from a retired connection

- **WHEN** a snapshot, event, terminal frame, upload result, or command response arrives from an
  earlier generation after the same connection reconnects or changes
- **THEN** the bridge and browser discard it without changing current state or admitting input

#### Scenario: Herdr API fails while SSH remains present

- **WHEN** a remote runtime's API or structural subscription fails while its SSH process remains
  present
- **THEN** the bridge retires that runtime generation, makes its control paths non-actionable, and
  requires a fresh subscription and snapshot before readmitting it

## ADDED Requirements

### Requirement: Herdr adapter and connection-mechanism boundary

World SHALL use one Herdr-specific adapter for its existing local-socket and remote SSH-backed
connections. The adapter SHALL provide independent compatible API connections, terminal
connections opened by terminal ID, and Herdr protocol and capability semantics. The World registry
SHALL assign connection identity and generations; each connection mechanism SHALL report readiness,
closure, and bounded transport diagnostics. Before final acceptance the connection mechanism SHALL
also provide bounded remote byte delivery. The boundary SHALL preserve independent progress for a
structural subscription, request clients, launcher operations, and multiple terminal streams. Herdr
adaptation and connection mechanics SHALL remain outside presentation-specific World code, and SSH
process handling SHALL NOT interpret Herdr agents, panes, layouts, or commands.

#### Scenario: Long-lived operations run concurrently

- **WHEN** an SSH-backed runtime holds its structural subscription and two terminal-ID streams open
  while World dispatches structural commands and launcher operations
- **THEN** the subscription, commands, launchers, and both terminals make independent progress

#### Scenario: Local and SSH connections share the Herdr adapter

- **WHEN** the runtime registry opens Local and one SSH-backed Herdr runtime
- **THEN** both use the same Herdr adapter and qualified model-ingestion path without a
  connection-specific topology model

#### Scenario: Herdr adapter uses the pinned relay surface

- **WHEN** World launches the reviewed SSH relay for an admitted connection
- **THEN** it verifies the exact executable/relay revision and relay capability independently from
  API and terminal protocol compatibility, resolves the configured `Default` or named selector to
  the actual session identity, and speaks the reviewed Herdr protocol after the relay reaches that
  session's socket

#### Scenario: OpenSSH executes the fixed remote command

- **WHEN** World starts an SSH-backed connection
- **THEN** it invokes OpenSSH directly without a local shell and supplies one fixed, correctly
  encoded remote relay command for the remote login shell, with no user-selected shell program,
  executable, remote command, or shell text

#### Scenario: Protocol matches but relay is absent

- **WHEN** a remote Herdr reports the reviewed API and terminal protocols but does not pass the
  separately pinned relay-capability probe
- **THEN** World keeps that connection non-actionable and does not treat protocol compatibility as
  proof that remote federation is available

#### Scenario: Connection mechanism serializes clients

- **WHEN** a candidate connection mechanism lets a long-lived subscription or terminal stream
  prevent another required connection from opening or progressing
- **THEN** the connection mechanism fails adapter conformance and native remote federation remains
  disabled

#### Scenario: Herdr compatibility baseline changes

- **WHEN** World adopts a different Herdr release, commit, API protocol, terminal protocol, or relay
  behavior
- **THEN** adapter and connection conformance and live acceptance pass again and compatibility
  provenance is updated before that baseline is admitted

### Requirement: World-owned Herdr connections

The World bridge SHALL maintain a bounded Herdr connection list. Each remote connection SHALL
contain an opaque stable connection ID, label, validated OpenSSH target or alias, a Herdr session
selector that defaults to `Default` and may instead be `Named(name)`, enabled state, and an optional
current runtime binding. The list SHALL NOT contain passwords, private keys, agent tickets,
user-supplied shell commands, or arbitrary SSH options. The connection ID identifies editable
configuration. Before admission, the adapter SHALL resolve either selector to an actual
pre-provisioned session; World SHALL then create or retain an opaque runtime-binding ID that records
the resolved session and identifies persisted runtime entities. A connection whose selector has not
resolved SHALL remain visible but unbound and non-actionable. Reconnects to the same target and
resolved session SHALL retain the runtime-binding ID. A target change or a selector resolving to a
different session SHALL mint a new runtime-binding ID.
Connection mutation and configured/resolved target/session disclosure SHALL require the existing
actual-loopback local-management boundary. Herdr's saved-machine catalogue SHALL NOT be
authoritative over the World connection list.

#### Scenario: User adds a remote connection

- **WHEN** an actual-loopback local-management user supplies a valid label and OpenSSH target while
  omitting the Herdr session
- **THEN** World assigns an opaque connection ID, persists only the bounded fields with the
  `Default` selector, and creates the runtime binding only after resolving the actual session,
  without accepting key material or arbitrary command text

#### Scenario: User names a remote session

- **WHEN** an actual-loopback local-management user supplies a valid named Herdr session
- **THEN** the adapter resolves that named selector and admits the connection only after recording
  the actual resolved session identity

#### Scenario: User selects a key

- **WHEN** the user needs a particular identity or agent for a remote connection
- **THEN** the user selects it through normal OpenSSH configuration or `ssh-agent` and World stores
  no copy of the key or passphrase

#### Scenario: Connection target or session changes

- **WHEN** a local-management user changes a connection target or session selector and the resolved
  assignment changes from A to B
- **THEN** World preserves the connection ID, retires A's generation, detaches A's viewers, mints a
  new runtime-binding ID for B, and does not attach A's persisted records to B

#### Scenario: Default continues to resolve to the same session

- **WHEN** a connection using `Default` reconnects to the same target and resolves to the same Herdr
  session as its current runtime binding
- **THEN** World retains the runtime-binding ID and advances only the connection generation

#### Scenario: Default resolves to another session

- **WHEN** a connection using `Default` reconnects and the target's default now resolves to a
  different Herdr session
- **THEN** World treats the result as retargeting, retires the old generation, detaches its viewers,
  and creates a new runtime-binding ID before admitting the new session

#### Scenario: Connection label or enabled state changes

- **WHEN** a local-management user renames, disables, or re-enables a connection without changing its
  target or session
- **THEN** World retains the runtime-binding ID while applying normal generation retirement and
  reconnect rules

#### Scenario: Connection requires interactive attention

- **WHEN** host trust, authentication, remote installation, update, or server replacement requires
  interaction
- **THEN** World marks only that connection as requiring Attention and directs the user to an
  ordinary terminal without answering a prompt or modifying OpenSSH configuration

#### Scenario: Remote Herdr is missing or incompatible

- **WHEN** the admitted SSH target lacks the reviewed Herdr relay behavior or reports an
  incompatible protocol
- **THEN** World keeps the connection visible but non-actionable with bounded guidance and does not
  create or replace its runtime binding or install, replace, or upgrade Herdr automatically

#### Scenario: Browser supplies connection control

- **WHEN** a connection request includes an executable, SSH flag, private-key path, remote command,
  upload destination, or shell text outside the bounded connection schema
- **THEN** the bridge rejects it without starting transport or changing the stored connection

#### Scenario: Remote admitted client attempts connection administration

- **WHEN** a non-loopback browser with a valid runtime session requests connection CRUD or
  target/session details
- **THEN** the bridge rejects the request because runtime admission does not grant local-management
  authority

#### Scenario: A Herdr saved profile is imported

- **WHEN** a later optional import copies a Herdr saved-machine entry into World
- **THEN** World creates an independent connection with its imported named selector or `Default`,
  resolves the actual session under normal admission rules, and does not let later Herdr catalogue
  edits, deletion, or unavailability silently retarget or remove it

### Requirement: Unified WorldModel ingestion

The browser SHALL convert Local, SSH-backed, and direct compatibility runtime sources through the
same qualified `WorldModel` ingestion path. Tree, Graph, Office, Spaces, and other topology
projections SHALL consume that unified model rather than connection-specific topology stores.

#### Scenario: One gateway advertises multiple runtimes

- **WHEN** a serving gateway advertises Local and one or more enabled remote Herdr runtimes
- **THEN** each appears as a qualified runtime through the same runtime source and model contracts

#### Scenario: SSH-backed and direct sources are both configured

- **WHEN** an operator retains a direct World bridge profile while enabling an SSH-backed connection
- **THEN** both remain separately qualified by gateway and runtime identity without implicit
  deduplication or command fallback

#### Scenario: One runtime reconnects

- **WHEN** an SSH-backed runtime advances its generation
- **THEN** the model replaces only that runtime's admitted snapshot and buffered events while
  preserving unrelated runtime state

#### Scenario: One connection is retargeted to another server

- **WHEN** a connection changes from server/session A to B and both servers contain equal native IDs
- **THEN** B enters the model under a new runtime-binding ID, A's viewers detach, and A's cached or
  persisted entities are neither attached to nor pruned by B

### Requirement: Independent browser terminal surfaces

Each terminal viewer SHALL bind to a qualified runtime, terminal ID, viewer connection, and current
connection generation. The Herdr adapter SHALL open the remote terminal by terminal ID and SHALL NOT
derive it from native TUI selection. World SHALL preserve the existing browser terminal behavior
and prevent focus, resize, scroll, or input from targeting another terminal.

#### Scenario: Viewers select different remote panes

- **WHEN** two browser terminal viewers select different panes on one SSH-backed runtime
- **THEN** each receives the requested terminal surface and its input, scroll, focus, and resize
  actions remain scoped to that pane and viewer connection

#### Scenario: Native client changes focus or zoom

- **WHEN** a native Herdr client changes pane focus or zoom in the same remote session
- **THEN** each World viewer remains attached to its qualified terminal ID and does not send input
  to the newly selected native pane

#### Scenario: Viewers share one terminal

- **WHEN** multiple browser viewers observe one terminal at different dimensions
- **THEN** each continues receiving current output, resize arbitration remains explicit, and a
  viewer can reassert its dimensions through the existing refit behavior

#### Scenario: Terminal attachment conflicts

- **WHEN** the pinned Herdr terminal protocol reports that another client owns or conflicts with an
  attachment
- **THEN** World preserves the recorded server semantics, performs only bounded retries, and does
  not silently take over or redirect the viewer

#### Scenario: Viewer reconnects

- **WHEN** a terminal viewer survives an SSH-backed runtime reconnect
- **THEN** its previous stream stays non-actionable until a fresh compatible generation and surface
  arrive, after which the bridge reattaches it or reports a bounded failure

### Requirement: Machine-qualified World data

World SHALL qualify note attachments, agent pins, observed activity, snapshot pruning, and upload
operations by runtime and native identity. World SHALL own upload admission and policy. Remote
bytes SHALL travel only through the admitted connection's bounded delivery operation and produce a
path on that remote machine before the Herdr adapter inserts or reports it to the terminal.

#### Scenario: Upload to an SSH-backed runtime

- **WHEN** an admitted browser uploads a supported file to a current remote pane
- **THEN** World validates the upload, the connection mechanism creates a bounded private remote
  path, and only that path is delivered to the selected pane through the Herdr adapter

#### Scenario: Remote upload fails

- **WHEN** transfer, generation validation, or pane insertion fails
- **THEN** World reports the failure without inserting a local path, leaking a partial destination,
  or rerouting the upload to another runtime

#### Scenario: Browser supplies a remote destination

- **WHEN** an upload request includes a remote path, SSH target, or shell text
- **THEN** World rejects that field and does not pass it to the connection mechanism

#### Scenario: Equal pane IDs on two runtimes

- **WHEN** notes, pins, or activity refer to equal native pane IDs owned by different runtimes
- **THEN** each record remains associated only with its qualified runtime and pane and one runtime's
  snapshot cannot prune or overwrite the other's records

#### Scenario: Retargeted connection reuses native IDs

- **WHEN** a connection's old and new runtime bindings contain equal native pane, terminal, or agent
  IDs
- **THEN** notes, pins, activity, uploads, and viewers remain associated with the binding that
  created them and do not silently move to the replacement runtime
