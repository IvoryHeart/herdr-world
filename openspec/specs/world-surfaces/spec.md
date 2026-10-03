# World surfaces

## Purpose

Keep Spaces, Office, Tree and Graph as native presentations over one filtered aggregate,
independent qualified operational contexts, one docked Inspector and floating Inspectors,
and exclusive ownership of each qualified terminal.

## Requirements

### Requirement: Shared presentation

The application SHALL derive one connection-qualified World hierarchy from the World service's
managed profiles and admitted runtime snapshots. Each managed connection SHALL be a host root,
each observed Herdr workspace SHALL be its direct space child, and each observed pane SHALL appear
exactly once as an agent or terminal child of its owning space. Equal native identifiers on
different connections SHALL remain distinct. A pane SHALL retain stable terminal-backed identity
when its agent classification, label, status or focus changes.

Spaces, Office, Tree and Graph SHALL consume the same connection and generation identities and
reuse shell-owned Inspector resources and terminal ownership. Selection SHALL not itself mutate
Herdr. All managed hosts SHALL be observed independently of the browser's view filter.

Office, Tree and Graph SHALL present the aggregate filtered by All hosts or an explicit set of
managed hosts. Counts and search SHALL use the same filter and distinguish current, stale and
omitted observations. Every managed host in scope SHALL retain a qualified root, including offline
hosts without children. A host filter SHALL NOT connect, disconnect, select an operational runtime,
retire an open context or change an in-flight operation's target.

Terminal, Spaces, Inspector, room and launcher actions SHALL use their captured owning connection,
current generation and entity identity with current capability and resource admission. They SHALL
be available across compatible ready hosts without a global operational-host selection. Stale or
unavailable targets SHALL explain their state without falling back to another host.

#### Scenario: Move between Spaces and a visual view

- **WHEN** a user opens a qualified terminal in Spaces, visits Office, Tree or Graph and returns
- **THEN** the same Spaces application and terminal ownership remain available without another
  service or attachment

#### Scenario: Spaces is mounted but hidden

- **WHEN** Office, Tree or Graph is active and a Spaces operational shortcut is pressed
- **THEN** the mounted Spaces application does not create, focus, close or otherwise mutate a pane
  or workspace

#### Scenario: No managed host is selected

- **WHEN** no managed profiles exist
- **THEN** World presents connection onboarding without inventing a host

#### Scenario: Open an unavailable catalogue

- **WHEN** profiles exist but none is ready
- **THEN** the overview retains their health and explicitly stale cached topology with actions disabled

#### Scenario: Inspect an entity on a ready-inactive host

- **WHEN** two managed hosts have current topology and All hosts is in effect
- **THEN** views, counts and search include both qualified subtrees and their admitted actions
  require no host activation

#### Scenario: Explicitly activate an observed host

- **WHEN** a user filters to one host while Inspectors on two hosts are open
- **THEN** the overview narrows, both contexts retain their targets and validity, and the excluded
  Inspector is labelled outside the filter without a false visual connector

#### Scenario: Active host changes during an Office action

- **WHEN** the owning generation changes while an Office entity is opening
- **THEN** the obsolete action cannot dispatch or report success for a replacement context and
  never targets a colliding workspace on another host

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
  only against its entity's current owning connection and generation

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

### Requirement: Optional observations
Observability providers SHALL remain optional. The service SHALL mediate bounded transport
and the browser SHALL NOT receive provider credentials.

#### Scenario: Provider absent
- **WHEN** no optional provider is available
- **THEN** core topology and terminals remain available without invented agent activity

### Requirement: Session-qualified task summaries

The packaged `herdr-world task-summary` command SHALL report a normalized, redacted,
80-Unicode-code-point-or-shorter `task_summary` token and a SHA-256 fingerprint token
for one explicitly identified Herdr pane without starting the World web service. The
fingerprint SHALL cover `JSON.stringify([source, agent, kind, value])` for that pane's
current Herdr `agent_session`; World SHALL show the producer token only when the exact
current session still matches it. The command SHALL accept `--pane` or `HERDR_PANE_ID`,
the existing named-session selection, and an explicitly requested fixed-policy SSH
transport. It SHALL use the same TTL for both tokens, default to 900,000 milliseconds,
accept only 1 through 86,400,000 milliseconds, and leave expiry to Herdr. It SHALL NOT
offer `--clear`, because Herdr cannot conditionally delete pane-global token keys by
expected session identity.

#### Scenario: Current session reports work

- **WHEN** a harness reports `Reviewing CI` for an exact pane with an active session
- **THEN** Herdr receives the summary and its paired fingerprint in one metadata call,
  and Office, Tree, Graph and Inspector show the text after their existing observation
  path refreshes

#### Scenario: Session is replaced or observations disagree

- **WHEN** a pane starts another session, has no complete session, or pane and agent
  observations disagree about the session
- **THEN** a summary fingerprinted for the prior session is absent from World surfaces

#### Scenario: Delayed cleanup is invoked

- **WHEN** a former hook invokes `herdr-world task-summary --clear`
- **THEN** the command exits with a usage error before requesting pane metadata, leaving
  any newer summary intact

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

### Requirement: Visual-route Actions

Office, Tree and Graph SHALL expose a common named Actions control for the explicitly selected
space, agent or terminal. The control SHALL be reachable by pointer and keyboard on desktop and
compact layouts, identify the captured host, space and pane as applicable, and offer the
target's existing applicable Terminal, Files, Changes, Agent History and Go to Spaces actions.
It SHALL also expose view-wide window arrangements independently of entity selection. The shell's
right-side Roamgate-derived Actions command menu SHALL retain its original shell commands and add
target actions, Pin, Unpin, Pinned only and arrangements in visual views, without a duplicate
view-toolbar Actions control; the view toolbar SHALL keep search available.
Target actions SHALL reuse the shared Inspector and explicit owning-context focus path; they SHALL NOT use
hidden Spaces focus, create another terminal owner, send terminal input, assign tasks or control
an agent lifecycle. A missing or unavailable target SHALL explain why no target action can run.

Before dispatch, Actions SHALL validate the captured connection ID, runtime generation, entity
identity and current selected entity against current qualified target admission. Changing the
selected entity or its generation, or losing target admission, SHALL invalidate the capture and prevent
an action from falling through to a colliding entity or hidden Spaces state. Go to Spaces SHALL
focus the exact validated target before changing the visible view and SHALL leave the visual view
visible if that focus fails.

#### Scenario: Open Actions for a selected agent

- **WHEN** a user selects an actionable agent in Office, Tree or Graph and opens Actions
- **THEN** the menu identifies that agent and offers its admitted Inspector resources and Go to
  Spaces

#### Scenario: No actionable selection exists

- **WHEN** a user opens Actions without an actionable space or pane selected
- **THEN** it asks the user to select a visual entity for target actions, keeps window arrangements available, and does not use the last focused Spaces pane

#### Scenario: Choose an Inspector resource

- **WHEN** a user chooses Terminal, Files, Changes or Agent History from Actions
- **THEN** the shared Inspector opens or focuses that resource for the exact selected entity while
  preserving the current visual view and terminal ownership

#### Scenario: Go to Spaces

- **WHEN** a user chooses Go to Spaces for a current space or pane
- **THEN** World focuses that qualified target before Spaces becomes visible without changing the
  host filter or creating a pane

#### Scenario: The capture retires before dispatch

- **WHEN** the selected entity, its runtime generation or its current target admission changes while Actions
  is open
- **THEN** World invalidates the capture, reports that target actions are unavailable, and performs no target action

### Requirement: Common view navigation

The native World shell SHALL offer Spaces, Office, Tree and Graph once each and SHALL keep rendered
view, browser history and canonical paths `/spaces`, `/office`, `/tree` and `/graph` consistent.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
Hosts filter; a muted aggregate health indicator with the bounded space/agent/stale summary
in its accessible label and tooltip SHALL remain in that top bar. The shell SHALL provide one shared view-control slot there: Office, Tree and
Graph SHALL place search in it, and Graph SHALL additionally place Fit and zoom in it. World SHALL
NOT stack a second view-navigation, Visual Control Plane status bar or view-local search/zoom header
above the application stage.
The inherited Spaces workspace navigator, focused tab strip and review-annotations control SHALL
remain the common frame around Spaces, Office, Tree and Graph. Changing views SHALL replace only the
center surface. Graph SHALL not place a second workspace hierarchy beside that common navigator on
desktop. Inspector-created review drafts SHALL remain visible and editable through the same
workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
the navigator or the focused tab strip SHALL resolve through the same qualified World selection
path and update the docked Inspector only after exact focus succeeds.
Office SHALL be the primary default surface when managed profiles exist; Spaces SHALL
remain the first-class operational workspace and profile-management surface rather than being
removed or embedded into Office.
The common shell SHALL expose Manage connections separately from its Hosts filter using the
existing managed catalogue. Every operational workspace or Inspector SHALL identify its owning host
and state. The common navigator SHALL group workspaces by host within the filter; an already-open
workspace outside that filter SHALL retain its labelled context.
Office room alignment, long-title treatment, Inspector presentation and optional observability
configuration SHALL live in the common settings menu on desktop, compact and Zen layouts. Office
SHALL NOT reserve a persistent toolbar or mobile/Zen shortcut strip for those infrequent controls.

