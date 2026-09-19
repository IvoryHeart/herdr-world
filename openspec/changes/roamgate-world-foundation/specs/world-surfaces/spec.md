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
does not create another application or competing runtime store. Selection SHALL not itself mutate
Herdr or change the selected connection.

Office, Tree and Graph SHALL retain every managed host in the shared WorldObject, including current
ready-inactive hosts and explicitly stale cached topology. The shell SHALL restore a valid
last/default managed profile as the selected operational host or present the existing connection
workflow before showing a visual view when no managed profile is selected. View navigation SHALL
not change that selection.

Terminal, Spaces, Inspector, room and launcher actions SHALL be available only when their target
belongs to the selected host and its current runtime generation. Selecting an entity on another
host SHALL remain useful and read-only. A ready-inactive host SHALL be labelled distinctly from an
offline or stale host and MAY expose an explicit Activate host control; entity selection or an
attempted operation SHALL NOT activate it implicitly.

#### Scenario: Move between Spaces and a visual view

- **WHEN** a user opens a qualified terminal in Spaces, visits Office, Tree or Graph and returns
- **THEN** the same Spaces application and terminal ownership remain available without another
  service or attachment

#### Scenario: Spaces is mounted but hidden

- **WHEN** Office, Tree or Graph is active and a Spaces operational shortcut is pressed
- **THEN** the mounted Spaces application does not create, focus, close or otherwise mutate a pane
  or workspace

#### Scenario: No managed host is selected

- **WHEN** the shell cannot restore a selected profile from the managed catalogue
- **THEN** World presents the existing connection workflow before Office, Tree or Graph and does
  not invent an operational host

#### Scenario: Inspect an entity on a ready-inactive host

- **WHEN** a user selects an entity on a ready host other than the selected operational host
- **THEN** World preserves its bounded detail, identifies the host as ready-inactive, leaves every
  operational control disabled and does not change the selected host

#### Scenario: Explicitly activate an observed host

- **WHEN** a user invokes Activate host for a ready-inactive host
- **THEN** World uses the existing selected-connection lifecycle, retires the outgoing host's
  scoped terminal and resource contexts, and enables actions only after the new host and generation
  are current

#### Scenario: Active host changes during an Office action

- **WHEN** the active connection or runtime generation changes while an Office entity is opening
- **THEN** the action is rejected before dispatch or before reporting success and never targets a
  colliding workspace on the newly active host

#### Scenario: Switch views with an open terminal

- **WHEN** a user switches among Office, Tree and Graph while a qualified conversation is open
- **THEN** every view interprets the same entity and the conversation remains owned by its exact
  connection and runtime generation

#### Scenario: Tree search and collapse

- **WHEN** a user searches for an entity or independently collapses host and space branches
- **THEN** matches retain their complete host and space context and clearing search restores the
  in-memory disclosure state

#### Scenario: Tree target becomes unavailable

- **WHEN** a selected Tree target becomes stale, offline, removed or generation-replaced before an
  action
- **THEN** the action is disabled or rejected and is not redirected to another host or colliding
  native identifier

#### Scenario: Two hosts contain equal identifiers

- **WHEN** two managed hosts report equal workspace, pane or terminal identifiers
- **THEN** the hierarchy contains distinct connection-qualified subtrees and an action is admitted
  only after its entity's owning connection is the selected operational host

#### Scenario: Two hosts contain equal space and terminal identifiers

- **WHEN** two managed hosts report equal native space or terminal identifiers
- **THEN** Tree and Graph connect every entity only within its distinct connection-qualified host
  subtree

#### Scenario: Host has no admitted snapshot

- **WHEN** a managed host is disconnected, connecting, incompatible or offline without cached
  topology
- **THEN** the hierarchy retains the host connection state without inventing child entities

#### Scenario: Host loses connectivity

- **WHEN** a previously observed host becomes unavailable
- **THEN** its cached hierarchy MAY remain visible as stale, but its entities do not admit terminal
  or Inspector actions

#### Scenario: Terminal classification changes

- **WHEN** a pane changes between an empty terminal and a detected agent without changing its
  connection or native pane identifier
- **THEN** its World entity retains identity and ancestry while its presentation kind changes

#### Scenario: A visual view relocates an agent

- **WHEN** Office, Tree or Graph places an agent differently for presentation
- **THEN** the shared hierarchy still records it beneath the authoritative owning host and space

