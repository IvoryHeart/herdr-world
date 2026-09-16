## MODIFIED Requirements

### Requirement: Runtime authority

Herdr SHALL remain authoritative for structural topology, agent lifecycle, commands, launchers, and
terminal protocol behavior. One managed World bridge SHALL expose its selected Local Herdr runtime
and enabled World-owned remote Herdr profiles as separately qualified runtimes. World SHALL own
connector profiles, local and SSH connector lifecycle, browser protocol adaptation, qualification,
bounded command admission, notes, pins, observed activity, and upload policy. OpenSSH SHALL remain
authoritative for SSH target resolution, authentication material, host verification, proxying, and
connection policy. The browser MAY retain explicit direct World bridge profiles as a compatibility
path.

#### Scenario: Remote Herdr profile becomes available

- **WHEN** an enabled World remote profile establishes compatible Herdr API and terminal
  connections through its SSH connector
- **THEN** the serving bridge exposes it as a qualified runtime without requiring a World
  installation, HTTP listener, or browser-reachable address on that machine

#### Scenario: One host becomes unavailable

- **WHEN** one Local, SSH-backed, or direct-bridge runtime loses connectivity
- **THEN** other runtimes remain usable and cached topology from the failed runtime is marked stale
  without admitting control

#### Scenario: Remote profile is disabled or removed

- **WHEN** an authorized user disables or removes a World remote profile
- **THEN** the bridge retires its connector generation and removes it from runtime selection without
  stopping the remote Herdr server or its agents

#### Scenario: Local is unavailable during gateway startup

- **WHEN** the managed World bridge starts while Local is unavailable and one remote profile is
  healthy
- **THEN** the bridge binds its browser service, reports Local unavailable, and admits the healthy
  remote runtime without waiting for Local to recover

#### Scenario: Every remote connector is unavailable

- **WHEN** SSH, agent access, or every configured remote target is unavailable while Local is
  healthy
- **THEN** Local and explicit direct bridge profiles remain usable and each remote profile reports
  only its bounded profile-local state

#### Scenario: A second bridge targets the same runtime

- **WHEN** a bridge starts while another World bridge owns the same direct Local Herdr client socket
- **THEN** startup fails with bounded guidance to reuse the existing bridge or select a different
  session before the processes can compete for terminal attachment ownership

### Requirement: Qualified admission

The bridge and browser SHALL qualify actions, cached state, terminal sessions, and asynchronous
responses by gateway identity, runtime identity, and connector generation. Each Herdr runtime SHALL
pass the reviewed API and terminal compatibility checks before World dispatches control.

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
  one compatible connector generation
- **THEN** World preserves authoritative workspaces, tabs, panes, terminal IDs, pane revisions,
  layouts, agents, and optional worktree data without inferring missing fields from client-selected
  state

#### Scenario: Response from a retired connector

- **WHEN** a snapshot, event, terminal frame, upload result, or command response arrives from an
  earlier generation after the same profile reconnects or changes
- **THEN** the bridge and browser discard it without changing current state or admitting input

#### Scenario: Herdr API fails while SSH remains present

- **WHEN** a remote runtime's API or structural subscription fails while its SSH process remains
  present
- **THEN** the bridge retires that runtime generation, makes its control paths non-actionable, and
  requires a fresh subscription and snapshot before readmitting it

## ADDED Requirements

### Requirement: Herdr connector boundary

World SHALL use one Herdr-specific connector contract for its existing local socket and remote
SSH-backed runtimes. A connector SHALL provide independent compatible API connections, terminal
connections opened by terminal ID, lifecycle and generation state, and bounded diagnostics. Before
final acceptance it SHALL also provide bounded remote byte delivery. The contract SHALL preserve
independent progress for a structural subscription, request clients, launcher operations, and
multiple terminal streams. Connector implementation SHALL remain outside presentation-specific
World code.

#### Scenario: Long-lived operations run concurrently

- **WHEN** an SSH-backed runtime holds its structural subscription and two terminal-ID streams open
  while World dispatches structural commands and launcher operations
- **THEN** the subscription, commands, launchers, and both terminals make independent progress

#### Scenario: Local and SSH connectors share the contract

- **WHEN** the runtime registry opens Local and one SSH-backed Herdr runtime
- **THEN** the registry consumes the same connector operations and Herdr protocol model without a
  transport-specific topology path

#### Scenario: Connector uses the pinned Herdr relay surface

- **WHEN** World launches the reviewed SSH relay for an admitted profile
- **THEN** it uses fixed executable arguments, records the exact Herdr compatibility provenance,
  and speaks the reviewed Herdr API or terminal protocol after the relay reaches the remote socket

#### Scenario: Connector implementation serializes clients

- **WHEN** a candidate connector lets a long-lived subscription or terminal stream prevent another
  required connection from opening or progressing
