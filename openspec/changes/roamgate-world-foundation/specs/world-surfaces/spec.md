## MODIFIED Requirements

### Requirement: Shared presentation
The application SHALL derive one connection-qualified World hierarchy from the World service's
managed profiles and admitted runtime snapshots. Each managed connection SHALL be a host root,
each observed Herdr workspace SHALL be its direct space child, and each observed pane SHALL appear
exactly once as an agent or terminal child of its owning space. Equal native identifiers on
different connections SHALL remain distinct. A pane SHALL retain stable terminal-backed identity
when its agent classification, label, status or focus changes.

Spaces and Office SHALL consume the same connection and generation identities. The Spaces terminal
workspace SHALL remain mounted while Office is visible so changing views does not create another
application or competing runtime store. Selection SHALL not itself mutate Herdr. Explicit terminal,
Spaces or Inspector actions SHALL revalidate the exact connection and runtime generation and SHALL
be unavailable for stale observations.

Spaces SHALL keep its Roamgate-derived one-selected-connection interaction model. Office SHALL
observe every concurrently ready host, but its terminal and Inspector SHALL use one explicit
focused operational context through that existing selected-connection lifecycle. Changing the
focused context MAY retire the outgoing Spaces or Office terminal according to that lifecycle; it
SHALL NOT redirect input, retain a hidden cross-host operational context or create another browser
transport.

#### Scenario: Move between Spaces and Office
- **WHEN** a user opens a qualified terminal in Spaces, visits Office and returns without choosing
  another operational target
- **THEN** the same Spaces application and terminal ownership remain available without another
  service or attachment

#### Scenario: Spaces is mounted but hidden
- **WHEN** Office is active and a Spaces operational shortcut is pressed
- **THEN** the mounted Spaces application does not create, focus, close or otherwise mutate a pane
  or workspace

#### Scenario: Active host changes during an Office action
- **WHEN** the active connection or runtime generation changes while an Office entity is opening
- **THEN** the action is rejected before dispatch or before reporting success and never targets a
  colliding workspace on the newly active host

#### Scenario: Two hosts contain equal identifiers
- **WHEN** two managed hosts report equal workspace, pane or terminal identifiers
- **THEN** the hierarchy contains distinct connection-qualified subtrees and every action resolves
  only through the selected entity's owning connection

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

#### Scenario: Office relocates an agent visually
- **WHEN** Office places an agent in a room, reception or the Agent Bar for presentation
- **THEN** the shared hierarchy still records it beneath the authoritative owning host and space

### Requirement: Accessible navigation
World SHALL expose named, keyboard-reachable controls for Spaces and Office navigation, Office
hierarchy selection and guarded actions. Compact layouts and reduced-motion use SHALL retain the
same semantic hierarchy and operational controls without requiring precision pointer input or
motion.

#### Scenario: Navigate without pointer precision
- **WHEN** a user traverses World controls with a keyboard or assistive technology
- **THEN** view, selection, stale state and available actions are exposed by semantics and text
  rather than color or motion alone

#### Scenario: Scene navigation without pointer precision
- **WHEN** a user selects an Office entity through semantic keyboard or assistive navigation
- **THEN** the same connection-qualified entity is selected as through a pointer action

### Requirement: Common view navigation
The native World shell SHALL offer Spaces and Office once each and SHALL keep rendered view,
browser history and canonical paths `/spaces` and `/office` consistent. The existing Spaces
connection selector SHALL remain the profile-management surface; Office SHALL not introduce a
second host catalogue. Incomplete Tree or Graph checkpoints MAY remain available to development
but SHALL NOT appear as accepted primary product views in this change.

#### Scenario: Browser history across accepted views
- **WHEN** a user selects Office and then navigates Back or Forward
- **THEN** the URL and rendered Spaces or Office view agree while the same shell retains terminal
  and Inspector ownership

