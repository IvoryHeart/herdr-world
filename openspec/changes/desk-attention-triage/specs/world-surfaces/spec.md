## ADDED Requirements

### Requirement: Desk attention triage

Desk SHALL present every admitted agent on the selected operational host by what it needs from the
operator. Needs you SHALL list blocked agents, oldest wait first, with the question read from the
bottom of the agent's visible screen. To review SHALL list done agents, idle agents whose latest turn
ended within 12 hours, and agents this browser observed stop working within 12 hours, each with its
turn receipt or, without one, its latest screen lines. In flight SHALL list working agents with their
current request and a live screen line. Remaining agents SHALL collapse into a quiet list. Cards SHALL
name the Herdr agent and, when reported, its harness and model.
Every card's primary action SHALL open the existing terminal Inspector for that exact
connection-qualified pane. Desk SHALL NOT send terminal input, answer approvals, assign tasks or run
lifecycle commands itself. Review marks SHALL apply to one stop of one agent session and SHALL remain
unavailable until a receipt has been read for the agent's present state; when no receipt can be read
for that state, the stop SHALL become markable without one. Keyboard shortcuts (J and K to move, Enter to
open, E to mark reviewed) SHALL apply only while focus is on the Desk or the page itself, SHALL NOT
replace the native activation of a focused control, and SHALL keep focus on the same agent while
lanes reorder.
Within the shared shell, Desk SHALL participate in the shell Actions menu, window arrangements of the
Inspectors it opens, and view-local failure isolation. It SHALL NOT establish a visual selection, so
selection-driven behavior (visual-route Action targets, the shared view-control search, watched
visual projection and the docked selection Inspector) SHALL NOT apply to it. Other managed hosts
SHALL appear only as non-actionable summaries.

#### Scenario: Answer a blocked agent

- **WHEN** an agent on the selected host is blocked on an approval
- **THEN** its Needs you card shows the approval question and choices from its screen, and Answer
  opens that pane's terminal Inspector without sending any input

#### Scenario: Review a finished turn

- **WHEN** an agent finishes a turn
- **THEN** its card moves from In flight to To review with the request, closing report, duration,
  tool calls and edited files, and marking it reviewed hides only that stop

#### Scenario: Keys aimed at other controls

- **WHEN** a keyboard user presses Enter on a focused button or in the top bar while Desk is shown
- **THEN** that control activates normally and no terminal Inspector opens

### Requirement: Bounded turn receipts

The service SHALL answer `agent_turn.get` for an exact pane and agent session by deriving the latest
turn from the session transcript it already resolves for Agent History, without storing it. A turn
SHALL consist of the steps after the latest user message. The receipt SHALL carry at most 600
characters of the request, at most 2,400 characters of the closing agent message (up to 32,000 when
the complete report is requested, with truncation reported), start and end times from agent steps,
tool-call and command counts and at most 24 edited file paths. Projection placeholders and trailing
system records SHALL NOT become the report, extend the duration or change the stop's identity.

#### Scenario: A hook record arrives after a reviewed stop

- **WHEN** a system record is appended to a transcript after a stop the operator marked reviewed
- **THEN** the receipt keeps the same stop identity, report and end time, and the stop stays reviewed

### Requirement: Bounded Desk observation

Desk SHALL partition and count every admitted agent. It SHALL read receipts for at most 40 agents
and visible screens for at most 16 panes, choosing blocked, then done, working and idle agents first.
Receipts SHALL refresh on a status or activity change and every 20 seconds; screens SHALL refresh
every 4 seconds. Reads SHALL stop while the page is hidden and resume when it is shown. Receipts and
screen excerpts SHALL be keyed by connection, runtime generation, pane and agent session, so a
replaced session never shows the previous session's text and a refresh does not remove a shown
receipt.

#### Scenario: More agents than the read bound

- **WHEN** a host has 40 idle agents and one blocked agent
- **THEN** the blocked agent appears in Needs you and is among the agents whose screens and receipts
  are read

## MODIFIED Requirements

### Requirement: Common view navigation

The native World shell SHALL offer Desk, Spaces, Office, Tree and Graph once each and SHALL keep
rendered view, browser history and canonical paths `/desk`, `/spaces`, `/office`, `/tree` and `/graph`
consistent. The World root and unknown paths SHALL resolve to Desk.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
machine selector; a muted selected-host/runtime indicator with the bounded space/agent/stale summary
in its accessible label and tooltip SHALL remain in that top bar. The shell SHALL provide one shared view-control slot there: Office, Tree and
Graph SHALL place search in it, and Graph SHALL additionally place Fit and zoom in it. World SHALL
NOT stack a second view-navigation, Visual Control Plane status bar or view-local search/zoom header
above the application stage.
The inherited Spaces workspace navigator, focused tab strip and review-annotations control SHALL
remain the common frame around Desk, Spaces, Office, Tree and Graph. Changing views SHALL replace only the
center surface. Graph SHALL not place a second workspace hierarchy beside that common navigator on
desktop. Inspector-created review drafts SHALL remain visible and editable through the same
workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
the navigator or the focused tab strip SHALL resolve through the same qualified World selection
path and update the docked Inspector only after exact focus succeeds.
Desk SHALL be the primary default surface after a valid managed profile is selected. Office, Tree
and Graph SHALL remain spatial views of the same topology, and Spaces SHALL remain the first-class
operational workspace and profile-management surface rather than being removed or embedded into
another view.
The existing Spaces connection selector SHALL remain the profile-management surface; visual World
views SHALL not introduce a second host catalogue and SHALL persistently identify the selected
operational host and its state.
Office room alignment, long-title treatment, Inspector presentation and optional observability
configuration SHALL live in the common settings menu on desktop, compact and Zen layouts. Office
SHALL NOT reserve a persistent toolbar or mobile/Zen shortcut strip for those infrequent controls.

#### Scenario: Browser history across views

- **WHEN** a user selects Tree, selects Graph and then navigates Back
- **THEN** the URL and rendered view return to Tree while the same shell retains terminal and
  Inspector ownership and the same selected host

#### Scenario: Use the single application top bar

- **WHEN** a user changes among Desk, Office, Spaces, Tree and Graph
- **THEN** the view selector, version, selected-host/runtime summary, machine selector, applicable
  search/Fit/zoom controls and shell tools remain in one top bar and the selected view receives all
  remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Desk, Spaces, Office, Tree and Graph for the selected host
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
- **THEN** World opens Desk as the primary surface and keeps Office, Tree, Graph and Spaces
  available through the same navigation and shell
