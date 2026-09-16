## MODIFIED Requirements

### Requirement: Shared presentation
The application SHALL derive one connection-qualified World hierarchy from the World service's
managed profiles and admitted runtime snapshots. Each managed connection SHALL be a host root,
each observed Herdr workspace SHALL be its direct space child, and each observed pane SHALL appear
exactly once as an agent or terminal child of its owning space. Equal native identifiers on
different connections SHALL remain distinct. A pane SHALL retain stable terminal-backed identity
when its agent classification, label, status or focus changes.

Spaces, Office, Tree and Graph SHALL consume the same connection and generation identities. The
Spaces terminal workspace SHALL remain mounted while another view is visible so changing views
does not create a competing terminal attachment. Selection SHALL not itself mutate Herdr. Explicit
handoff or Inspector actions SHALL revalidate the exact connection and runtime generation and
SHALL be unavailable for stale observations.

#### Scenario: Move between Spaces and a visual view
- **WHEN** a user opens a qualified terminal in Spaces, visits Office, Tree or Graph and returns
- **THEN** the same Spaces application and terminal ownership remain available without another
  service or attachment

#### Scenario: Theme switch with an open terminal
- **WHEN** a user switches among Office, Tree and Graph while a terminal is open in Spaces
- **THEN** every view interprets the same qualified entities and returning to Spaces restores the
  mounted usable terminal without another attachment

#### Scenario: Tree search and collapse
- **WHEN** a user searches for an entity or independently collapses host and space branches
- **THEN** matches retain their complete host and space context and clearing search restores the
  in-memory disclosure state

#### Scenario: Tree target becomes unavailable
- **WHEN** a selected Tree target becomes stale, offline, removed or generation-replaced before an
  action
- **THEN** the action is disabled or rejected and is not redirected to another host or colliding
  native identifier

#### Scenario: Tree presentation failure
- **WHEN** the World projection cannot render its Tree presentation
- **THEN** the application exposes the failure explicitly and does not dispatch an operation from
  incomplete presentation state

#### Scenario: Two hosts contain equal identifiers
- **WHEN** two managed hosts report equal workspace, pane or terminal identifiers
- **THEN** the hierarchy contains distinct connection-qualified subtrees and every action resolves
  only through the selected entity's owning connection

#### Scenario: Two hosts contain equal space and terminal identifiers
- **WHEN** two managed hosts report equal native space or terminal identifiers
- **THEN** Tree and Graph connect every entity only within its distinct connection-qualified host
  subtree

#### Scenario: Tree theme selection
- **WHEN** the user chooses Tree from the native World navigation
- **THEN** Tree appears exactly once at canonical path `/tree` and browser history returns to the
  prior canonical World view

#### Scenario: Host has no admitted snapshot
- **WHEN** a managed host is disconnected, connecting, incompatible or offline without cached
  topology
- **THEN** the hierarchy retains the host connection state without inventing child entities

#### Scenario: Host loses connectivity
- **WHEN** a previously observed host becomes unavailable
- **THEN** its cached hierarchy MAY remain visible as stale, but its entities do not admit terminal
  handoff or Inspector actions

#### Scenario: Terminal classification changes
- **WHEN** a pane changes between an empty terminal and a detected agent without changing its
  connection or native pane identifier
- **THEN** its World entity retains identity and ancestry while its presentation kind changes

#### Scenario: Theme relocates an agent visually
- **WHEN** Office, Tree or Graph places an agent differently for presentation
- **THEN** the shared hierarchy still records it beneath the authoritative owning host and space

### Requirement: Accessible navigation
World SHALL expose named, keyboard-reachable controls for view navigation, hierarchy disclosure,
selection and guarded actions. Compact layouts and reduced-motion use SHALL retain the same
semantic hierarchy and operational controls without requiring precision pointer input or motion.

#### Scenario: Navigate without pointer precision
- **WHEN** a user traverses the World controls with a keyboard or assistive technology
- **THEN** view, selection, expansion, stale state and available actions are exposed by semantics
  and text rather than color or motion alone

#### Scenario: Scene navigation without pointer precision
- **WHEN** a user selects an entity through semantic keyboard or assistive navigation
- **THEN** the same connection-qualified entity is selected as through a pointer action

### Requirement: Common view navigation
The native World shell SHALL offer Spaces, Office, Tree and Graph once each and SHALL keep rendered
view, browser history and canonical paths `/spaces`, `/office`, `/tree` and `/graph` consistent.
The existing Spaces connection selector SHALL remain the profile-management surface; visual World
views SHALL not introduce a second host catalogue.

#### Scenario: Browser history across views
- **WHEN** a user selects Tree, selects Graph and then navigates Back
- **THEN** the URL and rendered view return to Tree while the mounted Spaces terminal state remains
  owned by the same shell

#### Scenario: Tree through the common sidebar
- **WHEN** a user selects Tree from the common navigation and later navigates Back or Forward
- **THEN** the rendered view and canonical `/tree` history agree and mounted Spaces terminal state
  remains owned by the same shell

#### Scenario: Manage a host
- **WHEN** a user needs to add, edit, test, connect or remove a profile from a visual World view
- **THEN** opening Spaces exposes the existing managed connection workflow without another product
  or profile store

#### Scenario: Add Host from Tree
- **WHEN** a user leaves Tree for Spaces to add a host and cancels setup
- **THEN** the existing connection workflow preserves navigation and saved profiles without
  creating another catalogue

## ADDED Requirements

### Requirement: Native World shell
The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Spaces, Office, Tree and Graph. These views SHALL share the
same connection identities, admitted topology and terminal ownership; World SHALL not embed or
launch a separately branded Roamgate application.

#### Scenario: Install World only
- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and World visual views are available without installing Roamgate or another web bridge

#### Scenario: Use a host-specific Inspector from an aggregate World view
- **WHEN** a user selects an actionable space or pane and opens Files, Changes or Agent History
- **THEN** the Inspector uses only that entity's owning connection, runtime generation and
  workspace context

### Requirement: Bounded World view composition
Office SHALL present host-grouped rooms and agent or terminal desks. Tree SHALL present a searchable
and independently collapsible host-space-pane hierarchy. Graph SHALL present the same containment
relationships with searchable and collapsible branches. All three views SHALL bound displayed
labels, keep stale state visible, and keep their stage within the application viewport on desktop
and compact screens.

#### Scenario: Search and collapse
- **WHEN** a user searches Tree or Graph or collapses a host or space branch
- **THEN** search retains the complete ancestor context of matches and clearing search restores the
  view's in-memory disclosure state

#### Scenario: Select a stale entity
- **WHEN** a user inspects an entity retained from an unavailable host
- **THEN** World identifies it as stale and disables operational handoff and Inspector actions

#### Scenario: Compact visual plane
- **WHEN** Office, Tree or Graph opens at phone width
- **THEN** navigation, hierarchy selection and guarded actions remain reachable without causing
  horizontal overflow of the application page

## REMOVED Requirements

### Requirement: Tree Operations Console composition
**Reason**: The old browser-federated Tree canvas, viewport persistence, pan/zoom controls and
persistent side inspector depended on the retired application foundation. This change establishes
the shared native hierarchy and a bounded searchable/collapsible Tree first; richer view-specific
canvas behavior is independent follow-up work.

**Migration**: Use the native `/tree` hierarchy and its qualified Open in Spaces, Files, Changes
and Agent History actions. Existing Tree-only viewport preferences are intentionally not imported.
