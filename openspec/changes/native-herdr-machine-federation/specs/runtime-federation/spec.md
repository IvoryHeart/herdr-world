## MODIFIED Requirements

### Requirement: Runtime authority
Herdr SHALL own structural topology, agent lifecycle, terminal streams, saved SSH machine profiles,
and remote API and terminal compatibility. One managed World bridge SHALL expose its selected local
Herdr runtime and Herdr's enabled saved SSH machine endpoints as separately qualified runtimes. The
bridge SHALL perform normal desktop federation for those native runtimes; the browser MAY retain
explicit direct World bridge profiles as a compatibility path.

#### Scenario: Saved machine becomes available
- **WHEN** an enabled saved SSH machine establishes compatible full API and terminal transports
- **THEN** the serving World bridge exposes it as a qualified runtime without requiring a World
  installation, HTTP listener, or browser-reachable address on that machine

#### Scenario: One host becomes unavailable
- **WHEN** one local, saved-SSH, or direct-bridge runtime loses connectivity
- **THEN** other runtimes remain usable and cached topology from the failed runtime is stale without
  admitting control

#### Scenario: Saved machine is disabled or removed
- **WHEN** Herdr reports a saved machine disabled or removed from its catalogue
- **THEN** the bridge retires its live connection and the browser removes it from native runtime
  selection without stopping that machine's Herdr server or agents

#### Scenario: Local is unavailable during gateway startup
- **WHEN** the managed World bridge starts or restarts while its selected local Herdr runtime is
  unavailable and at least one saved SSH machine is healthy
- **THEN** the bridge binds its browser service, reports Local unavailable, and admits the healthy
  saved machine without waiting for Local to recover

#### Scenario: A second bridge targets the same runtime
- **WHEN** a bridge starts while another Herdr World bridge owns the same direct local Herdr client
  socket
- **THEN** startup fails with bounded guidance to reuse the existing bridge or select a different
  Herdr session, before the processes can compete for terminal attachment ownership

### Requirement: Qualified admission
The bridge and browser SHALL qualify actions, cached state, terminal sessions, and asynchronous
responses by runtime identity and connection generation. Each transport SHALL require its reviewed
protocol and advertised capabilities before dispatching control.

#### Scenario: Colliding native identifiers
- **WHEN** two runtimes contain the same native pane identifier
- **THEN** an action for one runtime is sent only to that runtime and never retried on the other

#### Scenario: Unsupported protocol
- **WHEN** a direct bridge reports a terminal protocol other than 22, a malformed protocol, or
  missing required capabilities
- **THEN** the browser rejects terminal attach and control for that runtime

#### Scenario: Unsupported native transport
- **WHEN** a saved machine does not provide the reviewed Herdr API, terminal protocol, required
  operation, or SSH Unix-socket forwarding required for native World access
- **THEN** the bridge keeps the machine independently visible with bounded incompatibility or
  Attention guidance and does not dispatch the unsupported operation

#### Scenario: Native snapshot is admitted
- **WHEN** a saved machine supplies its initial snapshot and structural event subscription through
  one forwarded Herdr API generation
- **THEN** World preserves the authoritative workspaces, tabs, panes, terminal IDs, pane revisions,
  layouts, agents, and optional worktree data and does not infer missing fields from client-shell
  state

#### Scenario: Response from a retired connection
- **WHEN** a snapshot, terminal frame, upload result, or command response arrives from an earlier
  generation after the same runtime reconnects
- **THEN** the bridge and browser discard it without changing current state or admitting input

#### Scenario: Remote API fails behind a live SSH forward
- **WHEN** a saved machine's Herdr API or structural subscription fails while its SSH forwarding
  process remains alive
- **THEN** the bridge retires that runtime generation, makes its control paths non-actionable, and
  requires a fresh subscription and snapshot before readmitting it

## ADDED Requirements