#### Scenario: Browser history across views

- **WHEN** a user selects Tree, selects Graph and then navigates Back
- **THEN** the URL and rendered view return to Tree while the same shell retains terminal and
  Inspector ownership and each context's owning host

#### Scenario: Use the single application top bar

- **WHEN** a user changes among Office, Spaces, Tree and Graph
- **THEN** the view selector, version, aggregate health summary, Hosts filter, Manage connections, applicable
  search/Fit/zoom controls and shell tools remain in one top bar and the selected view receives all
  remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Spaces, Office, Tree and Graph with the current host filter
- **THEN** the same workspace navigator, focused tab context and annotations control remain
  available while only the center presentation changes and Graph adds no competing desktop outline

#### Scenario: Edit visual-view annotations

- **WHEN** a user creates or edits a terminal, file or diff review annotation from a visual-view
  Inspector
- **THEN** the common annotation panel opens for that exact connection-qualified workspace and all
  Inspector presentations observe subsequent edits without switching to Spaces

#### Scenario: Manage a host

- **WHEN** a user needs to add, edit, test, connect or remove a profile from a visual World view
- **THEN** Manage connections exposes the existing workflow from the common shell without changing
  the current view, filter or unrelated contexts

#### Scenario: Open World with a managed profile

- **WHEN** a user opens the World root with at least one managed profile
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
  and native World visual views are available without installing Roamgate or another web bridge

#### Scenario: Use the Inspector without leaving a visual view

- **WHEN** a user selects an actionable space or pane on any admitted managed host in Office,
  Tree or Graph and opens Files, Changes or Agent History
- **THEN** the selected visual view remains visible and the shell-owned Inspector uses only that
  entity's owning connection, runtime generation, workspace and optional pane context

#### Scenario: Activate a host from a visual view

- **WHEN** a stale context explains its host is disconnected and the user reconnects it through
  Manage connections
- **THEN** only that runtime reconnects and newly opened resources require current target admission,
  without retiring other hosts or replaying the stale action

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

#### Scenario: Search Office from the common header

- **WHEN** a user searches the filtered aggregate from Office and chooses a matching entity
- **THEN** World selects that exact qualified entity without adding an Office stage toolbar or
  changing connection lifecycle or the host filter

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
the one docked overlay or as a movable desktop window. Every Inspector SHALL
identify its qualified entity with a compact icon, name and bounded status or read-only-host cue and
SHALL give its primary area to immediately visible applicable Terminal, Files, Changes and Agent
History tabs. Identity and resources SHALL share one lifecycle, header and close control rather than
stack a separate agent profile card above the resource pane. Terminal SHALL be the first tab and the
initial tab for a newly opened terminal-capable entity; changing one Inspector's active tab SHALL NOT
change another Inspector or the default for a later entity.

Selecting an actionable entity in Graph SHALL open or focus its docked Inspector without resizing,
relaying out or otherwise taking workspace from the visual stage. Selecting an actionable Tree leaf
SHALL expand that exact leaf to host the same shell-owned Inspector inline; Dock out SHALL transfer
the complete conversation to a floating window and Dock in while Tree is active SHALL return it to
the exact visible leaf. Only one Tree leaf SHALL host the inline dock target at a time. Office visual
selection SHALL follow the persisted Docked/Floating preference for newly opened entities and SHALL
focus an existing entity in its current presentation. The common workspace navigator and focused
tab strip SHALL always admit the matching entity into the docked Inspector, independently of the
Office preference. Docked admission SHALL replace and
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

Every Inspector SHALL expose generation-fenced resources only for its own admitted connection. A
stale selection MAY retain a bounded read-only identity and SHALL explain its unavailable state
and offer connection management when applicable, without opening live resources. An actionable entity SHALL NOT
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
the host filter or another context's target. World SHALL admit identity and resource content together after qualified pane
focus; a delayed or rejected focus SHALL never show a new identity over another entity's resources.
Changing the host filter SHALL preserve Inspector and terminal contexts. Runtime retirement SHALL
retire only contexts owned by that connection and generation.

#### Scenario: Open a terminal-capable Inspector

- **WHEN** the user selects an actionable agent or non-agent terminal pane without an existing
  Inspector context or retained applicable tab preference
- **THEN** its configured Inspector presentation opens Terminal as the initial resource while keeping
  Files, Changes and any admitted Agent History available as peer tabs

#### Scenario: Reposition a selected-agent Inspector

- **WHEN** the user docks, undocks, moves, resizes, expands or restores a selected-agent Inspector
- **THEN** compact identity, selected resource state, applicable tabs and the controls for that
  presentation remain reachable within the same Inspector, and an explicit dock-position change
  leaves the named dock fully visible

#### Scenario: Expand and detach a Tree leaf Inspector

- **WHEN** a user opens an actionable Tree leaf, docks it out and later docks it back while Tree is
  active
- **THEN** the exact leaf expands inline, the complete Inspector moves to the floating presentation
  and back without duplicate resources or terminal ownership, and any previous inline leaf collapses

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
  Inspectors on different ready managed hosts
- **THEN** each Inspector retains its own tab and resource selection for the exact qualified
  workspace and session while reusing the shell's existing resource implementations

#### Scenario: Inspect a non-agent World entity

- **WHEN** the user selects an actionable space or non-agent terminal pane in Office, Tree or Graph
- **THEN** the same overlay presents its compact qualified identity and applicable shell-owned
  Files, Changes or Terminal tabs without fabricating Agent History or changing the host filter

#### Scenario: Inspect an agent with qualified observations

- **WHEN** an optional observation provider reports cost or token metrics qualified to the selected
  agent session
- **THEN** the compact identity area may show those values, while unavailable or host-only values
  remain absent

### Requirement: Agent checkout source-control context

For an actionable agent Inspector, World SHALL read Agent checkout context only from
a complete versioned report whose session fingerprint matches the exact active pane
session on the Inspector's connection and generation. It SHALL use a bounded
read-only Git query on that reported checkout, show its branch and changed files,
and keep Workspace changes as an explicit separate choice. World SHALL NOT infer
the checkout from workspace or terminal CWD, another session, or another host. A
reported HTTPS PR link SHALL be labelled Reported PR. Agent checkout SHALL expose no
Git mutations. Reports omit TTL and Clear; they become unavailable on session
replacement, pane closure, or Herdr restart.

#### Scenario: Agent checkout differs from workspace changes

- **WHEN** two agents in one workspace report different current-session worktrees
- **THEN** each Inspector shows its own reported branch and changed files, while
  Workspace changes remains separately labelled and selectable

#### Scenario: Checkout report is absent or replaced

- **WHEN** metadata is absent, malformed, lost after restart, or its session or
  generation changes while a request is pending
- **THEN** Agent checkout shows an unavailable reason and a Workspace changes
  choice, and no old checkout, PR, or changed files enter that Inspector

#### Scenario: Inspect an agent on an inactive host

- **WHEN** an open Inspector belongs to a current ready host excluded by the overview filter
- **THEN** its qualified checkout resources remain usable and its identity indicates it is outside
  the filter, without changing its host or agent session

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

#### Scenario: Switch between hosts with unequal rooms

- **WHEN** several filtered managed hosts expose workspaces with different tab counts and title lengths
- **THEN** Office groups content-sized rooms under clearly identified hosts, preserving each room's
  qualified identity and required headers without equalizing unrelated rooms

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

- **WHEN** the user opens the World settings from any native view and saves a supported
  credential-free provider URL
- **THEN** the World service validates and applies it, reports bounded health and updates the
  relevant Office boards without exposing provider access or credentials to the browser

### Requirement: Terminal file links use the originating Inspector

Activating a workspace file link in a terminal presented by Office, Tree or Graph SHALL bring that
terminal's exact Inspector window forward, select its Files resource and open the linked file in
that Inspector. The action SHALL preserve the originating connection, runtime generation,
workspace, pane and file location. It SHALL NOT change another Inspector's active resource or file
selection, redirect to a different pane, or require a prior manual Files selection. Spaces SHALL
retain its single-Inspector behavior.

#### Scenario: Open a link from one of several visual windows

- **WHEN** two terminal Inspectors are open and the user activates a file link in the second terminal
- **THEN** the second Inspector comes forward on Files with that file selected and the first
  Inspector retains its resource and file state

