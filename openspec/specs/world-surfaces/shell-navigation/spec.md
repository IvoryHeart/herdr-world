# World shell navigation

## Purpose

Define the user-facing shell navigation contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Visual-route Actions

Desk, Town and Board SHALL expose a common named Actions control for the explicitly selected
space, agent or terminal.

#### Scenario: Visual-route Actions acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** The control SHALL be reachable by pointer and keyboard on desktop and
  compact layouts, identify the captured host, space and pane as applicable, and offer the
  target's existing applicable Terminal, Files, Changes, Agent History and Go to Spaces actions.
  It SHALL additionally provide New tab for the selected entity's workspace and New
  workspace with an explicitly confirmed destination host, following the shared
  creation preparation and completion requirements.
  It SHALL also expose view-wide window arrangements independently of entity selection. The shell's
  right-side Roamgate-derived Actions command menu SHALL retain its original shell commands and add
  target actions, Pin, Unpin, Pinned only and arrangements in visual views, without a duplicate
  view-toolbar Actions control; the view toolbar SHALL keep search available.
  Inspector resource and Go to Spaces actions SHALL reuse the shared Inspector and explicit owning-context focus path; they SHALL NOT use
  hidden Spaces focus, create another terminal owner, send terminal input, assign tasks or control
  an agent lifecycle. A missing or unavailable target SHALL explain why no target action can run.

  Before dispatch, Actions SHALL validate the captured connection ID, runtime generation, entity
  identity and current selected entity against current qualified target admission. Changing the
  selected entity or its generation, or losing target admission, SHALL invalidate the capture and prevent
  an action from falling through to a colliding entity or hidden Spaces state. Go to Spaces SHALL
  focus the exact validated target before changing the visible view and SHALL leave the visual view
  visible if that focus fails.

#### Scenario: Open Actions for a selected agent

- **WHEN** a user selects an actionable agent in Desk, Town or Board and opens Actions
- **THEN** the menu identifies that agent and offers its admitted Inspector resources and Go to
  Spaces

#### Scenario: No actionable selection exists

- **WHEN** a user opens Actions without an actionable space or pane selected
- **THEN** it asks the user to select a visual entity for target actions, keeps window arrangements and explicitly targeted New workspace available, and does not use the last focused Spaces pane

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

The native World shell SHALL offer Town, Board, Desk and Spaces once each and SHALL keep rendered
view, browser history and canonical paths `/town`, `/board`, `/desk` and `/spaces` consistent.

#### Scenario: Common view navigation acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** The
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

### Requirement: Persist host filters without operational side effects

The common shell SHALL offer All hosts and an explicit set of managed hosts as view
filters, independently of connection management and operation targets. An explicit
empty set SHALL show no hosts; it SHALL NOT mean All hosts.

#### Scenario: Persist host filters without operational side effects acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** All hosts SHALL be the
  initial scope. World SHALL restore an explicitly saved filter on reload, including an empty
  one, prune removed profile identities and restore All hosts with an explanation if no saved
  identity remains. A legacy
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
scope when enabled, independently of renderer truncation.

#### Scenario: Search and summarize the filtered aggregate honestly acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** Results SHALL preserve qualified ancestry,
  use bounded presentation and report omitted matches. Selecting an actionable result SHALL reveal
  its qualified target by reprioritizing the bounded view without changing the host filter or attaching
  a different entity. Observation bounds SHALL remain explicit; search SHALL NOT imply access to
  entities absent from the service's bounded observation.

  Counts SHALL identify their filter scope and distinguish observed matches, rendered entities,
  omissions and stale or unavailable coverage. Missing observations SHALL NOT be counted as zero
  agents. Board SHALL retain all filtered host roots within the managed catalogue limit,
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

### Requirement: Transient layers close top first

Menus, popovers, pickers and lists opened over a terminal or view SHALL form one
last-in, first-out stack.

#### Scenario: Transient layers close top first acceptance rules

- **WHEN** World presents the shared shell or dispatches navigation and Actions
- **THEN** Escape and Back SHALL close only the top layer, one
  per key or Back. A press outside all layers (including on the terminal) SHALL
  close every open layer, so one tap returns to the terminal. A press inside a
  lower layer SHALL close only the layers above it. These rules SHALL hold whether focus is in
  the terminal or a layer and whether the press is a mouse click or a touch. A
  press outside SHALL still reach what was pressed. A dialog outside the stack
  keeps its own keys and presses while it is above the top layer. The on-screen Back SHALL close an
  open layer before it leaves a terminal. Closing a layer by Escape, Back or a
  choice SHALL return focus to what had it before the layer opened, the terminal
  included; closing it by a press SHALL leave focus with what was pressed.