- **THEN** the connector fails conformance and native remote federation remains disabled

#### Scenario: Herdr compatibility baseline changes

- **WHEN** World adopts a different Herdr release, commit, API protocol, terminal protocol, or relay
  behavior
- **THEN** connector conformance and live acceptance pass again and compatibility provenance is
  updated before that baseline is admitted

#### Scenario: Another server provider is considered

- **WHEN** a future server does not speak the Herdr API and terminal protocols
- **THEN** it requires a separate provider-to-World adapter and SHALL NOT be treated as compatible
  merely because SSH can reach it

### Requirement: World-owned remote Herdr profiles

The World bridge SHALL maintain a bounded remote Herdr profile catalogue containing an opaque
stable ID, label, validated OpenSSH target or alias, optional Herdr session, and enabled state. The
catalogue SHALL NOT contain passwords, private keys, agent tickets, generated shell commands, or
arbitrary SSH options. Mutable target and session fields SHALL NOT form runtime identity. Profile
mutation SHALL require the same admitted configuration authority as other security-sensitive bridge
settings.

#### Scenario: User adds a remote profile

- **WHEN** an authorized user supplies a valid label, OpenSSH target, and optional Herdr session
- **THEN** World assigns an opaque runtime ID, persists only the bounded profile fields, and starts
  the connector without accepting key material or arbitrary command text

#### Scenario: User selects a key

- **WHEN** the user needs a particular identity or agent for a remote profile
- **THEN** the user selects it through normal OpenSSH configuration or `ssh-agent` and World stores
  no copy of the key or passphrase

#### Scenario: Profile transport fields change

- **WHEN** an authorized user changes a profile target or session
- **THEN** World retires the current generation before reconnecting while preserving the opaque
  profile ID

#### Scenario: Profile requires interactive attention

- **WHEN** host trust, authentication, remote installation, update, or server replacement requires
  interaction
- **THEN** World marks only that profile as requiring Attention and directs the user to an ordinary
  terminal without answering a prompt or modifying OpenSSH configuration

#### Scenario: Remote Herdr is missing or incompatible

- **WHEN** the admitted SSH target lacks the reviewed Herdr relay behavior or reports an
  incompatible protocol
- **THEN** World keeps the profile visible but non-actionable with bounded guidance and does not
  install, replace, or upgrade Herdr automatically

#### Scenario: Browser supplies connector control

- **WHEN** a profile request includes an executable, SSH flag, private-key path, remote command,
  upload destination, or shell text outside the bounded profile schema
- **THEN** the bridge rejects it without starting a connector or changing the stored profile

### Requirement: Unified WorldModel ingestion

The browser SHALL convert Local, SSH-backed, and direct compatibility runtime sources through the
same qualified `WorldModel` ingestion path. Tree, Graph, Office, Spaces, and other topology
projections SHALL consume that unified model rather than connector-specific topology stores.

#### Scenario: One gateway advertises multiple runtimes

- **WHEN** a serving gateway advertises Local and one or more enabled remote Herdr runtimes
- **THEN** each appears as a qualified runtime through the same runtime source and model contracts

#### Scenario: SSH-backed and direct sources are both configured

- **WHEN** an operator retains a direct World bridge profile while enabling an SSH-backed profile
- **THEN** both remain separately qualified by gateway and runtime identity without implicit
  deduplication or command fallback

#### Scenario: One runtime reconnects

- **WHEN** an SSH-backed runtime advances its generation
- **THEN** the model replaces only that runtime's admitted snapshot and buffered events while
  preserving unrelated runtime state

### Requirement: Independent browser terminal surfaces

Each terminal viewer SHALL bind to a qualified runtime, terminal ID, viewer connection, and current
connector generation. The connector SHALL open the remote terminal by terminal ID and SHALL NOT
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
bytes SHALL travel only through the admitted profile's bounded connector delivery operation and
produce a path on that remote machine before World inserts or reports it to the terminal.

#### Scenario: Upload to an SSH-backed runtime

- **WHEN** an admitted browser uploads a supported file to a current remote pane
- **THEN** World validates the upload, the connector creates a bounded private remote path, and only
  that path is delivered to the selected pane

#### Scenario: Remote upload fails

- **WHEN** transfer, generation validation, or pane insertion fails
- **THEN** World reports the failure without inserting a local path, leaking a partial destination,
  or rerouting the upload to another runtime

#### Scenario: Browser supplies a remote destination

- **WHEN** an upload request includes a remote path, SSH target, or shell text
- **THEN** World rejects that field and does not pass it to the connector

#### Scenario: Equal pane IDs on two runtimes

- **WHEN** notes, pins, or activity refer to equal native pane IDs owned by different runtimes
- **THEN** each record remains associated only with its qualified runtime and pane and one runtime's
  snapshot cannot prune or overwrite the other's records