#### Scenario: File link target retires

- **WHEN** the source Inspector's connection, runtime generation, workspace or pane retires before
  a file-link request is admitted
- **THEN** the request does not open the file in another Inspector or on another host, and the user
  receives an unavailable indication

### Requirement: Exact visual terminal input focus

In Office, Tree and Graph, activating an Inspector window whose selected resource is Terminal
SHALL focus its terminal input and its selected pane. Explicitly selecting a pane within that
window SHALL make that exact pane the input recipient, including when another pane or window was
previously focused. Bringing a window forward SHALL NOT route typed input to another pane. Moving
between visual views SHALL preserve the qualified pane target. Selecting a non-Terminal resource
SHALL not steal keyboard focus for terminal input.

#### Scenario: Answer an agent in a split terminal

- **WHEN** an agent in one pane requests input and the user selects that pane in an Office or Graph
  Inspector before typing
- **THEN** the selected pane receives the input and no other pane receives it

#### Scenario: Activate a terminal window

- **WHEN** the user activates a visual Inspector showing Terminal by pointer or keyboard while
  another terminal was focused
- **THEN** its selected pane becomes the keyboard target without a second click inside the terminal

#### Scenario: Pane or lease becomes unavailable

- **WHEN** the selected pane closes, changes tab, or its connection generation retires during
  visual focus handoff
- **THEN** World rejects the obsolete target and does not send input to a fallback pane, window or host

### Requirement: Office pane-linked devices

Office SHALL present a distinct device for each pane admitted to a presented tab's bounded visual
display, grouped with the tab's desk. Working or unknown agents sharing that tab SHALL appear near
their pane devices within the bounded room layout. Each device SHALL remain at its tab desk while
its agent moves to reception or the Agent Bar, and SHALL disappear when its pane closes or its
qualified runtime retires. Activating a device SHALL open or focus the Inspector Terminal for that
exact connection, generation and pane. Devices, desks and agents SHALL have distinct keyboard- and
pointer-accessible targets and names; a device SHALL communicate when a desk has multiple panes
without changing the meaning of the desk as a tab.

Pane devices and nearby agents SHALL fit within the existing desk-cell width and row height without
enlarging ordinary Office rooms. Their compact targets SHALL be at least 24 by 24 CSS pixels and
SHALL NOT overlap each other or the tab desk target.

The desk's existing screen SHALL be a laptop for the first presented pane and display the exact
observed pane count. Office SHALL present up to three additional panes as small monitor screens to
its left, right and above, each opening its own pane. Further panes SHALL remain available through
the chooser without adding more desk art.

#### Scenario: Two agents work in one tab

- **WHEN** a tab contains two admitted panes with working agents
- **THEN** Office groups both agents and their distinct pane devices around the same desk, indicates
  multiple panes, and each device opens its own pane

#### Scenario: Five agents work at one desk

- **WHEN** a tab contains five working agents in five admitted panes
- **THEN** Office shows the seated agent and four nearby agents around the same desk within its
  existing cell, keeps their faces and pane screens visible, and presents the exact pane count on
  the laptop while the fifth pane remains available through the chooser

#### Scenario: Pane roster exceeds one chooser page

- **WHEN** more panes are admitted than fit on one compact chooser page
- **THEN** Office offers bounded page navigation and every admitted pane remains individually
  selectable and activatable from the chooser

#### Scenario: Agent leaves a pane device

- **WHEN** an agent becomes blocked, done or idle while its pane remains open
- **THEN** the agent moves according to status and its device remains at the original tab desk as
  an exact pane target

#### Scenario: Pane closes or exceeds the presentation bound

- **WHEN** a pane closes or more panes are admitted than Office can present around a desk
- **THEN** closed-pane devices disappear, presented devices do not overlap or claim another pane's
  target, and omitted panes remain discoverable through a bounded count or chooser

#### Scenario: More than four panes share a desk

- **WHEN** five or more panes are admitted to one tab
- **THEN** the laptop shows the exact pane count, only the laptop and three surrounding monitors
  are drawn, and the chooser lists the remaining exact pane targets

### Requirement: Office reception capacity

Office SHALL add bounded standing positions around each host's shared reception table when seats
fill without expanding the CEO band solely for those agents and SHALL expose an exact overflow count and roster targets
for agents beyond its visual bound. The compact standing agents SHALL retain separate targets of at
least 24 by 24 CSS pixels.

#### Scenario: Reception fills

- **WHEN** blocked and done agents together exceed the host reception's seats and then its bounded
  standing positions
- **THEN** they share the reception table and nearby standing area up to the visual bound, and an
  exact overflow count and roster preserve access to the remaining qualified agents

### Requirement: Office state and room operations

Office SHALL place working and unknown agents with their owning work room, blocked and done agents
at their qualified host reception, and idle agents in the Agent Bar. Reception SHALL use one shared
table per host for blocked and done agents, mark blocked agents with `?` and done agents with `✔`,
and keep the status available in text and accessible names rather than symbol or color alone. A
done agent's originating desk SHALL retain a bounded generic completion marker until that qualified
completion is inspected; this browser-local seen state SHALL NOT represent approval, mutate Herdr
or move a still-done agent to the bar.

Office SHALL retain bounded hover callouts, task summaries, state cues, at least 48 by 48 CSS-pixel
semantic targets outside compact desk and reception groups, and a compact Agents/Rooms/Desks chooser. Selected identity and detail SHALL live
in the shared Inspector rather than a duplicate persistent scene badge. Capability-gated room creation,
rename and close actions and room-local seat creation SHALL operate on real workspaces and tabs. A
room at eight desks SHALL retain a disabled Room Full affordance rather than hiding capacity.

Office SHALL expose a persisted Inspector opening preference with Docked and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved. In
Docked mode, a newly opened Office entity SHALL use the single docked Inspector and remain available
for explicit Dock out. In Floating mode, each newly opened Office entity SHALL use its own
cascaded floating Inspector without a fixed presentation-count cap. Changing the preference SHALL
govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
existing entity SHALL focus its current presentation.

When several working or unknown room-destination agents share one tab, Office SHALL choose at most
one deterministic seated occupant using the established state/focus priority and SHALL present
remaining room-local agents as standing only within the tested per-room agent bound. Working or
unknown room-destination agents belonging to tabs omitted beyond the eight-desk presentation bound
SHALL remain eligible for that bounded standing presentation. Blocked and done agents SHALL remain
at their qualified reception, idle agents SHALL remain in the Agent Bar, and every bounded omission
SHALL contribute to the exact relevant omitted count. Presented desks and agents SHALL keep
distinct, nonduplicated semantic targets.

#### Scenario: Agent status changes location

- **WHEN** an admitted agent changes from working to blocked, then done, and later idle
- **THEN** the same qualified agent moves from its room to reception with `?`, stays at reception
  with `✔` while done, and moves to the Agent Bar only when idle, while its ancestry, selection and
  terminal identity remain stable

#### Scenario: Choose the default Office Inspector presentation

- **WHEN** the user selects Docked or Floating in the common settings menu and opens new Office
  entities
- **THEN** Docked reuses the single docked target, Floating opens distinct bounded cascaded windows,
  existing presentations remain in place and the preference is restored on the next Office visit

#### Scenario: Use Office controls on compact or Zen layouts

- **WHEN** the user needs room alignment, long-title, Inspector-opening or observability settings
- **THEN** the common menu exposes them without an Office toolbar or shortcut strip consuming scene
  space

#### Scenario: Create a seat in a room

- **WHEN** the room's owning host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room, shows the desk only after Herdr
  admits the resulting tab and pane, retains the live Office instance across that topology update,
  and boundedly retries exact qualified focus until it opens the new Inspector on Terminal with the
  created pane selected and its multi-pane state visible, or the originating lease becomes invalid

#### Scenario: Seat creation is cancelled or fails

- **WHEN** the user cancels seat creation or the launcher fails before Herdr admits a new pane
- **THEN** Office preserves the prior selection, focused Inspector context and every existing
  qualified conversation window across admitted hosts without detaching or redirecting input

#### Scenario: Mixed-state agents share a tab or exceed the desk bound

- **WHEN** working or unknown agents share a tab or belong to a ninth or later tab while blocked,
  idle or done agents occupy the same tab or overflow range
- **THEN** Office seats at most one deterministic room-local occupant per visible desk, presents
  remaining room-local agents near their desk within the tested bound, keeps blocked and done agents
  at reception and idle agents in the Agent Bar, reports exact omissions and exposes no
  duplicate semantic target

#### Scenario: User inspects a completion

- **WHEN** the user selects a completion marker, originating desk, notice or corresponding agent
- **THEN** Office opens or focuses the exact qualified terminal and marks that completion seen only
  after activation succeeds, without moving the still-done agent from reception