### Requirement: Accessible navigation

World SHALL expose named, keyboard-reachable controls for view navigation, hierarchy disclosure,
selection and guarded actions. Compact layouts and reduced-motion use SHALL retain the same
semantic hierarchy and operational controls without requiring precision pointer input or motion.

#### Scenario: Navigate without pointer precision

- **WHEN** a user traverses World controls with a keyboard or assistive technology
- **THEN** view, selection, stale state and available actions are exposed by semantics
  and text rather than color or motion alone

#### Scenario: Scene navigation without pointer precision

- **WHEN** a user selects an entity through semantic keyboard or assistive navigation
- **THEN** the same connection-qualified entity is selected as through a pointer action

### Requirement: Common view navigation

The native World shell SHALL offer Spaces, Office, Tree and Graph once each and SHALL keep rendered
view, browser history and canonical paths `/spaces`, `/office`, `/tree` and `/graph` consistent.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
machine selector; the selected-host/runtime state and bounded ready/space/agent/stale summary SHALL
also remain in that top bar. World SHALL NOT stack a second view-navigation or Visual Control Plane
status bar above the application.
The inherited Spaces workspace navigator, focused tab strip and review-annotations control SHALL
remain the common frame around Spaces, Office, Tree and Graph. Changing views SHALL replace only the
center surface. Graph SHALL not place a second workspace hierarchy beside that common navigator on
desktop. Inspector-created review drafts SHALL remain visible and editable through the same
workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
the navigator or the focused tab strip SHALL resolve through the same qualified World selection
path and update the docked Inspector only after exact focus succeeds.
Office SHALL be the primary default surface after a valid managed profile is selected; Spaces SHALL
remain the first-class operational workspace and profile-management surface rather than being
removed or embedded into Office.
The existing Spaces connection selector SHALL remain the profile-management surface; visual World
views SHALL not introduce a second host catalogue and SHALL persistently identify the selected
operational host and its state. Checkpoint Tree or Graph implementations SHALL not be described as
complete until their view-specific acceptance passes.

#### Scenario: Browser history across views

- **WHEN** a user selects Tree, selects Graph and then navigates Back
- **THEN** the URL and rendered view return to Tree while the same shell retains terminal and
  Inspector ownership and the same selected host

#### Scenario: Use the single application top bar

- **WHEN** a user changes among Office, Spaces, Tree and Graph
- **THEN** the view selector, version, selected-host/runtime summary, machine selector and shell
  tools remain in one top bar and the selected view receives all remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Spaces, Office, Tree and Graph for the selected host
- **THEN** the same workspace navigator, focused tab context and annotations control remain
  available while only the center presentation changes and Graph adds no competing desktop outline

#### Scenario: Edit visual-view annotations

- **WHEN** a user creates or edits a terminal, file or diff review annotation from a visual-view
  Inspector
- **THEN** the common annotation panel opens for that exact connection-qualified workspace and all
  Inspector presentations observe subsequent edits without switching to Spaces

#### Scenario: Manage a host

- **WHEN** a user needs to add, edit, test, connect or remove a profile from a visual World view
- **THEN** opening Spaces exposes the existing managed connection workflow without another product
  or profile store

#### Scenario: Open World with a managed profile

- **WHEN** a user opens the World root with a valid restored or default managed profile
- **THEN** World opens Office as the primary surface and keeps Spaces available through the same
  navigation and shell

### Requirement: Native World shell

The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Spaces, Office, Tree and Graph. Those views SHALL share the
same connection identities, admitted topology, Inspector resources and terminal ownership; World
SHALL not embed or launch a separately branded Roamgate application.

#### Scenario: Install World only

- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and complete World visual views are available without installing Roamgate or another web bridge

#### Scenario: Use the Inspector without leaving a visual view

- **WHEN** a user selects an actionable space or pane on the selected operational host in Office,
  Tree or Graph and opens Files, Changes or Agent History
- **THEN** the selected visual view remains visible and the shell-owned Inspector uses only that
  entity's owning connection, runtime generation, workspace and optional pane context

#### Scenario: Activate a host from a visual view

- **WHEN** the user explicitly activates the ready-inactive host of a selected visual entity
- **THEN** the shell changes and revalidates the selected host through its existing connection
  lifecycle without treating the original entity selection as an operation

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
- **THEN** World identifies it as stale and disables operational terminal and Inspector actions

