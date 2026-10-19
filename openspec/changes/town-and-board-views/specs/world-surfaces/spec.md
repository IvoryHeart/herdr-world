## ADDED Requirements

### Requirement: Retired view addresses

World SHALL NOT offer Office, Tree or Graph views. Loading `/office` SHALL show Town, and loading
`/graph` or `/tree` SHALL show Board, replacing the browser history entry so Back does not return
to the retired address. A saved or invalid view value of `office` SHALL resolve to Town, and `graph`
or `tree` to Board.

#### Scenario: Open an old Office bookmark

- **WHEN** a user loads `/office`
- **THEN** Town appears within the common shell, the address shows `/town`, and Back leaves World
  rather than returning to `/office`

#### Scenario: Open an old Graph or Tree bookmark

- **WHEN** a user loads `/graph` or `/tree`
- **THEN** Board appears within the common shell and the address shows `/board`

### Requirement: Inspector opening preference

World SHALL expose a persisted Inspector opening preference with Docked and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved. In
Docked mode, a newly opened entity from Town or Board SHALL use the single docked Inspector and
remain available for explicit Dock out. In Floating mode, each newly opened entity SHALL use its own
cascaded floating Inspector without a fixed presentation-count cap. Changing the preference SHALL
govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
existing entity SHALL focus its current presentation. A preference saved before Office was retired
SHALL keep applying.

#### Scenario: Change the opening preference

- **WHEN** the user switches the preference from Floating to Docked while two floating Inspectors
  are open and then opens a third entity from Board
- **THEN** the two remain floating and the third opens in the docked Inspector

### Requirement: Shared spatial interaction

Town and Board SHALL interpret pointer input through one shared gesture model: press, pan with
fling, two-finger pinch, mouse drag beyond a small movement threshold, a touch press held still on a
draggable target becoming a drag, double tap or double-click, and taps. A second finger SHALL turn
any press or drag into a pinch, cancelling the drag. A pointer that is cancelled or lost SHALL end
its gesture without a stray tap or drop. Each view SHALL decide only what a pointer landed on and
what each gesture does.

Both views SHALL animate through World's shared frame scheduler: frames run only when something
changed or is moving, continuing motion SHALL pause while a terminal receives input and under
reduced motion, views that are off screen or in a hidden document SHALL not draw, and a failing
frame SHALL be reported without stopping later frames.

Each view SHALL offer an event trace for diagnosis, off by default and enabled per view through
`?debug=<view>` or the view's settings menu. The trace SHALL be a bounded, page-local record of
input, gesture changes, effects, frame reasons and errors, and SHALL be exported only when the user
copies it.

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

## MODIFIED Requirements

### Requirement: Common view navigation

The native World shell SHALL offer Town, Board, Desk and Spaces once each and SHALL keep rendered
view, browser history and canonical paths `/town`, `/board`, `/desk` and `/spaces` consistent. The
World root and unknown paths SHALL resolve to Town. Invalid view values SHALL resolve to Town, except
the retired values covered by Retired view addresses; explicit canonical paths, including `/desk`,
SHALL retain their requested views.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
Hosts filter; a muted aggregate health indicator with the bounded space/agent/stale summary
in its accessible label and tooltip SHALL remain in that top bar. The shell SHALL provide one shared
view-control slot there for view-specific search and controls. World SHALL NOT stack a second
view-navigation, Visual Control Plane status bar or view-local search/zoom header above the
application stage.
The inherited Spaces workspace navigator, focused tab strip and review-annotations control SHALL
remain the common frame around Town, Board, Desk and Spaces. Changing views SHALL replace only the
center surface. Inspector-created review drafts SHALL remain visible and editable through the same
workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
the navigator or the focused tab strip SHALL resolve through the same qualified World selection
path and update the docked Inspector only after exact focus succeeds.
Town SHALL be the primary default surface after a valid managed profile is selected. Town and Board
SHALL remain spatial views of the same topology, and Spaces SHALL remain the first-class
operational workspace and profile-management surface rather than being removed or embedded into
another view.
The common shell SHALL expose Manage connections separately from its Hosts filter using the
existing managed catalogue. Every operational workspace or Inspector SHALL identify its owning host
and state. The common navigator SHALL group workspaces by host within the filter; an already-open
workspace outside that filter SHALL retain its labelled context.
Inspector presentation, Town calm motion and optional observability configuration SHALL live in the
common settings menu on desktop, compact and Zen layouts.

#### Scenario: Browser history across views

- **WHEN** a user selects Board, selects Desk and then navigates Back
- **THEN** the URL and rendered view return to Board while the same shell retains terminal and
  Inspector ownership and each context's owning host

#### Scenario: Use the single application top bar

- **WHEN** a user changes among Town, Board, Desk and Spaces
- **THEN** the view selector, version, aggregate health summary, Hosts filter, Manage connections,
  applicable view controls and shell tools remain in one top bar and the selected view receives all
  remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Town, Board, Desk and Spaces with the current host filter
- **THEN** the same workspace navigator, focused tab context and annotations control remain
  available while only the center presentation changes

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

- **WHEN** a user opens the World root with a valid restored or default managed profile
- **THEN** World opens Town as the primary surface and keeps Board, Desk and Spaces available
  through the same navigation and shell

#### Scenario: Open the default view

- **WHEN** a user loads the World root, an unknown route or an invalid view value
- **THEN** Town appears within the common shell and connection onboarding remains
  available if no admitted runtime exists

#### Scenario: Open an explicit view route

- **WHEN** a user loads `/town`, `/board`, `/desk` or `/spaces`
- **THEN** the requested view appears and subsequent browser history preserves that
  explicit selection

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

## REMOVED Requirements

### Requirement: Pixel Office scene

**Reason**: The Pixel Office view is retired (owner decision, 2026-10-19). Town is its successor.
**Migration**: `/office` and saved Office views open Town.

### Requirement: Office pane-linked devices

**Reason**: Part of the retired Pixel Office scene.
**Migration**: Town shows each pane as a seat at its desk (Town scene and Town agent locations).

### Requirement: Office reception capacity

**Reason**: Part of the retired Pixel Office scene.
**Migration**: Town's reception and attention rail (Town agent locations, Town attention rail).

### Requirement: Office state and room operations

**Reason**: Part of the retired Pixel Office scene. The Inspector opening preference it described
applies to every view and moves to the Inspector opening preference requirement; room creation,
rename, close and seat creation are covered by Town's room actions.
**Migration**: Town and Board; the Inspector opening preference keeps the saved choice.

### Requirement: Office creation affordances follow operational capacity

**Reason**: Part of the retired Pixel Office scene.
**Migration**: Creation from the current World view, through Town's and Board's creation controls.

### Requirement: Rotate the Graph arrangement

**Reason**: The Graph view is retired (owner decision, 2026-10-19).
**Migration**: `/graph` opens Board, whose layout the user arranges directly.

### Requirement: Connected Tree presentation

**Reason**: The Tree view is retired (owner decision, 2026-10-19); the common navigator still shows
the host, workspace and agent hierarchy.
**Migration**: `/tree` opens Board.

### Requirement: Spatial Graph presentation

**Reason**: The Graph view is retired (owner decision, 2026-10-19). Board is its successor.
**Migration**: `/graph` opens Board.