#### Scenario: Completion activation is unavailable

- **WHEN** a completion target is stale, incompatible or cannot be opened
- **THEN** Office retains its unseen marker and bounded notice, explains that inspection is
  unavailable and does not treat selection as acknowledgement

#### Scenario: Several completions arrive

- **WHEN** several distinct completions are admitted before the user inspects them
- **THEN** Office deduplicates repeated evidence for the same completion and retains a bounded,
  individually targetable presentation for the distinct unseen completions

#### Scenario: Room action is unavailable

- **WHEN** a room is stale or full, or its host lacks the required
  capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation

### Requirement: Consistent terminal window controls

Every terminal window presented in Office SHALL provide accessible maximize and resize controls, including floating, docked, and temporarily arranged windows. Maximize SHALL temporarily expand the selected window over the available Office stage while preserving its current arrangement participants. It SHALL save the complete prior presentation and geometry, including dock or arrangement placement, so the window's Restore control returns it to that state. Resizing SHALL update the selected window's usable dimensions without changing its terminal or conversation ownership. If global Restore positions is invoked while a window is maximized, it SHALL restore the captured arrangement baseline and clear the maximize snapshot so a later window Restore cannot reinstate stale placement.

#### Scenario: Maximize and restore a floating terminal
- **WHEN** a user maximizes a floating terminal window in Office and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior size and position when restored

#### Scenario: Maximize and restore a docked terminal
- **WHEN** a user maximizes a docked terminal window in Office and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior dock and size

#### Scenario: Maximize and restore an arranged terminal
- **WHEN** a user maximizes one terminal window in an Office arrangement and then restores it
- **THEN** it returns to its prior arranged placement while the other arrangement participants retain their geometry

#### Scenario: Restore arrangement positions while a window is maximized
- **WHEN** a user invokes Restore positions while an arranged terminal window is maximized
- **THEN** participants return to their captured baseline presentation and geometry, and a later window Restore does not restore the superseded maximized snapshot

#### Scenario: Resize any Office terminal window
- **WHEN** a user resizes a floating, docked, or arranged terminal window
- **THEN** the selected window changes size and its terminal remains attached to the same conversation

#### Scenario: Use window controls without a pointer
- **WHEN** a user navigates to maximize or resize controls with a keyboard or assistive technology
- **THEN** each control has an accessible name and can be operated without pointer precision

### Requirement: Focus determines terminal window stacking

When a terminal window receives focus, World SHALL raise it above every other visible terminal window, regardless of window presentation or arrangement. Subsequent focus SHALL update the stacking order so the most recently focused window is on top.

#### Scenario: Focus a window behind another window
- **WHEN** a user focuses a terminal window that is behind another visible terminal window
- **THEN** the focused window moves above the other windows

#### Scenario: Focus changes after arranging windows
- **WHEN** windows have been arranged and the user focuses a different terminal window
- **THEN** the newly focused window is on top while the other windows retain their current geometry

### Requirement: Close all terminal windows from view menus

The arrangement menu and the shared Actions menu SHALL each offer the same accessible action to close all terminal windows. The action SHALL dismiss World terminal presentations without closing Herdr panes or tabs, ending terminal processes or sessions, or changing the host filter or connection lifecycle. It SHALL be available independently of visual entity selection. Its scope and reopen behavior SHALL follow the Close all clauses in the modified Arrange existing terminal windows requirement.

#### Scenario: Close every presented terminal window
- **WHEN** a user invokes Close all terminal windows from either menu while multiple terminal windows are open
- **THEN** all terminal windows in that view's arrangement set are dismissed and the underlying Herdr tabs, panes, processes, and sessions remain open

#### Scenario: Close all without an entity selection
- **WHEN** no visual entity is selected and terminal windows are open
- **THEN** the user can invoke the same close-all action from either menu

#### Scenario: No terminal windows are open
- **WHEN** a user opens either menu with no terminal windows presented
- **THEN** Close all terminal windows is unavailable or has no effect and does not change the underlying Herdr state

### Requirement: Rotate the Graph arrangement

Graph SHALL provide accessible controls to rotate its arrangement 90 degrees left or right. Each activation SHALL apply one quarter-turn from the current orientation, repeated activations SHALL accumulate in the chosen direction, and labels SHALL remain upright and readable. The rotation controls SHALL be grouped beside the existing Fit and Arrange controls.

#### Scenario: Rotate Graph in either direction
- **WHEN** a user activates Rotate left or Rotate right one or more times
- **THEN** the graph arrangement turns by 90 degrees per activation in that direction, with labels upright

#### Scenario: Reverse or complete a rotation
- **WHEN** a user rotates the Graph four times in one direction, or reverses a prior quarter-turn
- **THEN** the arrangement returns to its original orientation after four turns, or changes by the requested reverse turn

#### Scenario: Operate rotation controls accessibly
- **WHEN** a user reaches a Graph rotation control by keyboard or assistive technology
- **THEN** its direction is identified accessibly and activation rotates the arrangement by one quarter-turn

### Requirement: Arrange existing terminal windows from the shared tab bar

The shared tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions. On desktop the control SHALL sit at the right edge of the tab bar; on mobile it SHALL appear inside the existing ellipsis-expanded floating controls, including when the tab strip is hidden for one tab. The shared shell Actions command menu SHALL expose the same view-wide arrangement choices and unavailable reasons in every view. Each choice MAY be given a configurable keyboard shortcut, with none assigned by default; invoking an assigned shortcut SHALL follow the same availability and Restore rules without sending terminal input. The shell's existing shortcut defaults and numbered Actions order SHALL remain unchanged. Single SHALL show one active window fitted to the available stage, except while a Spaces workspace is suspended by Close all terminal windows. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. Each visible Spaces tab window SHALL present that tab's Herdr-reported split or zoom layout in Single and multiwindow arrangements, with the tab window owning each pane it presents. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows. If its Terminal resource is selected, it SHALL show an actionable focus affordance for the active tab window without attaching a second terminal or changing the selected resource tab.

In Office, Tree and Graph, an arrangement SHALL include every currently visible Inspector conversation across managed hosts, including the docked Inspector and a Tree inline Inspector. It SHALL reposition only conversations that are open when invoked. Single SHALL show the active Inspector while suspending terminal presentations in other conversations that remain open under the existing dock and floating admission rules. In particular, ordinary selection of B while A is docked SHALL still close A before admitting B; Single SHALL NOT retain A as a hidden extra Inspector or change the one-docked-Inspector rule. World SHALL admit distinct floating Inspectors without a fixed presentation-count cap; this SHALL NOT change Spaces' existing tab admission. All four views SHALL use the same arrangement choices and geometry rules over their current window sets. Arranging SHALL NOT itself create or close Herdr tabs, panes, terminal sessions, Inspectors or connections, change the host filter, connection lifecycle or resource tab, or send terminal input. Hidden visual Inspectors SHALL remain hidden and unmodified while Spaces is visible, and hidden Spaces tab windows SHALL remain unmodified in a visual view.

Cascade, Columns, Rows and Grid SHALL be one-time actions on the eligible windows at invocation. A later new tab or Inspector SHALL use its normal opening presentation until another multiwindow arrangement is chosen. Single SHALL follow the active tab or Inspector, including a newly admitted one, while hiding only other windows that remain open under normal selection rules. A Spaces workspace suspended by Close all terminal windows SHALL remain unpresented when the user navigates away and returns to that workspace in the same runtime generation. Selecting an existing tab SHALL clear its suspension and show that tab in Single; explicitly choosing an arrangement SHALL clear suspension and present all eligible tabs in the requested layout. Closing all in a visual view SHALL close every open Inspector conversation across managed hosts, including conversations hidden by Single or compact layout, so those conversations cannot reappear through a later arrangement or viewport change. Close all SHALL leave the underlying Herdr tabs, panes, terminal processes and sessions open and SHALL NOT change the host filter or connection lifecycle. Open all terminal windows SHALL admit one Inspector for each actionable terminal tab within the current host filter that is not already presented, without focusing or creating Herdr tabs or sessions. It SHALL preserve existing Inspector conversations and arrange the resulting set in scrollable Grid when usable, including when Single was active.

#### Scenario: Use Single in Spaces

- **WHEN** Spaces is in its default Single arrangement and the user selects a different open tab
- **THEN** that tab's Herdr pane layout fills the available stage, the prior tab's terminal presentation is suspended, and the one Spaces Inspector follows only the newly active tab and pane

#### Scenario: Arrange existing tabs in Spaces

- **WHEN** the focused workspace has several open Herdr tabs and the user chooses Columns, Rows, Grid or Cascade in Spaces
- **THEN** the eligible tabs appear as separate terminal windows in that arrangement without a new Herdr tab, pane, session or connection, and the Spaces Inspector remains bound to the active tab

