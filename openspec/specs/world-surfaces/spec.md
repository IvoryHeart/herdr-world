# World surfaces

## Purpose

Keep Spaces, Office, Tree and Graph as presentations over shared runtime state and terminal ownership.
See [knowledge map](../../../docs/knowledge-map.md) for source and historical rationale.

## Requirements

### Requirement: Shared presentation
The application SHALL derive one host-qualified World hierarchy from configured host profiles and
admitted runtime state, and SHALL share that hierarchy, qualified target identity, and terminal
ownership across its statically bundled Spaces and World surfaces. World SHALL support Office,
Tree and Graph as statically bundled themes. Office SHALL remain the bare `/` default, while Tree
SHALL use the canonical `/?theme=tree` URL and browser history behavior.

Each configured host SHALL be a root entity. Each observed Herdr space SHALL be a direct child of
its exact owning host. Each observed pane/terminal pair SHALL be represented exactly once as either
an agent or terminal child of its owning space. Agent and terminal entities SHALL be siblings in
the current hierarchy and SHALL retain stable terminal-backed identity when their classification,
label, status, focus, or summary changes.

Graph SHALL present hosts as its primary nodes and preserve the shared containment relationships in
its visual and semantic views. Themes MAY omit, aggregate, or relocate entities for presentation,
but SHALL NOT change their authoritative ancestry. A future child-agent relationship SHALL be
added only when an admitted authoritative source identifies the parent; the client MUST NOT infer
parentage from labels, paths, processes, or timing.

Tree SHALL present a bounded, top-down host to space to agent-or-terminal hierarchy with readable
connectors, bounded operational labels, and non-color-only kind, status, focus, connection, and
staleness cues. Search SHALL retain matching entities' ancestor context. Hosts and spaces SHALL be
independently collapsible, and Tree SHALL provide Fit, zoom, and pan controls. Tree SHALL disclose
bounded omitted counts and persist only its own validated viewport and collapse preferences.

Selecting a Tree entity by pointer or keyboard SHALL update shared selection without activation.
Tree SHALL show the selected entity's authoritative ancestry and current operational metadata.
Explicit terminal and Spaces actions SHALL be shown only when actionable; terminal activation,
including double-click activation, SHALL revalidate the exact host-qualified target and observed
runtime generation. Disabled, unavailable, stale, offline, replaced, or removed targets SHALL not
activate or resolve to a colliding target.

#### Scenario: Theme switch with an open terminal
- **WHEN** a user switches among Office, Tree and Graph
- **THEN** all themes interpret the same qualified host, space, agent, and terminal entities and a
  live terminal window retains its session and usable resize behavior

#### Scenario: Tree search and collapse
- **WHEN** a user searches for an entity or independently collapses host and space branches
- **THEN** matches retain their complete host and space context, unrelated branches are omitted,
  and clearing search restores the user's Tree-only collapse state

#### Scenario: Tree target becomes unavailable
- **WHEN** a selected Tree target becomes stale, offline, removed, generation-replaced, or loses a
  required capability before activation
- **THEN** activation is rejected with an accessible unavailable status and is not redirected to
  another host or native identifier

#### Scenario: Tree presentation failure
- **WHEN** the Tree theme fails to load or render
- **THEN** the failure remains within the World stage and offers canonical recovery to Office while
  shared runtime observation and live conversation ownership remain mounted

#### Scenario: Two hosts contain equal space and terminal identifiers
- **WHEN** two configured hosts report equal native space or terminal identifiers
- **THEN** the shared hierarchy contains distinct host-qualified subtrees and Tree and Graph connect
  every space, agent, and terminal only to its exact owning host

#### Scenario: Tree theme selection
- **WHEN** the user opens the accessible World theme selector and chooses Tree
- **THEN** Tree appears exactly once, navigation adds one canonical `/?theme=tree` history entry,
  and returning to Office uses bare `/`

#### Scenario: Host has no admitted snapshot
- **WHEN** a configured host is disabled, connecting, incompatible, or offline without cached
  topology
- **THEN** the shared hierarchy retains the host with its connection state and no invented child
  entities

#### Scenario: Terminal classification changes
- **WHEN** a pane changes between an empty terminal and a detected agent without changing its
  qualified terminal identity
- **THEN** its shared entity retains its identity and space ancestry while its terminal or agent
  interpretation updates

#### Scenario: Theme relocates an agent visually
- **WHEN** a theme places an agent in a status-specific area such as Office reception or the agent
  bar
- **THEN** the shared hierarchy still records that agent beneath its authoritative owning space

### Requirement: Optional observations
Observability providers SHALL remain optional. The bridge SHALL mediate bounded transport
and the browser SHALL NOT receive provider credentials.

#### Scenario: Provider absent
- **WHEN** no optional provider is available
- **THEN** core topology and terminals remain available without invented agent activity

### Requirement: Accessible navigation
World SHALL expose semantic entity navigation for compact layouts and reduced-motion use.

Tree's compact and reduced-motion presentations SHALL retain the same hierarchy, selection,
disclosure, details, and actionable controls without requiring precision pointer input. Controls
SHALL expose names, focus, selection and expansion state, and result or unavailable changes SHALL
be announced without relying on color or motion.

#### Scenario: Scene navigation without pointer precision
- **WHEN** the user selects an entity through semantic navigation
- **THEN** the same qualified entity is selected as through the visual scene

### Requirement: Common view navigation
The shared sidebar SHALL offer Spaces, Office, Tree and Graph once each through its View picker and SHALL preserve canonical URLs and browser history. Its Hosts picker SHALL retain host connection attention, qualified host selection and Add Host behavior. Compact layouts SHALL provide an explicit way to reopen the current view and restore focus when returning to the sidebar or navigating history.

#### Scenario: Tree through the common sidebar
- **WHEN** a user selects Tree from View and later navigates Back or Forward
- **THEN** the picker, rendered view and canonical `/?theme=tree` history agree, and any existing World terminal session remains owned by the shared shell

#### Scenario: Add Host from Tree
- **WHEN** a user chooses Add Host in the common sidebar while viewing Tree and cancels setup
- **THEN** connection setup uses the existing settings flow, navigation and saved profiles are preserved, and focus returns to Hosts

### Requirement: Tree Operations Console composition
Tree SHALL present the approved compact Operations Console composition with a common sidebar, a central top-down hierarchy and persistent operational inspection context. Cards SHALL distinguish host, space, agent and terminal kinds and expose status without relying on color. Connectors SHALL visibly join authoritative parent and child tiers, including unequal branches, and SHALL not imply hidden or absent child entities. Summary information SHALL derive only from admitted World data and SHALL distinguish presentation omissions.

#### Scenario: Desktop operational scan
- **WHEN** Tree renders observed hosts containing spaces and agent/terminal children
- **THEN** compact cards and connected tiers make their hierarchy legible while selection identity, ancestry, status and available actions remain accessible without leaving Tree

#### Scenario: Collapsed or empty branch
- **WHEN** a host or space has no presented children or is collapsed
- **THEN** it retains its identity and disclosure state without a dangling connector implying visible children

#### Scenario: Compact operation
- **WHEN** Tree is opened at phone width or used with reduced motion
- **THEN** the semantic hierarchy, search, disclosure, selection details and guarded actions remain reachable with named controls and no horizontal page overflow