#### Scenario: Compact visual plane

- **WHEN** Office, Tree or Graph opens at phone width
- **THEN** navigation, hierarchy selection and guarded actions remain reachable without causing
  horizontal overflow of the application page

#### Scenario: Presentation bound is exceeded

- **WHEN** a view observes more entities than its tested presentation capacity
- **THEN** it prioritizes relevant live entities, reports exact omitted counts and never implies
  that omitted entities were removed from Herdr

### Requirement: Shared entity detail drawer

Office, Tree and Graph SHALL provide one consistent shell-owned Inspector surface that can appear as
the one docked overlay or as one of up to five movable desktop windows. Every Inspector SHALL
identify its qualified entity with a compact icon, name and bounded status or read-only-host cue and
SHALL give its primary area to immediately visible applicable Terminal, Files, Changes and Agent
History tabs. Identity and resources SHALL share one lifecycle, header and close control rather than
stack a separate agent profile card above the resource pane. Terminal SHALL be the first tab and the
initial tab for a newly opened terminal-capable entity; changing one Inspector's active tab SHALL NOT
change another Inspector or the default for a later entity.

Selecting an actionable entity in Tree or Graph SHALL open or focus its docked Inspector without
resizing, relaying out or otherwise taking workspace from the visual stage. Office visual and common
navigator selection SHALL follow the persisted Docked/Floating preference for newly opened entities
and SHALL focus an existing entity in its current presentation. Docked admission SHALL replace and
close a different docked conversation rather than implicitly turn it into a floating window. A
floating Inspector SHALL be independently movable and resizable and
expose Dock in and × controls. The docked Inspector SHALL expose Dock out, dock-position,
expand/restore and × controls and SHALL itself be movable while it remains an overlay. Choosing a
dock position or expand/restore SHALL snap it back to that explicit dock geometry. Docking a
floating Inspector while another is docked SHALL swap their
presentations without discarding either context or increasing the floating-window count. Docking or
undocking SHALL transfer the complete Inspector, including its selected tab and resource-selection
state, rather than transfer only a terminal child.

Selecting an actionable space or non-agent terminal pane SHALL use the same Inspector surface with
compact entity identity and only the tabs applicable to that entity. A space SHALL expose Files and
Changes. A non-agent terminal pane SHALL expose Files, Changes and Terminal. Agent History SHALL
appear only for an admitted agent session. Selecting a host SHALL retain bounded host detail and
activation state without inventing workspace resources.

Every Inspector SHALL expose generation-fenced resources only for the selected operational host. A
ready-inactive or stale entity SHALL retain a bounded read-only identity and an explicit Activate
host control outside the Inspector without opening live resources. An actionable entity SHALL NOT
retain a separate floating profile card. Missing metadata SHALL remain absent rather than inferred.
Authoritative cost, input-token, output-token or similar observations MAY appear in the compact
identity area only when the provider qualifies them to that exact agent session; unavailable or
merely host-wide observations SHALL not be shown as agent values or fabricated as zero.

Inspector instances SHALL reuse the shell's existing resource components, connection client,
caches and terminal owner while retaining independent active-tab, file/diff selection, history and
geometry state. They SHALL NOT create another application store, runtime observer, WebSocket, SSH
tunnel or terminal implementation. Opening the same qualified entity through another visual
representation SHALL focus its existing Inspector instead of creating a duplicate context.

Each Inspector SHALL remain visually connected to its represented agent, desk or hierarchy node
whenever that exact qualified anchor is visible. Opening or focusing an Inspector SHALL not change
the selected host. World SHALL admit identity and resource content together after qualified pane
focus; a delayed or rejected focus SHALL never show a new identity over another entity's resources.
Explicit host activation SHALL retire every outgoing Inspector and terminal context through the
existing connection lifecycle.

#### Scenario: Open a terminal-capable Inspector

- **WHEN** the user selects an actionable agent or non-agent terminal pane without an existing
  Inspector context or retained applicable tab preference
- **THEN** its docked Inspector opens Terminal as the initial resource while keeping Files, Changes
  and any admitted Agent History available as peer tabs

#### Scenario: Reposition a selected-agent Inspector

- **WHEN** the user docks, undocks, moves, resizes, expands or restores a selected-agent Inspector
- **THEN** compact identity, selected resource state, applicable tabs and the controls for that
  presentation remain reachable within the same Inspector