#### Scenario: Arrange tabs while the Spaces Inspector is on Terminal

- **WHEN** the Spaces Inspector has Terminal selected for an unzoomed split active tab and the user shows that tab in Single, then arranges it with another open tab
- **THEN** the active tab window presents both panes in both arrangements, the other tab gains its own window in the multiwindow arrangement, and the Inspector keeps Terminal selected but shows a Focus tab window action without a terminal attachment or duplicate input path; activating that action focuses the active tab's selected pane

#### Scenario: Arrange all visible Inspectors

- **WHEN** two or more Inspectors are visible in Office, Tree or Graph and a user chooses an arrangement
- **THEN** every visible Inspector, including a docked or inline one, participates while its resource tab, selected pane, session and close/dock controls remain available

#### Scenario: Use Single in a visual view

- **WHEN** several Inspectors are open in Office, Tree or Graph and the user chooses Single
- **THEN** the active Inspector fills the available stage, other retained floating conversations stay open without live hidden terminal attachments, and selecting one of them brings that Inspector into Single under its existing presentation rules

#### Scenario: Replace a docked Inspector while Single is active

- **WHEN** A is docked in a visual view's Single arrangement and ordinary selection admits B into the dock
- **THEN** A's conversation closes before B mounts, A does not consume a hidden Inspector slot or appear on Restore, and B becomes the Single window without a duplicate terminal attachment

#### Scenario: Open another Inspector after arranging

- **WHEN** a user opens another Inspector after choosing Cascade, Columns, Rows or Grid
- **THEN** the new Inspector uses its normal opening geometry and the earlier windows do not move until another arrangement is chosen

#### Scenario: Only one eligible window

- **WHEN** a view has one eligible tab or Inspector
- **THEN** Single remains usable and multiwindow choices explain that another eligible window is needed

#### Scenario: Use the arrangement control with a keyboard

- **WHEN** a keyboard user opens the arrangement control, chooses a labelled placement or dismisses it
- **THEN** focus moves predictably among its options and returns to the control or previously focused terminal without sending that navigation as terminal input

#### Scenario: Find the arrangement control at wide and mobile widths

- **WHEN** a user views the desktop tab bar or expands the mobile ellipsis controls with one open tab
- **THEN** one arrangement control is reachable at the right edge of the desktop tab bar or inside the expanded mobile controls, with no separate mobile tab-strip icon

#### Scenario: Arrange from Actions or a shortcut

- **WHEN** a user chooses a layout from the shell Actions menu, or uses its assigned shortcut in the current view
- **THEN** that view applies the same eligible-window layout as the tab-bar control, or leaves geometry unchanged when the choice is unavailable; the shell menu offers the layouts even without an actionable visual entity selected

#### Scenario: Close all Spaces presentations and explicitly reopen

- **WHEN** Close all terminal windows is invoked for a Spaces workspace and the user later returns to it
- **THEN** the stage remains empty until the user selects an existing tab, which opens only that tab in Single, or chooses an arrangement, which opens the eligible tabs in that layout

#### Scenario: Close all visual Inspectors, including hidden conversations

- **WHEN** Close all terminal windows is invoked in Office, Tree or Graph while one conversation is visible and another is hidden by Single or compact layout
- **THEN** all open Inspector conversations across managed hosts close, no conversation reappears after changing arrangement or returning to desktop, and Herdr tabs, panes, processes and sessions remain open

#### Scenario: Open all selected-host terminals

- **WHEN** the user chooses Open all terminal windows in Office, Tree or Graph
- **THEN** one Inspector window opens for every actionable terminal tab within the current host filter that lacks a window, existing Inspector conversations remain open, the resulting set uses scrollable Grid when usable, and no Herdr tab, pane, process or session is created or closed

### Requirement: Fit and restore window arrangements

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. They SHALL shrink windows evenly below their normal floating minimum when needed, then scroll horizontally for Columns or vertically for Rows at the usable tiled minimum. They SHALL mount only nearby windows and terminal presentations, and focusing an offscreen window SHALL scroll it into view. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile every eligible window in a count-based rectangular layout. Its column count SHALL be the smaller of the ceiling of the square root of the window count and the number of usable-width tiles that fit the stage; additional rows SHALL scroll vertically at no less than the usable tiled minimum height. Six SHALL form a 3×2 grid and sixteen a 4×4 grid when those shapes fit the stage, without floating overflow layers. Grid SHALL mount only nearby window shells and terminal presentations; focusing an offscreen window SHALL scroll it into view. Cascade SHALL use the normal viewport-fitted default floating-window size, shrinking all windows equally only when needed to fit its diagonal offsets, and SHALL keep older title regions visible behind newer windows. When a further offset would make a window smaller than its usable minimum, Cascade SHALL repeat the diagonal in another vertically scrollable stage, mount only nearby presentations, and scroll an offscreen focused window into view. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, with balanced stage insets at supported UI scales and reachable title, close and dock controls. Scrollable visual arrangements SHALL expose a visible scrollbar on the applicable axis and clip their Inspector windows at the available stage, so offscreen windows cannot cover shell controls or receive pointer input beyond the stage. A tiled window SHALL retain its usable compact minimum during explicit resize. An option that cannot fit every eligible window at usable width SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an eligible window set, World SHALL capture its previous presentation and each window's available prior geometry, including the Spaces Single state or an Inspector's dock/inline state. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance, changing the current active tab/pane or moving an instance that has never participated. Restoring Spaces' original Single presentation SHALL show its currently active tab unless that workspace remains suspended by Close all terminal windows. A Tree inline return SHALL use its exact leaf if that leaf is still visible, and otherwise use the normal docked overlay. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable window and preserve desktop arrangement positions for return to desktop. A runtime-generation change SHALL remove only that runtime's retired windows from the arrangement and restore snapshot; other participants SHALL remain recoverable. A host filter change SHALL preserve the arrangement and restore snapshot. Spaces and visual views SHALL retain their respective window placement while inactive without arranging each other's hidden windows. Spaces SHALL keep tab-window placement separate for each focused workspace and SHALL detach the old workspace's terminal presentations when focus changes to another workspace.

Maximize SHALL temporarily present a window over the available stage while preserving its other arrangement participants. It SHALL capture the complete prior presentation context and geometry, including dock or inline placement, arrangement membership, tile geometry and order. The window's Restore control SHALL return it to that captured presentation. If Restore positions is invoked while a window is maximized, all still-open participants SHALL return to the captured arrangement baseline and the maximize snapshot SHALL be cleared; an individual Restore action SHALL NOT reapply superseded geometry.

#### Scenario: Compact visual layout preserves desktop positions

- **WHEN** a visual view with arranged Inspectors enters a compact layout and the user attempts a menu choice, assigned shortcut, drag or resize
- **THEN** the compact view keeps one active Inspector, explains that placement choices are available on desktop, and returns to the same saved Inspector positions on desktop

#### Scenario: Two columns and three rows

- **WHEN** two eligible windows fit Columns, or three fit Rows, and the user chooses that option in any view
- **THEN** they occupy nonoverlapping side-by-side columns or top-to-bottom rows within the available stage

#### Scenario: More than two columns or rows

- **WHEN** three or more eligible windows fit after shrinking evenly to usable compact sizes and the user chooses Columns or Rows
- **THEN** all eligible windows remain in one nonoverlapping row or column with their controls reachable

#### Scenario: Columns and Rows scroll a large window set

- **WHEN** eligible windows exceed the stage width in Columns or stage height in Rows
- **THEN** every window keeps at least the usable tiled minimum, the arrangement scrolls along its tile axis, only nearby terminal presentations mount, and focusing an offscreen window scrolls it into view

#### Scenario: Reach scrolling controls on a wide visual canvas

- **WHEN** an Office, Tree or Graph arrangement has more windows than fit on screen
- **THEN** a visible, keyboard-accessible scroll control sits at the arrangement stage's right or bottom edge, lets the user move in the arrangement's scroll direction, and follows the same scroll position as focus navigation

#### Scenario: Switch from a scrolled arrangement

- **WHEN** a user scrolls to the end of Cascade and then chooses Columns or Rows
- **THEN** the new arrangement shows its windows in the stage without an offset retained from the previous scroll direction

#### Scenario: Arrange visual Inspectors at a scaled UI

- **WHEN** a user chooses Columns for two visible Inspectors on a wide desktop with increased UI scale
- **THEN** both windows fit within the visual stage with balanced top and bottom spacing and reachable controls

#### Scenario: Three-window and four-window Grid

- **WHEN** three or four eligible windows fit Grid
- **THEN** three use one tall column beside two stacked windows, or four occupy the four corners, with usable terminal content in each

#### Scenario: Grid with more than four open windows

