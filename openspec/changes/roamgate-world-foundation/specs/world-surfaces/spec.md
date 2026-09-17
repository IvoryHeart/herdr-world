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

#### Scenario: Spaces is mounted but hidden
- **WHEN** Office, Tree or Graph is the active view and a Spaces operational shortcut is pressed
- **THEN** the mounted Spaces application does not create, focus, close or otherwise mutate a pane
  or workspace

#### Scenario: Active host changes during handoff
- **WHEN** the active connection or runtime generation changes while a World entity is opening
- **THEN** the handoff is rejected before dispatch or before reporting success and never targets a
  colliding workspace on the newly active host

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
Office, Tree and Graph SHALL each present their complete view-specific composition over the shared
hierarchy. Each view SHALL use explicit tested entity and label bounds, report exact presentation
omissions, keep stale state visible, and contain its stage within the application viewport. Internal
canvas movement or logical scrolling MAY expose a larger composition without creating horizontal
overflow on the application page.

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

#### Scenario: Presentation bound is exceeded
- **WHEN** a view observes more entities than its tested presentation capacity
- **THEN** it prioritizes relevant live entities, reports exact omitted counts and never implies
  that omitted entities were removed from Herdr

### Requirement: Shared entity detail drawer
Office, Tree and Graph SHALL provide one consistent selected-entity drawer without creating a
second Inspector or runtime store. The drawer SHALL show the selected entity's bounded admitted
identity, host and space ancestry, connection freshness, kind and actionable state. For agents it
SHALL also show available agent/model labels, state labels, status and task summary. It SHALL expose
only relevant generation-fenced Open terminal, Open in Spaces, Files, Changes and Agent History
actions. Missing metadata SHALL remain absent rather than being inferred.

#### Scenario: Inspect an agent with a task summary
- **WHEN** an admitted agent reports a bounded task summary and the user selects it in any visual
  view
- **THEN** the drawer shows that summary, its qualified ancestry and the actions supported by its
  current host generation

#### Scenario: Selected entity becomes stale
- **WHEN** the selected entity's host disconnects or advances beyond the observed generation
- **THEN** the drawer preserves bounded inspection context, marks it stale and disables every
  operational action

#### Scenario: Agent metadata is unavailable
- **WHEN** an agent exposes no task summary, model label or state label
- **THEN** the drawer remains useful without fabricating what the agent is doing or implemented

### Requirement: Pixel Office scene
Office SHALL preserve the established Pixel Office composition rather than replace it with generic
workspace cards. It SHALL present a CEO Office with the user/CEO, one qualified reception station
per presented host, bounded authoritative status and optional-observability boards, a separate
Agent Bar, road-separated work rooms, desks and agent characters. Work rooms SHALL represent real
Herdr workspaces, desks SHALL represent admitted tabs, and scene relocation SHALL not change an
entity's authoritative host or space ancestry. The Agent Bar SHALL retain its counter, rear shelf
and one bounded occupancy cue per visible bar agent rather than becoming an ordinary work room.

Room geometry SHALL derive from admitted content and title/action requirements. Two-to-eight-seat
room forms, sequential natural-width row packing, left/centre/right row alignment, validated
expand-or-ellipsis long-title behavior, title and action containment, nested decoration bounds,
logical-canvas scrolling and stable room gaps SHALL remain available. A wide room in one row SHALL
NOT force unrelated rows to that width.

#### Scenario: Render multiple hosts and unequal rooms
- **WHEN** several hosts expose workspaces with different tab counts and title lengths
- **THEN** Office presents their reception stations and content-sized work rooms without merging
  identities, clipping required headers or replacing the scene with equal-width cards

#### Scenario: Office opens at a narrow width
- **WHEN** the viewport cannot contain the resolved logical Office width
- **THEN** the Office stage provides bounded internal navigation and semantic targets while the
  application shell itself remains within the viewport

#### Scenario: Optional observation provider is unavailable
- **WHEN** no optional observation provider is configured or healthy
- **THEN** topology, rooms, terminals and authoritative Herdr state remain usable and Office does
  not invent cost, activity or completion data

#### Scenario: Configure an optional observation provider
- **WHEN** the user saves a supported credential-free provider URL in Office settings
- **THEN** the World service validates and applies it, reports bounded health and updates the
  relevant Office boards without exposing provider access or credentials to the browser

### Requirement: Office state and room operations
Office SHALL place working and unknown agents with their owning work room, blocked agents at their
qualified host reception, and idle or done agents in the Agent Bar. A done agent's originating desk
SHALL retain a bounded generic completion marker until that qualified completion is inspected; this
browser-local seen state SHALL NOT represent approval or mutate Herdr.

Office SHALL retain bounded hover/selection callouts, task summaries, state cues, at least 48 by 48
CSS-pixel semantic targets and a compact Agents/Rooms/Desks chooser. Capability-gated room creation,
rename and close actions and room-local seat creation SHALL operate on real workspaces and tabs. A
room at eight desks SHALL retain a disabled Room Full affordance rather than hiding capacity.

#### Scenario: Agent status changes location
- **WHEN** an admitted agent changes from working to blocked and later to done
- **THEN** the same qualified agent moves from its room to reception and then the Agent Bar while
  its ancestry, selection and terminal identity remain stable

#### Scenario: Create a seat in a room
- **WHEN** the selected host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room and shows the desk only after Herdr
  admits the resulting tab

#### Scenario: Room action is unavailable
- **WHEN** a room is stale, full or its host lacks the required capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation

### Requirement: Shared live terminal conversations
Office, Tree and Graph SHALL open qualified agents, occupied desks and terminal nodes in live
conversation windows backed by the shell's existing terminal/session owner. Selecting the same
terminal through another representation SHALL focus the existing conversation instead of creating
a competing attachment. Explicit handoff SHALL focus that same pane in mounted Spaces.