#### Scenario: Dock while another Inspector is docked

- **WHEN** Inspector A is docked and the user invokes Dock in on floating Inspector B
- **THEN** B becomes docked, A takes B's floating presentation, both retain their independent
  resource state and no additional floating slot is consumed

#### Scenario: Inspect an agent with a task summary

- **WHEN** the user selects an admitted agent with a visible scene representation and bounded task
  summary
- **THEN** the Inspector overlay opens over the unchanged visual stage, shows compact qualified agent
  identity, exposes its resource tabs and task summary within the relevant intent content, and draws
  a connector to that agent

#### Scenario: Open rich agent context

- **WHEN** the user changes among Files, Changes and Agent History in two actionable agent
  Inspectors on the selected operational host
- **THEN** each Inspector retains its own tab and resource selection for the exact qualified
  workspace and session while reusing the shell's existing resource implementations

#### Scenario: Inspect a non-agent World entity

- **WHEN** the user selects an actionable space or non-agent terminal pane in Office, Tree or Graph
- **THEN** the same overlay presents its compact qualified identity and applicable shell-owned
  Files, Changes or Terminal tabs without fabricating Agent History or changing the selected host

#### Scenario: Inspect an agent with qualified observations

- **WHEN** an optional observation provider reports cost or token metrics qualified to the selected
  agent session
- **THEN** the compact identity area may show those values, while unavailable or host-only values
  remain absent

#### Scenario: Inspect an agent on an inactive host

- **WHEN** a user selects a current agent on a ready-inactive host
- **THEN** the detail context remains available, identifies the inactive host and offers explicit
  host activation without opening terminal or Inspector resources

#### Scenario: Change selection while focus is delayed or rejected

- **WHEN** opening or focusing entity B requires asynchronous pane focus
- **THEN** World publishes B's identity only with B's admitted resources, leaves every existing
  Inspector bound to its original entity and opens no B context if focus is rejected

#### Scenario: Selected entity becomes stale

- **WHEN** an Inspector entity's host disconnects or advances beyond the observed generation
- **THEN** World preserves bounded inspection information from the selected generation, marks or
  closes the retired context according to current admitted state, disables every operational action
  and never rebinds it to an equal identifier in the replacement generation

#### Scenario: Agent metadata is unavailable

- **WHEN** an agent exposes no task summary, model label or state label
- **THEN** its compact identity and available resource tabs remain useful without fabricating what
  the agent is doing or implemented

### Requirement: Qualified task-summary reporting

World SHALL provide and document a supported producer for reporting, updating and clearing an
optional task summary through the owning Herdr runtime's metadata API. A report SHALL be bound to
the pane's active agent session, normalized, limited to 160 Unicode characters, filtered for
obvious credential-shaped values and assigned a bounded expiry no longer than 24 hours. The
default expiry SHALL be 15 minutes. Reporting SHALL NOT require the World web service to start and
SHALL NOT make task summaries mandatory for local or SSH operation.

#### Scenario: Harness publishes and updates current work

- **WHEN** a harness reports a task summary for a pane with an active agent session and later
  reports a replacement
- **THEN** World presents only the latest bounded summary for that exact qualified pane and session

#### Scenario: Harness clears current work

- **WHEN** the producer clears the task summary for its exact pane and active session
- **THEN** the summary disappears after Herdr admits the metadata update without restarting World

#### Scenario: Summary expires or the session changes

- **WHEN** a reported summary reaches its expiry or its bound agent session is replaced
- **THEN** World stops presenting it and never carries it to another pane, session or host

#### Scenario: Remote host has no summary producer

- **WHEN** an SSH-connected Herdr runtime has no optional task-summary producer installed
- **THEN** its topology, agents, terminals and actions remain usable and World does not infer a
  summary

### Requirement: Operational agent and pane watchlist

World SHALL let a user Pin and Unpin an exact connection-qualified live agent or terminal pane and
filter the relevant agent/pane presentation to Pinned only. The bounded World-owned watchlist SHALL
survive browser refresh, SHALL remain distinct from workspace pins and Graph position pins, and
SHALL never use a native pane identifier without its connection identity. A stale pinned item MAY
retain bounded inspection context and be unpinned, but SHALL NOT admit runtime actions. World SHALL
remove a pin after current authoritative state confirms that exact pane no longer exists.

#### Scenario: Pin colliding pane identifiers