- **WHEN** six or sixteen eligible windows are visible and Grid can fit every window at the usable tiled minimum
- **THEN** every window occupies a nonoverlapping tile in a 3×2 or 4×4 grid respectively

#### Scenario: Grid scrolls a large window set

- **WHEN** many eligible windows exceed the stage's visible height and the user chooses Grid
- **THEN** every window receives a usable tile in vertically scrollable rows, only nearby windows and terminal presentations are mounted, and focusing an offscreen window scrolls it into view

#### Scenario: Grid cannot fit one usable column

- **WHEN** the stage cannot fit one tile at the usable minimum width
- **THEN** Grid is unavailable with an explanation and the current window geometry stays unchanged

#### Scenario: Diagonal Cascade

- **WHEN** two or more eligible windows fit Cascade and the user chooses it
- **THEN** each window has the normal default floating size fitted to the stage, each later window is offset diagonally above the earlier windows, and every title region can be used to raise its window

#### Scenario: Cascade repeats beyond one stage

- **WHEN** the next Cascade offset would shrink a window below its usable minimum
- **THEN** Cascade repeats its reachable diagonal in a vertically scrollable stage, mounts only nearby windows and terminal presentations, and scrolls an offscreen focused window into view

#### Scenario: Scroll visual arrangements without covering shell controls

- **WHEN** an Office, Tree or Graph Grid, Columns, Rows or Cascade arrangement extends beyond its visible stage
- **THEN** a visible scrollbar moves along the overflowing axis, and Inspector portions outside the stage are clipped and cannot intercept controls outside that stage

#### Scenario: Requested layout cannot fit

- **WHEN** the available stage cannot hold a requested placement at usable dimensions
- **THEN** that placement explains its unavailability and invoking it leaves all current window geometry unchanged

#### Scenario: Restore after arranging a Tree Inspector

- **WHEN** an inline Tree Inspector and floating Inspectors were arranged and the user chooses Restore positions
- **THEN** the Tree Inspector returns to its exact visible leaf when available, or its normal docked overlay, and the still-open floating Inspectors return to their captured geometry without losing resource or terminal state

#### Scenario: Return from a compact viewport

- **WHEN** a desktop arrangement is viewed at a compact width and then at desktop width again
- **THEN** compact mode shows its one active usable tab or Inspector and the prior desktop arrangement remains recoverable without an offscreen title or duplicated terminal

#### Scenario: Return from Spaces to a visual view

- **WHEN** the user arranges existing tabs in Spaces and then returns to Office, Tree or Graph
- **THEN** the visual Inspectors retain their own placement, the hidden Spaces windows release their terminal presentations, and returning to Spaces recovers its tab arrangement within the current stage unless that workspace was suspended by Close all terminal windows

#### Scenario: Switch the focused Spaces workspace

- **WHEN** tabs in workspace A are arranged and the user focuses workspace B in Spaces
- **THEN** no tab window from A remains visible or attached in B, and returning to A recovers its arrangement if those tabs still exist in the current runtime generation, unless A was suspended by Close all terminal windows

#### Scenario: Switch host after arranging

- **WHEN** one runtime generation changes with arranged Inspectors open on several hosts
- **THEN** only that runtime's retired conversations are removed, Restore cannot reopen them for a
  replacement generation, and other hosts retain their placement and restore history

#### Scenario: Maximize and restore a docked Inspector

- **WHEN** a user maximizes a docked Office Inspector and then activates its Restore control
- **THEN** the Inspector returns to its prior dock and geometry without losing its resource state or terminal ownership

#### Scenario: Maximize and restore an arranged Inspector

- **WHEN** a user maximizes an Inspector in a multiwindow arrangement and then activates its Restore control
- **THEN** it returns to its captured tile geometry and order while the other participants retain their placement

#### Scenario: Restore arrangement positions while maximized

- **WHEN** a user invokes Restore positions while an arranged Inspector is maximized
- **THEN** every still-open participant returns to its captured arrangement baseline and a later per-window Restore does not reinstate superseded geometry

### Requirement: Present one Inspector per Herdr tab with its split panes

An actionable Herdr tab SHALL have at most one World Inspector conversation. Selecting any pane in that tab through Office, Tree, Graph, the common navigator or inside the Inspector's own split Terminal SHALL focus that conversation, select the requested pane within it and show the current Herdr split-pane layout when Terminal is selected. The Inspector identity and window geometry SHALL remain stable as selection moves among sibling panes; its header and pane/agent-specific resource applicability SHALL follow the selected pane, with Agent History available only when that pane has an admitted agent session. A non-terminal space Inspector SHALL remain a separate conversation. If the selected pane closes while sibling panes remain, the Inspector SHALL select a remaining live pane in the same qualified tab; when the tab no longer exists, the conversation SHALL retire.

Files selections and replies SHALL remain scoped to their workspace or checkout resource owner, and ordinary Changes selections and replies SHALL remain scoped to their workspace. Switching between sibling panes in the same workspace SHALL preserve valid Files and ordinary Changes state. Agent checkout Changes and Agent History SHALL follow the selected pane and session; replies captured for a prior pane or session SHALL NOT replace the newly selected pane's agent-specific content. In Spaces, the one workspace Inspector SHALL similarly update its header and agent-specific applicability with the active tab and selected pane while preserving valid workspace or checkout resources.

The live Inspector tab-window identity SHALL include connection ID, runtime generation, workspace ID and Herdr tab ID. Persisted Inspector tab-window geometry SHALL use a stable connection/workspace/tab key without runtime generation. Existing pane-key geometry MAY be read as a one-time fallback and migrated to the stable key. After migration and a runtime reconnect, the latest saved Inspector geometry SHALL be restored for that same connection, workspace and tab; the live conversation SHALL still retire on generation change. Spaces arrangement geometry SHALL remain separate and session-local, so arranging a tab in Spaces SHALL NOT overwrite its saved visual Inspector position.

Pane placement, zoom and resize inside an Inspector SHALL follow Herdr's tab layout. Window arrangements SHALL act outside that layout. Every terminal pane SHALL have at most one active browser presentation and attachment across Spaces and visual views, qualified by connection, runtime generation, workspace, tab, pane and terminal identity. Missing, stale or mismatched tab layout data SHALL never attach another pane or show cached layout as actionable current topology.

#### Scenario: Open sibling panes from different World nodes

- **WHEN** two selected World nodes refer to sibling panes in the same Herdr tab
- **THEN** they focus one Inspector window and the selected pane's identity and applicable resources update without a second terminal attachment

#### Scenario: Split a pane in a floating Inspector

- **WHEN** Herdr splits the pane shown by a floating Inspector into two panes in the same tab
- **THEN** the Inspector Terminal shows both panes in Herdr's reported arrangement, and input goes only to the pane the user focuses

#### Scenario: Focus a sibling inside a split Inspector

- **WHEN** pane A and pane B share an Inspector and the user focuses B inside its split Terminal while A's agent checkout Changes or History request is pending
- **THEN** terminal input, the Inspector's selected-pane header and agent-specific applicability follow B, and A's late reply cannot replace B's agent-specific content

#### Scenario: Select a pane from a mobile switcher or zoomed terminal

- **WHEN** a user chooses a sibling with the mobile pane switcher or focuses the Herdr-zoomed pane while an earlier pane-focus read is pending
- **THEN** the chosen pane remains selected, with no older pane-focus request from the same pointer action able to override it

#### Scenario: Preserve workspace resources across sibling focus

- **WHEN** pane A and pane B share a tab and workspace, Files has a valid selection for that workspace or checkout, ordinary Changes mode has a selected workspace diff, and the user focuses B after selecting A
- **THEN** the same Inspector updates its header and pane/agent-specific applicability for B while retaining the Files selection and ordinary Changes mode and diff selection and accepting their still-valid scoped replies; A's late agent checkout Changes or History reply cannot appear as B's agent data

#### Scenario: Move between Spaces and a split Inspector

- **WHEN** a tab with multiple panes is shown in Spaces and later in its World Inspector, or the reverse
- **THEN** the same Herdr panes and layout remain visible after the handoff and no terminal gains a second live attachment

#### Scenario: Selected pane closes

- **WHEN** the selected Inspector pane closes while another pane remains in its qualified tab
- **THEN** the Inspector stays on that tab, selects a remaining pane and updates its resource tabs without binding to a pane from another tab or host

#### Scenario: An older resource reply arrives after sibling selection

- **WHEN** pane A's agent checkout Changes or History request finishes after the user has selected sibling pane B
- **THEN** the Inspector keeps B's identity and applicable resources and does not display A's late agent result as B's data

#### Scenario: Restore saved geometry after reconnect