#### Scenario: Dismiss a dropdown by tapping the terminal

- **WHEN** a dropdown is open over a terminal on a phone and the user taps the terminal
- **THEN** the dropdown closes and the terminal is shown

#### Scenario: Nested layers

- **WHEN** a terminal window's menu and the colour picker inside it are open
- **THEN** Escape or Back closes the picker, and a second one closes the menu

#### Scenario: A press outside nested layers

- **WHEN** a terminal window's menu and the colour picker inside it are open
- **THEN** a press on the terminal closes both and shows the terminal, while a press on the menu closes only the picker

#### Scenario: Back from the workspace list

- **WHEN** the user opens the workspace list from a terminal's title on a phone and taps Back
- **THEN** the list closes and the terminal is shown; the next Back leaves the terminal

#### Scenario: Focus returns to the terminal

- **WHEN** the user, typing in a terminal, opens its window menu and presses Escape
- **THEN** the menu closes and keyboard focus is back in the terminal

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

### Requirement: Town in the World shell

Town SHALL be a World view with its own route and entries in the shell's view switcher and phone
navigation. Town SHALL render inside the shared World shell and SHALL NOT add a second application
top bar. What needs the user SHALL open in the shared Needs you tab, as in every view. Town search,
settings and full terminals SHALL use the shell's search, common menu and shared Inspector, so a
terminal opened from Town remains the same presentation after switching views.

#### Scenario: Switch from Town to Board with a terminal open

- **WHEN** the user opens an agent's terminal from a Town peek and switches to Board
- **THEN** the shell's view switcher changes the view and the same qualified
  terminal presentation remains open without being recreated

#### Scenario: Switch views on a phone

- **WHEN** the user is in Town on a phone
- **THEN** the shell's bottom navigation remains available to switch to Board, Desk or Spaces,
  and the Town tray sits above it

### Requirement: Mobile shell agent commands require explicit selection

Ordinary mobile shell panes SHALL offer editable agent launch commands beside
Message and the Direct-mode hint. Preferences SHALL be isolated to this browser, connection and
agent. Selection SHALL require an empty Message draft, validate a single-line
command and send it once with Enter to the captured pane. Detection or editing
SHALL NOT execute a command. Failed sends SHALL retain the command for recovery.
Existing agent and pad panes SHALL NOT offer this launcher.

#### Scenario: Selection fails after command detection

- **WHEN** an eligible user chooses a command and the captured pane rejects input
- **THEN** Message SHALL retain the command and report the error without retrying it
- **AND** a connection or pane replacement SHALL dismiss obsolete detection results

### Requirement: Hosts filter lists machines

The Hosts filter SHALL list one row per machine, where a machine is this
computer or one exact SSH destination, the same identity Town uses for its
machine buildings; a connection with no profile type SHALL be a machine of its
own. Checking or unchecking a row SHALL show or hide every runtime of that
machine.

#### Scenario: Hosts filter acceptance rules

- **WHEN** World lists hosts in the Hosts filter
- **THEN** each row SHALL be named by the machine's first runtime in catalogue
  order and SHALL show one lifecycle state when all of its runtimes share it,
  otherwise how many of its runtimes are in each state other than ready. The
  top bar and the phone's corner menu SHALL show the same rows and change the
  same selection. The selection SHALL remain stored as connection IDs. A
  stored selection naming any runtime of a machine SHALL show the whole
  machine. The filter SHALL stay view-only: every operation SHALL remain
  qualified by its own connection ID and generation, and per-runtime state
  SHALL remain in Manage connections.

#### Scenario: One machine with two runtimes

- **WHEN** this computer runs a Herdr TUI connection and a herdr-core
  connection and the user opens Hosts
- **THEN** one row names this computer with a summary of both runtimes' states
- **AND** unchecking it hides both runtimes' rooms from Town and Board

#### Scenario: A selection saved per connection

- **WHEN** a stored Hosts selection names only a machine's Herdr TUI connection
- **THEN** the machine's row is checked and its herdr-core rooms are shown too,
  without rewriting the stored selection

#### Scenario: Unchecking the last selected machine

- **WHEN** one machine is selected, or the only machine is shown under All
  hosts, and the user unchecks it
- **THEN** the selection is explicitly empty, the menu reads No hosts and Town
  and Board show no rooms
- **AND** the empty selection is restored on reload until the user checks a
  machine or chooses All hosts