- **WHEN** two hosts expose the same native pane identifier and the user pins one
- **THEN** only the selected qualified pane is pinned and Pinned only does not include the other

#### Scenario: Pinned host disconnects

- **WHEN** a pinned pane's host becomes stale or reconnects into a new runtime generation
- **THEN** the pin never redirects to a colliding pane, runtime actions remain unavailable until
  the exact target is re-admitted, and the user can remove the watchlist entry

#### Scenario: Pinned pane is authoritatively removed

- **WHEN** a current admitted snapshot confirms that the exact pinned pane no longer exists
- **THEN** World prunes its pin rather than retaining an actionable orphan

### Requirement: Pixel Office scene

Office SHALL preserve the established Pixel Office composition rather than replace it with generic
workspace cards. It SHALL present a CEO Office with the user/CEO, one qualified reception station
per presented host, bounded authoritative status and optional-observability boards, a separate
Agent Bar, road-separated work rooms, desks and agent characters. Work rooms SHALL represent real
Herdr workspaces, desks SHALL represent admitted tabs, and scene relocation SHALL not change an
entity's authoritative host or space ancestry. The Agent Bar SHALL retain its counter, rear shelf
and one bounded occupancy cue per visible bar agent rather than becoming an ordinary work room.
For the retained synthetic fixtures, the migrated Office SHALL preserve the established scene
signature, geometry and visual composition from World commit
`9c8f650853ad2d598d476dac1eecdeaea16716c6`, except where this change explicitly replaces a
runtime or shell-owned interaction boundary.

Room geometry SHALL derive from admitted content and title/action requirements. Two-to-eight-seat
room forms, sequential natural-width row packing, left/centre/right row alignment, validated
expand-or-ellipsis long-title behavior, title and action containment, nested decoration bounds,
logical-canvas scrolling and stable room gaps SHALL remain available. A wide room in one row SHALL
NOT force unrelated rows to that width.

#### Scenario: Render multiple hosts and unequal rooms

- **WHEN** several hosts expose workspaces with different tab counts and title lengths
- **THEN** Office presents their reception stations and content-sized work rooms without merging
  identities, clipping required headers or replacing the scene with equal-width cards

#### Scenario: Compare the retained Pixel Office fixture

- **WHEN** the approved dense synthetic Office fixture is rendered through the migrated projection
- **THEN** its CEO Office, receptions, boards, Agent Bar, roads, rooms, desks, characters, labels
  and deterministic layout match the retained Pixel Office baseline rather than a substitute
  DOM/CSS interpretation

#### Scenario: Render Office while Spaces is hidden

- **WHEN** Office is the active route and the mounted Spaces surface is not visible
- **THEN** the complete Office scene renders from its projection without reading or depending on
  Spaces layout DOM, while operational callbacks continue to use shell-owned services

#### Scenario: Office opens at a narrow width

- **WHEN** the viewport cannot contain the resolved logical Office width
- **THEN** the Office stage provides bounded internal navigation and semantic targets while the
  application shell itself remains within the viewport

#### Scenario: Optional observation provider is unavailable

- **WHEN** no optional observation provider is configured or healthy
- **THEN** topology, rooms, terminals and authoritative Herdr state remain usable and Office does
  not invent cost, activity or completion data

#### Scenario: Configure an optional observation provider

- **WHEN** the user opens the World settings from any native view or the Office metrics shortcut
  and saves a supported credential-free provider URL
- **THEN** the World service validates and applies it, reports bounded health and updates the
  relevant Office boards without exposing provider access or credentials to the browser, and both
  entry points edit the same service-owned setting

### Requirement: Office state and room operations

Office SHALL place working and unknown agents with their owning work room, blocked agents at their
qualified host reception, and idle or done agents in the Agent Bar. A done agent's originating desk
SHALL retain a bounded generic completion marker until that qualified completion is inspected; this
browser-local seen state SHALL NOT represent approval or mutate Herdr.

Office SHALL retain bounded hover callouts, task summaries, state cues, at least 48 by 48 CSS-pixel
semantic targets and a compact Agents/Rooms/Desks chooser. Selected identity and detail SHALL live
in the shared Inspector rather than a duplicate persistent scene badge. Capability-gated room creation,
rename and close actions and room-local seat creation SHALL operate on real workspaces and tabs. A
room at eight desks SHALL retain a disabled Room Full affordance rather than hiding capacity.

