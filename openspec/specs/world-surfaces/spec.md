# World surfaces

## Purpose

Keep native World views on one qualified hierarchy, with shared operational authority, accessibility, spatial interaction and bounded presentation.

Feature contracts and source/test guidance live together in the nested capabilities:

- [Integrations](integrations/spec.md) · [notes](integrations/notes.md)
- [Shell navigation](shell-navigation/spec.md) · [notes](shell-navigation/notes.md)
- [Town](town/spec.md) · [notes](town/notes.md)
- [Town moves](town-moves/spec.md) · [notes](town-moves/notes.md)
- [Agent peeks](agent-peeks/spec.md) · [notes](agent-peeks/notes.md)
- [Board](board/spec.md) · [notes](board/notes.md)
- [Inspector](inspector/spec.md) · [notes](inspector/notes.md)
- [Chat](chat/spec.md) · [notes](chat/notes.md)
- [Terminal windows](terminal-windows/spec.md) · [notes](terminal-windows/notes.md)
- [Watchlist](watchlist/spec.md) · [notes](watchlist/notes.md)
- [Needs you](needs-you/spec.md) · [notes](needs-you/notes.md)
- [Desk attention](desk-attention/spec.md) · [notes](desk-attention/notes.md)
- [Creation profiles](creation-profiles/spec.md) · [notes](creation-profiles/notes.md)
- [Groups](groups/spec.md) · [notes](groups/notes.md)
- [Appearance](appearance/spec.md) · [notes](appearance/notes.md)
- [Notifications](notifications/spec.md) · [notes](notifications/notes.md)
- [History](history/spec.md) · [notes](history/notes.md)
- [Work sources](work-sources/spec.md) · [notes](work-sources/notes.md)
- [Town master](town-master/spec.md) · [notes](town-master/notes.md)
- [Settings](settings/spec.md) · [notes](settings/notes.md)
- [Apartments](apartments/spec.md) · [notes](apartments/notes.md)

## Requirements

### Requirement: Observational terminal opening

Opening World or retaining a hidden TUI attachment SHALL NOT resize an existing
native pane. An active terminal presentation MAY resize its exact qualified pane
under the established attachment/focus rules; observing a pane, restoring a
window or mounting an offscreen client SHALL NOT by itself acquire resize authority.

#### Scenario: Hidden app client connects

- **WHEN** World connects its hidden app client before presenting a terminal
- **THEN** it uses the runtime's current viewport and sends no browser-default resize

### Requirement: Safe rendered Markdown destinations

Rendered Markdown links SHALL reject unsafe schemes after browser-equivalent
normalization, including embedded controls and encoded whitespace. Rendering a
label SHALL NOT turn a rejected destination into an executable browser URL.

#### Scenario: Obfuscated script scheme

- **WHEN** Markdown contains a browser-normalized scripting destination
- **THEN** the renderer omits the unsafe href while preserving readable content

### Requirement: Optional observations
Observability providers SHALL remain optional. The service SHALL mediate bounded transport
and the browser SHALL NOT receive provider credentials.

#### Scenario: Provider absent
- **WHEN** no optional provider is available
- **THEN** core topology and terminals remain available without invented agent activity

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

### Requirement: Native World shell

The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Town, Board, Desk and Spaces. Those views SHALL share the same
connection identities, admitted topology, Inspector resources and terminal ownership; World SHALL
not embed or launch a separately branded Roamgate application.

#### Scenario: Install World only

- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and native World visual views are available without installing Roamgate or another web bridge

#### Scenario: Use the Inspector without leaving a visual view

- **WHEN** a user selects an actionable space or pane on any admitted managed host in Town or Board
  and opens Files, Changes or Agent History
- **THEN** the selected visual view remains visible and the shell-owned Inspector uses only that
  entity's owning connection, runtime generation, workspace and optional pane context

#### Scenario: Activate a host from a visual view

- **WHEN** a stale context explains its host is disconnected and the user reconnects it through
  Manage connections
- **THEN** only that runtime reconnects and newly opened resources require current target admission,
  without retiring other hosts or replaying the stale action