- **WHEN** a pane-keyed position was migrated to a tab-keyed position, the user moves that tab window again, and the runtime reconnects
- **THEN** the old live Inspector retires and the reopened tab window uses the latest stable tab-keyed position instead of the older pane-keyed position

#### Scenario: Tab layout becomes stale

- **WHEN** a pane closes, moves to another tab or its host generation changes while an Inspector waits for layout data
- **THEN** an obsolete response is ignored and no pane is attached under an incorrect tab or host

### Requirement: Shared live terminal conversations

Office, Tree and Graph SHALL open qualified agents, occupied desks and terminal nodes in live
Inspector conversations backed by the shell's existing resource and terminal/session owners.
Selecting the same qualified entity through another representation SHALL focus its existing
Inspector instead of creating a competing resource context or terminal attachment. Every open
conversation SHALL belong to its own admitted managed connection and current runtime generation;
conversations on several hosts SHALL be usable concurrently.
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
Docked mode. Single arrangement SHALL follow this same admission rule: it SHALL NOT keep the
outgoing docked Inspector hidden, consume an extra window slot or restore that closed
conversation later. Floating conversations SHALL arise only from an explicit Dock out action
or a new Office entity activation while Floating mode is selected. Other retained floating
conversations MAY be hidden by Single and SHALL continue to count toward the existing limit.
Explicitly docking a floating conversation into an occupied dock SHALL continue to swap the
two retained conversations.

The floating Inspector header SHALL expose Dock in and × controls. The docked Inspector SHALL
expose Dock out and × controls plus its dock-position and expand controls. Closing either
presentation SHALL close only that qualified Inspector and SHALL NOT silently open another window.
The Inspector SHALL NOT expose a second Open in Spaces shortcut; Spaces remains available through
the primary view selector without changing terminal identity or attaching another session.

Desktop SHALL support independently managed floating Inspector conversations alongside the one docked
Inspector, with independent bounded position, size, z-order, selected tab, resource selection and
close/focus behavior. Terminal tabs SHALL keep text at configured metrics, refit to real dimensions
and retain usable input, selection, scrolling, uploads and mobile controls. Compact layouts SHALL
present one active usable Inspector. Spatial views SHALL connect every visible Inspector to its
represented desk, agent or node. These connectors SHALL track qualified anchors when either endpoint
moves and SHALL never imply a different runtime ancestry, resource scope or terminal identity.
Desktop movement SHALL allow a tall Inspector's draggable title region to reach the lower viewport
while keeping that title region available for recovery; compact Inspectors SHALL remain fully
contained. The resize affordance SHALL present a compact corner bracket while retaining an
accessible drag target.

Conversation identity and validity SHALL be qualified by connection and runtime generation inside
independent connection leases over the World browser transport. Opening another window, changing
filters or navigating among Office, Tree and Graph SHALL NOT detach, redirect or duplicate
conversations while their own leases remain current. A failed, stale or bounded aggregate observation SHALL NOT retire an already open
Inspector while its owning connection lease remains current and its tab or workspace remains in the
owning runtime's Herdr list. Absence from an owning-runtime list that began before the Inspector opened SHALL NOT
retire it. An owning-runtime list begun after admission that confirms removal, or a generation change,
SHALL retire that conversation. Selecting Spaces SHALL suspend every visual Inspector presentation
so the native Spaces workspace is unobstructed and SHALL transfer the exact selected terminal presentation only
after its visual owner detaches. The retained visual conversation state SHALL be restored when the
user returns to a visual view. Opening a context on another host SHALL preserve unrelated visual and Spaces context state.
Changing the focused Spaces workspace SHALL detach its outgoing terminal presentations without
retiring retained visual conversations on other workspaces or hosts. All conversations SHALL use
the one World browser WebSocket and existing terminal owner.

Mounted-but-hidden Spaces SHALL NOT keep a competing terminal attachment for a terminal currently
presented by a visual conversation. A handoff between a visual conversation and visible Spaces MAY
remount the current terminal UI, but SHALL preserve the qualified Herdr terminal/session identity,
SHALL NOT close or recreate the server terminal and SHALL order presentation teardown and admission
so that terminal is never mounted twice. The newly visible presenter SHALL refit to its actual
dimensions, expose the applicable compact input controls and accept input without a second click;
returning browser focus SHALL restore the terminal cursor only when that terminal held focus before
the browser lost it.

While Spaces is visible, its tab window SHALL own every pane presented by the tab's current Herdr
split or zoom layout in Single and multiwindow arrangements. When the one Spaces Inspector has
Terminal selected, it SHALL keep that resource selected and offer a Focus tab window action instead
of attaching the same terminal inside the Inspector. Activating that action SHALL focus the active
tab's selected pane without creating an attachment. Moving to a visual view SHALL detach the Spaces
tab window before a visual Inspector can attach that qualified pane.

#### Scenario: Open the same terminal from two representations

- **WHEN** a user opens an agent and then its occupied desk or hierarchy node
- **THEN** World focuses one qualified Inspector conversation and does not create another resource
  context, transport or duplicate input path

#### Scenario: Pan the compact Office scene

- **WHEN** a touch user drags over a road, open floor or other non-actionable canvas area
- **THEN** the logical Office scrolls natively in either axis without requiring the gesture to
  begin on a scrollbar or control

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

- **WHEN** entity A has the docked Inspector and the user selects entity B, including while
  Single is active
- **THEN** World closes A's docked conversation before mounting B as the matching docked
  Inspector, does not hide A or open an A floating window, and cannot resurrect A on Restore

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

- **WHEN** the user opens an admitted floating Inspector on another host
- **THEN** both hosts' conversations retain independent resources, terminal ownership and input
  routing without global host activation

#### Scenario: Selected conversation host reconnects

- **WHEN** one owning host reconnects while one or more conversations are open
- **THEN** World retires every conversation from the replaced generation and enables a new
  attachment only after the current generation is admitted

#### Scenario: Conversation target temporarily disappears

- **WHEN** a snapshot refresh or reconnect temporarily omits a conversation target
- **THEN** World retains the conversation until current admitted state confirms the qualified pane
  no longer exists

#### Scenario: Open more than five desktop conversations

- **WHEN** five distinct conversations are open and the user requests a sixth
- **THEN** World admits the sixth Inspector with its own identity and presentation without closing an existing Inspector

### Requirement: Connected Tree presentation

Tree SHALL use a deterministic connected branch presentation with hosts, spaces and agent or
terminal leaves in distinct tiers. Visible connectors SHALL join only authoritative parent-child
relationships. Tree SHALL support search with complete ancestor context, independent host and space
disclosure, selection, the shared entity context and qualified actions. The connected presentation
currently used by the foundation checkpoint's Graph view SHALL become Tree; an indented list SHALL
serve only as an equivalent compact or assistive presentation rather than the primary desktop view.
Tree SHALL bound presentation to the filtered host roots, 128 spaces total and 16 leaves per presented space,
using the same relevance priority as Graph. Both its connected and semantic presentations SHALL
consume that one bounded projection and report exact omitted host, space and leaf counts globally
and at the affected branch; search SHALL operate over the filtered admitted observation and reveal a chosen omitted result
within the same rendering bounds, with exact search-result omission reporting. The
selected actionable leaf SHALL be able to expand in place as Tree's single inline Inspector dock,
with the leaf card remaining its contextual header and the shared resource surface appearing below
it in both the connected desktop and equivalent compact hierarchy.

#### Scenario: Scan an unequal selected-host hierarchy

- **WHEN** filtered hosts contain spaces with different numbers of leaves
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

- **WHEN** a dense unequal multi-host hierarchy exceeds Tree's global-space or per-space leaf bounds
- **THEN** Tree prioritizes selected, focused and attention-requiring entities, renders neither
  presentation outside the shared bounds, and reports exact global and affected-branch omissions

### Requirement: Spatial Graph presentation

Graph SHALL restore the interactive spatial canvas over the qualified host-space-agent-or-terminal
hierarchy. It SHALL provide deterministic initial placement, topology-only layout reheating,
dragging and pinning, bounded pan and zoom, separate Fit and Arrange controls, search,
independent disclosure, selection, the
shared entity context, saved camera and node positions, visible status changes and live terminal
conversation connectors. Status-only updates SHALL NOT reset settled positions or camera state.

Graph SHALL bound presentation to the filtered host roots, 128 spaces total and 16 leaves per presented space,
with exact overflow reporting and priority for focused, working, blocked and detected-agent nodes.
It SHALL provide an equivalent semantic hierarchy and SHALL pause or release animation, observers,
listeners and retained layout work when hidden or unmounted.

#### Scenario: Equal native identifiers exist on two hosts

- **WHEN** two hosts expose the same workspace, pane or terminal identifier
- **THEN** Graph presents distinct qualified nodes under their owning filtered host roots without
  merging identities or connecting entities across runtime ancestry

#### Scenario: Live status changes on a settled graph