Office SHALL expose a persisted Inspector opening preference with Docked and Floating modes. In
Docked mode, a newly opened Office entity SHALL use the single docked Inspector and remain available
for explicit Dock out. In Floating mode, each newly opened Office entity SHALL use its own bounded,
cascaded floating Inspector until the conversation limit is reached. Changing the preference SHALL
govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
existing entity SHALL focus its current presentation.

When several working or unknown room-destination agents share one tab, Office SHALL choose at most
one deterministic seated occupant using the established state/focus priority and SHALL present
remaining room-local agents as standing only within the tested per-room agent bound. Working or
unknown room-destination agents belonging to tabs omitted beyond the eight-desk presentation bound
SHALL remain eligible for that bounded standing presentation. Blocked agents SHALL remain at their
qualified reception, idle or done agents SHALL remain in the Agent Bar, and every bounded omission
SHALL contribute to the exact relevant omitted count. Presented desks and agents SHALL keep
distinct, nonduplicated semantic targets.

#### Scenario: Agent status changes location

- **WHEN** an admitted agent changes from working to blocked and later to done
- **THEN** the same qualified agent moves from its room to reception and then the Agent Bar while
  its ancestry, selection and terminal identity remain stable

#### Scenario: Choose the default Office Inspector presentation

- **WHEN** the user selects Docked or Floating in Office settings and opens new Office entities
- **THEN** Docked reuses the single docked target, Floating opens distinct bounded cascaded windows,
  existing presentations remain in place and the preference is restored on the next Office visit

#### Scenario: Create a seat in a room

- **WHEN** the selected host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room, shows the desk only after Herdr
  admits the resulting tab and pane, retains the live Office instance across that topology update,
  and boundedly retries exact qualified focus until it selects or opens that new terminal or the
  originating lease becomes invalid

#### Scenario: Seat creation is cancelled or fails

- **WHEN** the user cancels seat creation or the launcher fails before Herdr admits a new pane
- **THEN** Office preserves the prior selection, focused Inspector context and every existing
  qualified conversation window for the selected host without detaching or redirecting input

#### Scenario: Mixed-state agents share a tab or exceed the desk bound

- **WHEN** working or unknown agents share a tab or belong to a ninth or later tab while blocked,
  idle or done agents occupy the same tab or overflow range
- **THEN** Office seats at most one deterministic room-local occupant per visible desk, presents
  remaining room-local agents as standing only within the tested bound, keeps blocked agents at
  reception and idle or done agents in the Agent Bar, reports exact omissions and exposes no
  duplicate semantic target

#### Scenario: User inspects a completion

- **WHEN** the user selects a completion marker, originating desk, notice or corresponding agent
- **THEN** Office opens or focuses the exact qualified terminal and marks that completion seen only
  after activation succeeds

#### Scenario: Completion activation is unavailable

- **WHEN** a completion target is on an inactive host, stale, incompatible or cannot be opened
- **THEN** Office retains its unseen marker and bounded notice, explains that inspection is
  unavailable and does not treat selection as acknowledgement

#### Scenario: Several completions arrive

- **WHEN** several distinct completions are admitted before the user inspects them
- **THEN** Office deduplicates repeated evidence for the same completion and retains a bounded,
  individually targetable presentation for the distinct unseen completions

#### Scenario: Room action is unavailable

- **WHEN** a room belongs to an inactive host, is stale or full, or its host lacks the required
  capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation

### Requirement: Shared live terminal conversations

Office, Tree and Graph SHALL open qualified agents, occupied desks and terminal nodes in live
Inspector conversations backed by the shell's existing resource and terminal/session owners.
Selecting the same qualified entity through another representation SHALL focus its existing
Inspector instead of creating a competing resource context or terminal attachment. Every open
conversation SHALL belong to the one selected operational host and its current runtime generation.
World SHALL use the current Roamgate-derived terminal, Files, Changes and Agent History components
and existing bridge connection; it SHALL NOT carry or synchronize replacement implementations from
Herdr Web. Retained World window code MAY provide presentation around the complete Inspector
without owning resource or terminal transport.

An Office desk activation SHALL open or focus that entity's Inspector on its Terminal tab in the
presentation selected by the Office preference, preserving direct terminal access without creating
a terminal-only window. The same qualified terminal SHALL have exactly one live Terminal presentation at a time.
Docking, undocking or swapping Inspectors SHALL explicitly hand off that attachment after the old
target detaches while preserving the Inspector's selected tab and other resource state.