### Requirement: View-local continuity and failure isolation

Selection of a qualified entity SHALL survive Town and Board changes while that entity
exists. The Inspector opening and Town preferences and the Board layout SHALL use distinct validated World-owned storage. A view load or render failure SHALL
remain inside its stage and SHALL NOT terminate aggregate observation, the shell-owned Inspector,
mounted Spaces or live terminal ownership.

#### Scenario: Switch repeatedly among complete views

- **WHEN** the user changes among Town and Board while a terminal is live
- **THEN** selection and terminal ownership remain stable, each view restores only its own
  presentation state and runtime subscription counts do not increase

#### Scenario: One view fails to render

- **WHEN** a view-specific renderer cannot load or throws during presentation
- **THEN** World reports a bounded failure with navigation to another view while Spaces, connection
  management, Inspector resources and existing terminals remain usable

### Requirement: Explicit destinations and independent command focus

Resource requests, terminal input, popup and clipboard handling, uploads, annotations, launchers,
worktree operations and workspace mutations SHALL use the owning operational context's captured
connection, runtime generation and applicable resource/session identity.

#### Scenario: Explicit destinations and independent command focus acceptance rules

- **WHEN** World presents or operates its shared surfaces
- **THEN** Window focus SHALL govern
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

### Requirement: Shared spatial interaction

Town and Board SHALL interpret pointer input through one shared gesture model: press, pan with
fling, two-finger pinch, mouse drag beyond a small movement threshold, a touch press held still on a
draggable target becoming a drag, double tap or double-click, and taps.

#### Scenario: Shared spatial interaction acceptance rules

- **WHEN** World presents or operates its shared surfaces
- **THEN** A second finger SHALL turn
  any press or drag into a pinch, cancelling the drag. A pointer that is cancelled or lost SHALL end
  its gesture without a stray tap or drop. Each view SHALL decide only what a pointer landed on and
  what each gesture does.

  Both views SHALL animate through World's shared frame scheduler: frames run only when something
  changed or is moving, continuing motion SHALL pause while a terminal receives input and under
  reduced motion, views that are off screen or in a hidden document SHALL not draw, and a failing
  frame SHALL be reported without stopping later frames.

  Diagnostic instrumentation (the event trace, its overlay and renderer counters) SHALL exist only
  in development builds. A release build SHALL contain no instrumentation code, overlay, settings
  toggle or query switch. In a development build each view SHALL offer the event trace, off by
  default and enabled per view through `?debug=<view>` or the view's settings menu; the trace SHALL
  be a bounded, page-local record of input, gesture changes, effects, frame reasons and errors, and
  SHALL be exported only when the user copies it.

#### Scenario: A release build has no instrumentation

- **WHEN** a user opens a release build of World with `?debug=board`
- **THEN** Board shows no trace overlay or Event trace setting, and the shipped scripts contain no
  trace code

#### Scenario: A quick swipe on a desk pans

- **WHEN** a user on a phone swipes quickly across a desk in Town
- **THEN** the map pans and nothing is picked up

#### Scenario: Hold to pick up

- **WHEN** a user on a phone holds still on a desk in Town, or on a tab in Board, and then moves
- **THEN** the desk or tab is lifted and follows the finger

#### Scenario: A second finger during a drag

- **WHEN** a second finger touches while a card or desk is being dragged
- **THEN** the drag is cancelled without a drop and the gesture becomes a pinch

#### Scenario: Board settles while the user types

- **WHEN** Board cards are gliding and the user starts typing in a terminal
- **THEN** the motion pauses until typing stops, and the drag the user is holding, if any, still
  follows the pointer

### Requirement: Shared presentation across views

The application SHALL derive one connection-qualified World hierarchy from the World service's
managed profiles and admitted runtime snapshots.

#### Scenario: Shared presentation across views acceptance rules