#### Scenario: Manage a host
- **WHEN** a user needs to add, edit, test, connect or remove a profile from Office
- **THEN** opening Spaces exposes the existing managed connection workflow without another product
  or profile store

### Requirement: Native World shell
The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Spaces and Office. Those views SHALL share the same connection
identities, admitted topology, Inspector resources and terminal ownership; World SHALL not embed or
launch a separately branded Roamgate application.

#### Scenario: Install World only
- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and Pixel Office are available without installing Roamgate or another web bridge

#### Scenario: Use the Inspector without leaving Office
- **WHEN** a user selects an actionable space or pane in Office and opens Files, Changes or Agent
  History
- **THEN** Office remains visible and the shell-owned Inspector uses only that entity's owning
  connection, runtime generation, workspace and optional pane context

#### Scenario: Change focused host from Office
- **WHEN** the user explicitly opens an operational context for an Office entity on another ready
  host
- **THEN** the shell activates and revalidates that exact host through its existing focused
  connection lifecycle and does not keep the prior host's resources as the new context

### Requirement: Bounded World view composition
Office SHALL present its complete view-specific composition over the shared hierarchy. It SHALL use
explicit tested entity and label bounds, report exact presentation omissions, keep stale state
visible, and contain its stage within the application viewport. Internal canvas movement or logical
scrolling MAY expose a larger composition without creating horizontal overflow on the application
page.

#### Scenario: Select a stale entity
- **WHEN** a user inspects an entity retained from an unavailable host
- **THEN** Office identifies it as stale and disables operational terminal and Inspector actions

#### Scenario: Compact visual plane
- **WHEN** Office opens at phone width
- **THEN** navigation, hierarchy selection and guarded actions remain reachable without causing
  horizontal overflow of the application page

#### Scenario: Presentation bound is exceeded
- **WHEN** Office observes more entities than its tested presentation capacity
- **THEN** it prioritizes relevant live entities, reports exact omitted counts and never implies
  that omitted entities were removed from Herdr

### Requirement: Shared entity detail drawer
Office SHALL provide one selected-entity context without creating a second Inspector, terminal
owner or runtime store. The context SHALL show the selected entity's bounded admitted identity,
host and space ancestry, connection freshness, kind and actionable state. For agents it SHALL also
show available agent/model labels, state labels, status and task summary. It SHALL expose only
relevant generation-fenced Open terminal, Open in Spaces, Files, Changes and Agent History actions.
Missing metadata SHALL remain absent rather than being inferred.

At most one Office operational context SHALL be focused at a time. Files, Changes and Agent History
SHALL reuse the shell's existing Inspector components and state while Office remains visible.
Switching context SHALL replace incompatible prior resource state rather than cloning an Inspector
for each host.

#### Scenario: Inspect an agent with a task summary
- **WHEN** an admitted agent reports a bounded task summary and the user selects it in Office
- **THEN** the context shows that summary, its qualified ancestry and the actions supported by its
  current host generation

#### Scenario: Open rich agent context
- **WHEN** the user opens Files, Changes or Agent History for an actionable Office agent
- **THEN** the existing Inspector opens within the Office experience for that exact qualified
  workspace and session context

#### Scenario: Selected entity becomes stale
- **WHEN** the selected entity's host disconnects or advances beyond the observed generation
- **THEN** the context preserves bounded inspection information, marks it stale and disables every
  operational action

#### Scenario: Agent metadata is unavailable
- **WHEN** an agent exposes no task summary, model label or state label
- **THEN** the context remains useful without fabricating what the agent is doing or implemented

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
filter the relevant Office presentation to Pinned only. The bounded World-owned watchlist SHALL
survive browser refresh, SHALL remain distinct from workspace pins, and SHALL never use a native
pane identifier without its connection identity. A stale pinned item MAY retain bounded inspection
context and be unpinned, but SHALL NOT admit runtime actions. World SHALL remove a pin after current
authoritative state confirms that exact pane no longer exists.

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