- **WHEN** agent labels or statuses change without topology changes
- **THEN** Graph updates its cues and detail content without resetting zoom, disclosure, selection,
  pinned positions or the settled layout

#### Scenario: Arrange a crowded graph

- **WHEN** a user invokes Arrange after dragging, pinning or panning visible nodes
- **THEN** Graph spreads the visible hierarchy without changing its qualified links, recenters the
  camera while preserving zoom when the arranged bounds fit, and retains the arranged positions
  through view changes and topology updates; Fit remains a separate viewport action

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

### Requirement: Shared qualified pane watchlist

World SHALL keep at most 128 terminal-backed watches in service memory, keyed by
connection ID, runtime generation and terminal ID. Pins are shared across browser
connections, survive a browser reload, and clear on service restart or runtime
generation replacement. Pin validates a current live pane, while exact Unpin may
remove an unavailable record. A watch is observational only and grants no resource
or mutation authority.

#### Scenario: Native IDs collide across hosts

- **WHEN** two hosts expose the same native terminal ID
- **THEN** a watch on one exact qualified host never resolves or opens the other

### Requirement: Revisioned watchlist observation

The service SHALL return a process-local watchlist revision and notify browsers on
real mutations. Browsers SHALL reload the list after connection and notification,
reject older replies for that socket, and mark cached records unverified while
disconnected. A reconnect SHALL accept a new empty revision-zero list after a
service restart.

#### Scenario: Service restart

- **WHEN** a browser reconnects to a restarted World process
- **THEN** its prior cached watches are replaced by the restarted process's list

### Requirement: Watch admission within snapshot bounds

World snapshots SHALL reserve uniquely matched current-generation watched panes
and valid workspace/tab ancestry before ordinary relevance, without consuming the
eight browser priority hints. Fresh hosts SHALL report a watch revision and
registered, missing, unresolved, matched, admitted and admission-failed counts,
where `registered = missing + unresolved + matched` and
`matched = admitted + admission-failed`. Stale or unfinished hosts SHALL not
claim current watch classification.

#### Scenario: Duplicate terminal identity

- **WHEN** one watched terminal ID occurs in two raw panes
- **THEN** it is counted once as unresolved and never admitted or guessed

### Requirement: Watched visual projection

Office, Tree and Graph SHALL offer accessible Pin, Unpin and browser-local Pinned
only controls in the shell Actions menu. Pinned only retains filtered multi-host hierarchy context and filters
search within that set. Tree and Graph SHALL prioritize watched leaves while
retaining their 16-child presentation bound; unavailable, stale, missing or
unresolved watches SHALL not expose operational actions.

#### Scenario: A watched pane exceeds a view bound

- **WHEN** a space has more than 16 watched panes
- **THEN** the snapshot still admits its valid watches and the view reports its
  presentation omission without calling it missing

### Requirement: Persist host filters without operational side effects

The common shell SHALL offer All hosts and an explicit nonempty set of managed hosts as view
filters, independently of connection management and operation targets. All hosts SHALL be the
initial scope. World SHALL restore an explicitly saved filter on reload, prune removed profile
identities and restore All hosts with an explanation if no saved identity remains. A legacy
operational-host preference SHALL NOT silently become a restrictive filter. Filter changes SHALL
preserve open contexts, their resource state and their pending requests. A selected visual target
hidden by filtering SHALL no longer supply visual Actions; its open Inspector SHALL retain its
own independently qualified actions.

#### Scenario: Upgrade from a selected-host browser
- **WHEN** the browser has an old selected-host preference and no saved multi-host filter
- **THEN** World starts with All hosts and requires explicit current admission for operational work

#### Scenario: Restore a saved filter
- **WHEN** a browser reloads with two saved filter identities and one profile has been removed
- **THEN** it retains the remaining profile in the filter without connecting or disconnecting any host

#### Scenario: Every saved filter identity was removed
- **WHEN** no identity in a saved filter remains managed
- **THEN** World restores All hosts and explains the change

#### Scenario: Filter hides the selected visual entity
- **WHEN** the filter excludes a selected entity with an open Inspector and an open visual Actions menu
- **THEN** the visual selection/menu capture clears while the Inspector remains usable under its
  own admitted context and is labelled outside the filter

### Requirement: Search and summarize the filtered aggregate honestly

World search SHALL cover the full admitted observation within the host filter and Pinned only
scope when enabled, independently of renderer truncation. Results SHALL preserve qualified ancestry,
use bounded presentation and report omitted matches. Selecting an actionable result SHALL reveal
its qualified target by reprioritizing the bounded view without changing the host filter or attaching
a different entity. Observation bounds SHALL remain explicit; search SHALL NOT imply access to
entities absent from the service's bounded observation.

Counts SHALL identify their filter scope and distinguish observed matches, rendered entities,
omissions and stale or unavailable coverage. Missing observations SHALL NOT be counted as zero
agents. Tree and Graph SHALL retain all filtered host roots within the managed catalogue limit,
at most 128 presented spaces total and 16 leaves per presented space. They SHALL prioritize
selected, focused, watched and attention-requiring entities, then distribute remaining space
capacity across hosts before assigning additional capacity to one host.

#### Scenario: Find an entity omitted by rendering
- **WHEN** a current agent exists in admitted topology but falls beyond a view's rendering bound
- **THEN** search can return it and choosing it reveals that qualified agent within the same bounds
  while omission counts account for displaced entities

#### Scenario: Some hosts lack current observations
- **WHEN** two filtered hosts are current and a third has only stale or unavailable topology
- **THEN** the summary identifies that coverage and does not present its total as a complete current count

#### Scenario: Dense hosts compete for presentation capacity
- **WHEN** one filtered host has more than 128 spaces and another has a small workspace set
- **THEN** priority entities remain favored, remaining capacity is distributed across hosts and
  exact global and branch omissions explain what was not rendered

#### Scenario: Pinned only across hosts
- **WHEN** the user enables Pinned only with current watches on two hosts in the filter
- **THEN** both qualified host branches are eligible regardless of keyboard focus, and filtering
  out one host changes visibility without removing its watches or open contexts

### Requirement: Explicit destinations and independent command focus

Resource requests, terminal input, popup and clipboard handling, uploads, annotations, launchers,
worktree operations and workspace mutations SHALL use the owning operational context's captured
connection, runtime generation and applicable resource/session identity. Window focus SHALL govern
keyboard command targeting without changing any other context's identity. Hidden Spaces state
SHALL NOT provide a target to a visual or Inspector command. Unsupported operations SHALL explain
the missing capability on the target host without blocking compatible hosts.

Creation from an existing room or workspace SHALL inherit its qualified destination. Global creation
SHALL require a visible destination confirmed at submission; a single-host filter MAY prefill it.
All hosts SHALL NOT imply broadcasting. Destructive controls SHALL identify the owning host and
resource before dispatch. Delayed results SHALL update only the still-valid owning resource request.

#### Scenario: Interleave terminal input across hosts
- **WHEN** terminals on two hosts share native pane IDs and the user alternates keyboard focus
- **THEN** input, resize and clipboard operations reach only their respective qualified owners,
  without duplicate attachment or input replay

#### Scenario: Create from a room
- **WHEN** the user starts creation from a room while another host's terminal has keyboard focus
- **THEN** the creation destination remains the room's owning host and workspace and is revalidated
  before dispatch

#### Scenario: Create globally with All hosts
- **WHEN** the user invokes global creation while All hosts is selected
- **THEN** a destination is explicitly chosen and shown before submission and exactly one host is targeted

#### Scenario: Destination fails before submission
- **WHEN** a displayed creation destination disconnects or loses the required capability
- **THEN** submission fails for that destination without silently choosing another ready host

#### Scenario: Delayed resource after another window gains focus
- **WHEN** Files or agent History finishes after a different host's window gains focus
- **THEN** it updates only its original still-valid workspace or agent-session context and cannot
  populate the newly focused window

### Requirement: Qualified notification navigation across hosts

Opening an agent or task notification SHALL resolve the exact owning connection and current
resource/session identity before opening a context. An admitted target outside the host filter SHALL
open with an outside-filter label and an explicit reveal action, without silently changing the
filter or retiring unrelated contexts. Reveal SHALL intentionally expand the filter to include its
host and expose the qualified target. Stale, removed or replaced targets SHALL explain why they
cannot be opened without resolving to a colliding entity on another runtime or session.

#### Scenario: Open an out-of-filter notification
- **WHEN** a notification names a currently admitted agent outside the host filter
- **THEN** its context opens under its own host with a reveal action while the filter and other
  windows remain unchanged

#### Scenario: Follow a stale notification
- **WHEN** a notification's runtime generation or agent session has been replaced
- **THEN** World reports the original target as unavailable and does not open its replacement