- **WHEN** World presents or operates its shared surfaces
- **THEN** Each managed connection SHALL be a host root,
  each observed Herdr workspace SHALL be its direct space child, and each observed pane SHALL appear
  exactly once as an agent or terminal child of its owning space. Equal native identifiers on
  different connections SHALL remain distinct. A pane SHALL retain stable terminal-backed identity
  when its agent classification, label, status or focus changes.

  Desk, Spaces, Town and Board SHALL consume the same connection and generation identities and
  reuse shell-owned Inspector resources and terminal ownership. Selection SHALL not itself mutate
  Herdr. All managed hosts SHALL be observed independently of the browser's view filter.

  Desk, Town and Board SHALL present the aggregate filtered by All hosts or an explicit set of
  managed hosts. Counts and search SHALL use the same filter and distinguish current, stale and
  omitted observations. Every managed host in scope SHALL retain a qualified root, including offline
  hosts without children. A host filter SHALL NOT connect, disconnect, select an operational runtime,
  retire an open context or change an in-flight operation's target.

  Terminal, Spaces, Inspector, room and launcher actions SHALL use their captured owning connection,
  current generation and entity identity with current capability and resource admission. They SHALL
  be available across compatible ready hosts without a global operational-host selection. Stale or
  unavailable targets SHALL explain their state without falling back to another host.

#### Scenario: Move between Spaces and a visual view

- **WHEN** a user opens a qualified terminal in Spaces, visits Town or Board and returns
- **THEN** the same Spaces application and terminal ownership remain available without another
  service or attachment

#### Scenario: Spaces is mounted but hidden

- **WHEN** Town or Board is active and a Spaces operational shortcut is pressed
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

#### Scenario: Active host changes during a visual action

- **WHEN** the owning generation changes while a Town or Board entity is opening
- **THEN** the obsolete action cannot dispatch or report success for a replacement context and
  never targets a colliding workspace on another host

#### Scenario: Switch views with an open terminal

- **WHEN** a user switches between Town and Board while a qualified conversation is open
- **THEN** every view interprets the same entity and the conversation remains owned by its exact
  connection and runtime generation

#### Scenario: Visual target becomes unavailable

- **WHEN** a selected Town or Board target becomes stale, offline, removed or generation-replaced before an
  action
- **THEN** the action is disabled or rejected and is not redirected to another host or colliding
  native identifier

#### Scenario: Two hosts contain equal identifiers

- **WHEN** two managed hosts report equal workspace, pane or terminal identifiers
- **THEN** the hierarchy contains distinct connection-qualified subtrees and an action is admitted
  only against its entity's current owning connection and generation

#### Scenario: Two hosts contain equal space and terminal identifiers

- **WHEN** two managed hosts report equal native space or terminal identifiers
- **THEN** Board connects every entity only within its distinct connection-qualified host
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

- **WHEN** Town or Board places an agent differently for presentation
- **THEN** the shared hierarchy still records it beneath the authoritative owning host and space

### Requirement: Bounded view composition

Town and Board SHALL each present their complete view-specific composition over the shared
hierarchy. Each view SHALL use explicit tested entity and label bounds, report exact presentation
omissions, keep stale state visible, and contain its stage within the application viewport. Internal
canvas movement or logical scrolling MAY expose a larger composition without creating horizontal
overflow on the application page.

#### Scenario: Search and collapse

- **WHEN** a user searches Board or collapses a host or space branch
- **THEN** search retains the complete ancestor context of matches and clearing search restores the
  view's in-memory disclosure state

#### Scenario: Search Board from the common header

- **WHEN** a user searches the filtered aggregate from Board and chooses a matching entity
- **THEN** World selects that exact qualified entity without adding a Board stage toolbar or
  changing connection lifecycle or the host filter

#### Scenario: Select a stale entity

- **WHEN** a user inspects an entity retained from an unavailable host
- **THEN** World identifies it as stale and disables operational terminal and Inspector actions

#### Scenario: Compact visual plane

- **WHEN** Town or Board opens at phone width
- **THEN** navigation, hierarchy selection and guarded actions remain reachable without causing
  horizontal overflow of the application page

#### Scenario: Presentation bound is exceeded

- **WHEN** a view observes more entities than its tested presentation capacity
- **THEN** it prioritizes relevant live entities, reports exact omitted counts and never implies
  that omitted entities were removed from Herdr