If ordinary selection replaces a docked Inspector, World SHALL close the outgoing docked
conversation before mounting the replacement context and SHALL NOT create a floating window in
Docked mode. Floating conversations SHALL arise only from an explicit Dock out action or a new
Office entity activation while Floating mode is selected. Explicitly docking a floating
conversation into an occupied dock SHALL continue to swap the two retained conversations.

The floating Inspector header SHALL expose Dock in and × controls. The docked Inspector SHALL
expose Dock out and × controls plus its dock-position and expand controls. Closing either
presentation SHALL close only that qualified Inspector and SHALL NOT silently open another window.
The Inspector SHALL NOT expose a second Open in Spaces shortcut; Spaces remains available through
the primary view selector without changing terminal identity or attaching another session.

Desktop SHALL support up to five floating Inspector conversations alongside the one docked
Inspector, with independent bounded position, size, z-order, selected tab, resource selection and
close/focus behavior. Terminal tabs SHALL keep text at configured metrics, refit to real dimensions
and retain usable input, selection, scrolling, uploads and mobile controls. Compact layouts SHALL
present one active usable Inspector. Spatial views SHALL connect every visible Inspector to its
represented desk, agent or node. These connectors SHALL track qualified anchors when either endpoint
moves and SHALL never imply a different runtime ancestry, resource scope or terminal identity.

Conversation identity and validity SHALL be qualified by connection and runtime generation inside
the existing selected-connection browser lease. Opening another window or navigating among Office,
Tree and Graph SHALL NOT detach, redirect or duplicate conversations while that host and generation
remain selected. Selecting Spaces SHALL suspend every visual Inspector presentation so the native
Spaces workspace is unobstructed and SHALL transfer the exact selected terminal presentation only
after its visual owner detaches. The retained visual conversation state SHALL be restored when the
user returns to a visual view. Explicitly activating another host SHALL retire every outgoing visual
and Spaces terminal mount before the replacement becomes operational; World SHALL NOT retain
simultaneous terminal conversations from several hosts in this change. All conversations SHALL use
the one World browser WebSocket and existing terminal owner.

Mounted-but-hidden Spaces SHALL NOT keep a competing terminal attachment for a terminal currently
presented by a visual conversation. A handoff between a visual conversation and visible Spaces MAY
remount the current terminal UI, but SHALL preserve the qualified Herdr terminal/session identity,
SHALL NOT close or recreate the server terminal and SHALL order presentation teardown and admission
so that terminal is never mounted twice. The newly visible presenter SHALL refit to its actual
dimensions, expose the applicable compact input controls and accept input without a second click;
returning browser focus SHALL restore the terminal cursor only when that terminal held focus before
the browser lost it.

#### Scenario: Open the same terminal from two representations

- **WHEN** a user opens an agent and then its occupied desk or hierarchy node
- **THEN** World focuses one qualified Inspector conversation and does not create another resource
  context, transport or duplicate input path

#### Scenario: Open a terminal from an Office desk

- **WHEN** a user activates an actionable occupied or terminal desk in Office
- **THEN** World opens or focuses its qualified Inspector on Terminal in the current Docked or
  Floating default presentation and draws a connector to the represented desk or agent

#### Scenario: Move an Inspector between docked and floating presentations

- **WHEN** a user invokes Dock in or Dock out on an Inspector with Terminal, Files, Changes or
  History selected
- **THEN** World transfers the complete Inspector and its resource state, preserves any qualified
  terminal session and never leaves duplicate content or input ownership in the previous target

#### Scenario: Change selection while an Inspector is docked

- **WHEN** entity A has the docked Inspector and the user selects entity B
- **THEN** World closes A's docked conversation and mounts B as the matching docked Inspector without
  opening an A floating window or redirecting B to A's terminal

#### Scenario: Select an entity from the common navigator

- **WHEN** the user selects an actionable space or agent in the common workspace navigator while
  Office, Tree or Graph is active
- **THEN** the matching qualified World entity opens in the docked Inspector with the same identity
  and resources as selecting that entity inside the active visual

#### Scenario: Dock into an occupied Inspector target

- **WHEN** entity A is docked and the user docks floating Inspector B
- **THEN** World swaps A into B's floating presentation and B into the dock without losing either
  resource context or increasing the floating-window count