#### Scenario: Create a seat in a room
- **WHEN** the selected host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room, shows the desk only after Herdr
  admits the resulting tab and pane, and selects or opens that exact new qualified terminal

#### Scenario: Seat creation is cancelled or fails
- **WHEN** the user cancels seat creation or the launcher fails before Herdr admits a new pane
- **THEN** Office preserves the prior selection and focused operational context

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
- **WHEN** a completion target is stale, incompatible or cannot be opened
- **THEN** Office retains its unseen marker and bounded notice, explains that inspection is
  unavailable and does not treat selection as acknowledgement

#### Scenario: Several completions arrive
- **WHEN** several distinct completions are admitted before the user inspects them
- **THEN** Office deduplicates repeated evidence for the same completion and retains a bounded,
  individually targetable presentation for the distinct unseen completions

#### Scenario: Room action is unavailable
- **WHEN** a room is stale, full or its host lacks the required capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation

### Requirement: Shared live terminal conversations
Office SHALL open a qualified agent or occupied desk in one focused live conversation backed by the
shell's existing terminal/session owner. Selecting the same terminal again SHALL focus the existing
attachment instead of creating a competing transport. Explicit handoff SHALL focus that same pane
in mounted Spaces while its qualified generation remains current.

The focused Office conversation SHALL retain usable input, selection, scrolling, uploads and mobile
controls and SHALL refit to its real dimensions. Its scene association SHALL remain legible when
the Office stage moves. Conversation validity SHALL be qualified by connection and runtime
generation. Choosing an operational target on another host MAY replace the prior focused
conversation through the existing selected-connection lifecycle; World SHALL NOT redirect input,
keep a hidden competing attachment, or require simultaneous retained conversations from several
hosts in this change.

#### Scenario: Open the same terminal twice
- **WHEN** a user opens an agent and then its occupied desk
- **THEN** World focuses one qualified conversation and does not create another attachment or send
  duplicate input

#### Scenario: Change focused host
- **WHEN** a user with an Office conversation explicitly opens a qualified terminal on another
  ready host
- **THEN** World activates and revalidates the new focused connection, retires the outgoing focused
  conversation according to the existing lifecycle and never redirects its input to the new pane

#### Scenario: Move between Office and Spaces
- **WHEN** a live Office conversation exists and the user chooses Open in Spaces
- **THEN** Spaces focuses the exact qualified pane without attaching a competing session

#### Scenario: Conversation target becomes stale
- **WHEN** the focused terminal's host reconnects, its generation is replaced or current admitted
  state confirms that the pane no longer exists
- **THEN** World disables or closes that focused conversation without targeting another host or
  colliding terminal identifier

#### Scenario: Compact Office conversation
- **WHEN** Office is used at phone width
- **THEN** the one focused terminal remains accessible and usable without overflowing the page

### Requirement: View-local continuity and failure isolation
Office selection SHALL survive admitted projection updates while that qualified entity exists.
Office layout, scroll and focused-context preferences SHALL use validated World-owned storage. An
Office load or render failure SHALL remain inside its stage and SHALL NOT terminate aggregate
observation, the shell-owned Inspector, mounted Spaces or its existing terminal ownership.

#### Scenario: Leave and return to Office
- **WHEN** the user moves between Office and Spaces while the selected qualified entity still
  exists
- **THEN** Office restores only its presentation state and does not add runtime subscriptions or a
  second Inspector

#### Scenario: Office fails to render
- **WHEN** the Office presenter cannot load or throws during presentation
- **THEN** World reports a bounded failure with navigation to Spaces while connection management,
  Inspector resources and existing Spaces terminals remain usable

## REMOVED Requirements

### Requirement: Tree Operations Console composition
**Reason**: Complete Tree work is deferred until the Office projection and operational-context seam
are accepted. The archived Operations Console composition is not part of this focused outcome.

**Migration**: Use Office for the visual control plane and Spaces for direct operational work. A
later Tree change can reuse the qualified World hierarchy without reviving this composition.