Desktop SHALL support up to five distinct conversations with independent bounded position, size,
z-order and close/focus behavior. Windows SHALL keep terminal text at its configured metrics,
refit to their real dimensions and retain usable input, selection, scrolling, uploads and mobile
controls. Compact layouts SHALL present one active usable conversation. Spatial views SHALL connect
each window to its represented desk, agent or node and keep that association legible when either
endpoint moves or leaves the visible stage.

#### Scenario: Open the same terminal from two representations
- **WHEN** a user opens an agent and then its occupied desk or hierarchy node
- **THEN** World focuses one qualified conversation and does not create another transport or send
  duplicate input

#### Scenario: Move between visual views and Spaces
- **WHEN** a live conversation exists and the user changes World views or chooses Open in Spaces
- **THEN** terminal identity and session ownership remain stable, view-local geometry is preserved
  where applicable and Spaces receives focus without reattaching another session

#### Scenario: Conversation target temporarily disappears
- **WHEN** a snapshot refresh or reconnect temporarily omits a conversation target
- **THEN** World retains the conversation until current admitted state confirms the qualified pane
  no longer exists

#### Scenario: Desktop conversation limit is reached
- **WHEN** five distinct conversations are open and the user requests a sixth
- **THEN** World keeps the existing conversations and reports the bounded limit visibly

### Requirement: Connected Tree presentation
Tree SHALL use a deterministic connected branch presentation with hosts, spaces and agent or
terminal leaves in distinct tiers. Visible connectors SHALL join only authoritative parent-child
relationships. Tree SHALL support search with complete ancestor context, independent host and space
disclosure, selection, the shared detail drawer and qualified actions. The connected presentation
currently used by the foundation checkpoint's Graph view SHALL become Tree; an indented list SHALL
serve only as an equivalent compact or assistive presentation rather than the primary desktop view.

#### Scenario: Scan an unequal multi-host hierarchy
- **WHEN** hosts contain different numbers of spaces and leaves
- **THEN** Tree keeps each branch visibly connected to its exact parent without dangling lines or
  equalizing unrelated branches

#### Scenario: Search and clear Tree
- **WHEN** a user searches for an agent and later clears the query
- **THEN** the result retains its host and space context and Tree restores the user's prior
  independent disclosure state

#### Scenario: Use Tree without a spatial pointer
- **WHEN** a keyboard, screen-reader or compact-layout user operates Tree
- **THEN** the equivalent semantic hierarchy exposes the same selection, task summary, stale state
  and guarded actions

### Requirement: Spatial Graph presentation
Graph SHALL restore the interactive spatial canvas over the qualified host-space-agent-or-terminal
hierarchy. It SHALL provide deterministic initial placement, topology-only layout reheating,
dragging and pinning, bounded pan and zoom, Fit, search, independent disclosure, selection, the
shared detail drawer, saved camera and node positions, visible status changes and live terminal
conversation connectors. Status-only updates SHALL NOT reset settled positions or camera state.

Graph SHALL bound presentation to 128 hosts, 128 spaces globally and 16 leaves per presented space,
with exact overflow reporting and priority for focused, working, blocked and detected-agent nodes.
It SHALL provide an equivalent semantic hierarchy and SHALL pause or release animation, observers,
listeners and retained layout work when hidden or unmounted.

#### Scenario: Equal native identifiers exist on two hosts
- **WHEN** two hosts expose the same workspace, pane or terminal identifier
- **THEN** Graph renders distinct qualified nodes and connects each only inside its owning host
  subtree

#### Scenario: Live status changes on a settled graph
- **WHEN** agent labels or statuses change without topology changes
- **THEN** Graph updates its cues and detail content without resetting zoom, disclosure, selection,
  pinned positions or the settled layout

#### Scenario: Operate Graph semantically
- **WHEN** the canvas is not perceivable or precise pointer input is unavailable
- **THEN** the user can find, inspect and invoke the same allowed terminal and Spaces actions from
  the bounded semantic hierarchy

#### Scenario: Leave and return to Graph
- **WHEN** a user leaves Graph while it is animating and later returns
- **THEN** hidden renderer work does not consume resources or create runtime subscriptions, and the
  bounded saved camera, disclosure and pinned positions are restored

### Requirement: View-local continuity and failure isolation
Selection of a qualified entity SHALL survive Office, Tree and Graph changes while that entity
exists. Office layout/scroll/conversation preferences, Tree disclosure and Graph camera/pinned-node
preferences SHALL use distinct validated World-owned storage. A view load or render failure SHALL
remain inside its stage and SHALL NOT terminate aggregate observation, the shared detail drawer,
mounted Spaces or live terminal ownership.

#### Scenario: Switch repeatedly among complete views
- **WHEN** the user changes among Office, Tree and Graph while a terminal is live
- **THEN** selection and terminal ownership remain stable, each view restores only its own
  presentation state and runtime subscription counts do not increase

#### Scenario: One view fails to render
- **WHEN** a view-specific renderer cannot load or throws during presentation
- **THEN** World reports a bounded failure with navigation to another view while Spaces, connection
  management and existing terminals remain usable

## REMOVED Requirements

### Requirement: Tree Operations Console composition
**Reason**: The owner prefers the simpler connected branch presentation introduced by this
foundation over the archived oversized Operations Console Tree composition. Runtime qualification,
search, disclosure, details and guarded actions are retained without its specific dashboard layout.

**Migration**: Use the canonical `/tree` connected branch hierarchy and shared entity drawer.
Existing Operations Console camera preferences are intentionally not imported; the indented
hierarchy remains available only as a compact or assistive equivalent.