#### Scenario: Present a terminal while Spaces remains mounted

- **WHEN** a visual Inspector presents a qualified Terminal tab and Spaces remains mounted but hidden
- **THEN** the Roamgate-derived terminal uses the existing browser connection and Spaces does not
  attach a second terminal view for that identity

#### Scenario: Move between visual views and Spaces

- **WHEN** a live conversation exists and the user changes World views, including selecting Spaces
  through the primary view selector
- **THEN** Office, Tree and Graph preserve the conversation and its view-local geometry, visible
  Spaces hides every visual Inspector, presents the exact selected terminal through its native
  workspace, and each handoff refits without duplicating or recreating the Herdr terminal session

#### Scenario: Return to a previously focused terminal

- **WHEN** a presented terminal held the browser focus and the user returns after focusing another
  application or browser window
- **THEN** the same active terminal reclaims its cursor and accepts input without an extra click,
  while a terminal that did not previously hold focus does not steal it

#### Scenario: Explicitly switch hosts with conversations open

- **WHEN** a user explicitly activates another host while one or more conversations are open
- **THEN** World retires every outgoing conversation before admitting the new selected-host lease
  and never redirects input to a colliding terminal on the replacement host

#### Scenario: Selected conversation host reconnects

- **WHEN** the selected host reconnects while one or more conversations are open
- **THEN** World retires every conversation from the replaced generation and enables a new
  attachment only after the current generation is admitted

#### Scenario: Conversation target temporarily disappears

- **WHEN** a snapshot refresh or reconnect temporarily omits a conversation target
- **THEN** World retains the conversation until current admitted state confirms the qualified pane
  no longer exists

#### Scenario: Desktop conversation limit is reached

- **WHEN** five distinct conversations are open and the user requests a sixth
- **THEN** World keeps the existing floating and docked Inspectors and reports the bounded limit
  visibly

### Requirement: Connected Tree presentation

Tree SHALL use a deterministic connected branch presentation with hosts, spaces and agent or
terminal leaves in distinct tiers. Visible connectors SHALL join only authoritative parent-child
relationships. Tree SHALL support search with complete ancestor context, independent host and space
disclosure, selection, the shared entity context and qualified actions. The connected presentation
currently used by the foundation checkpoint's Graph view SHALL become Tree; an indented list SHALL
serve only as an equivalent compact or assistive presentation rather than the primary desktop view.
Tree SHALL bound presentation to 128 hosts, 128 spaces globally and 16 leaves per presented space,
using the same relevance priority as Graph. Both its connected and semantic presentations SHALL
consume that one bounded projection and report exact omitted host, space and leaf counts globally
and at the affected branch; search SHALL operate only over the honestly presented projection.

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

#### Scenario: Tree exceeds its presentation capacity

- **WHEN** a dense unequal hierarchy exceeds Tree's host, global-space or per-space leaf bounds
- **THEN** Tree prioritizes selected, focused and attention-requiring entities, renders neither
  presentation outside the shared bounds, and reports exact global and affected-branch omissions

### Requirement: Spatial Graph presentation

Graph SHALL restore the interactive spatial canvas over the qualified host-space-agent-or-terminal
hierarchy. It SHALL provide deterministic initial placement, topology-only layout reheating,
dragging and pinning, bounded pan and zoom, Fit, search, independent disclosure, selection, the
shared entity context, saved camera and node positions, visible status changes and live terminal
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
remain inside its stage and SHALL NOT terminate aggregate observation, the shell-owned Inspector,
mounted Spaces or live terminal ownership.

#### Scenario: Switch repeatedly among complete views

- **WHEN** the user changes among Office, Tree and Graph while a terminal is live
- **THEN** selection and terminal ownership remain stable, each view restores only its own
  presentation state and runtime subscription counts do not increase

#### Scenario: One view fails to render

- **WHEN** a view-specific renderer cannot load or throws during presentation
- **THEN** World reports a bounded failure with navigation to another view while Spaces, connection
  management, Inspector resources and existing terminals remain usable

## REMOVED Requirements

### Requirement: Tree Operations Console composition

**Reason**: The list-primary Operations Console is replaced by the connected Tree presentation in
this change and remains only as an equivalent compact or assistive hierarchy.

**Migration**: Use the connected Tree as the primary desktop hierarchy and the equivalent semantic
hierarchy when a spatial presentation is unsuitable.