### Requirement: Herdr machine catalogue authority
The bridge SHALL discover native remote runtimes from Herdr's supported machine-list output and use
Herdr's opaque machine profile ID as their stable identity. World SHALL NOT maintain a second SSH
target catalogue, modify Herdr machine profiles, accept browser-supplied SSH targets for native
connections, or store SSH credentials. Native connections SHALL preserve the effective OpenSSH
configuration used by Herdr for the saved target and SHALL NOT replace it with a World-generated
SSH configuration.

#### Scenario: Herdr catalogue changes
- **WHEN** a saved machine is added, renamed, enabled, disabled, or removed through Herdr
- **THEN** the serving bridge reflects the new identity, label, and availability without requiring
  an equivalent World connection profile

#### Scenario: Machine requires interactive attention
- **WHEN** host-key approval, authentication, installation, update, or restart cannot complete in a
  non-interactive connection
- **THEN** World marks only that machine as requiring Attention and presents Herdr-owned foreground
  recovery guidance without answering the prompt or changing the machine profile

#### Scenario: Saved target has operator SSH configuration
- **WHEN** a saved machine resolves through OpenSSH configuration containing aliases, proxying,
  identities, site policy, or forwarding directives
- **THEN** the native connection preserves that effective configuration, adds World's private API
  forward, and reports a bounded machine-specific failure if the required forward cannot be
  established

#### Scenario: Catalogue cannot be read
- **WHEN** the Herdr executable or valid machine-list output is unavailable
- **THEN** the local runtime and explicit direct bridge profiles remain usable and native machine
  discovery reports a bounded diagnostic without inventing profiles

### Requirement: Independent browser terminal surfaces
The serving bridge SHALL let bounded concurrent browser viewers observe and control different
terminal IDs on the same or different Herdr machines through terminal-ID-specific direct streams
without changing shared pane focus or routing another viewer's input to the wrong pane. A viewer
SHALL become controllable only after its runtime generation and requested terminal are current.

#### Scenario: Viewers select different remote panes
- **WHEN** two browser terminal viewers select different panes on one saved machine
- **THEN** each receives the requested pane surface and its input, scroll, focus, and resize actions
  remain scoped to that pane and viewer connection

#### Scenario: Native client changes focus or zoom
- **WHEN** an existing native Herdr client changes pane focus or zoom in the same tab observed by a
  World terminal viewer
- **THEN** the World viewer remains attached to its qualified terminal ID and does not send input to
  the newly focused native pane

#### Scenario: Viewers share one terminal
- **WHEN** multiple browser viewers observe one terminal at different dimensions
- **THEN** each continues receiving current output, resize arbitration remains explicit, and a
  viewer can reassert its dimensions through the existing refit behavior

#### Scenario: Another gateway owns the terminal attachment
- **WHEN** a native gateway path requests a terminal already attached through a direct or other
  native gateway path
- **THEN** it preserves the current owner, performs only bounded conflict retries, and reports the
  terminal as attached elsewhere without silently taking it over

#### Scenario: Viewer reconnects
- **WHEN** a terminal viewer survives a machine reconnect
- **THEN** its previous stream stays non-actionable until a fresh compatible generation and surface
  arrive, after which the bridge reattaches it or reports a bounded failure

### Requirement: Machine-qualified World data
World SHALL qualify note attachments, agent pins, observed activity, snapshot pruning, and upload
operations by runtime and native identity. An upload targeting a saved SSH machine SHALL produce a
path on that machine before World inserts or reports the path to its terminal, and SHALL remain
subject to a declared size bound and stale-generation checks.

#### Scenario: Upload to a saved machine
- **WHEN** an admitted browser uploads a supported file to a current pane on a saved SSH machine
- **THEN** the bytes are staged on that machine with a bounded private path and only that remote path
  is delivered to the selected pane

#### Scenario: Remote upload fails
- **WHEN** remote staging, generation validation, or endpoint delivery fails
- **THEN** World reports the failure without inserting a local path into the remote terminal or
  silently rerouting the upload to another runtime

#### Scenario: Equal pane IDs on two machines
- **WHEN** notes, pins, or activity refer to equal native pane IDs owned by different machines
- **THEN** each record remains associated only with its qualified machine and pane and one
  machine's snapshot cannot prune or overwrite the other's records
