## ADDED Requirements

### Requirement: Creation from the current World view

Office, Desk, Tree and Graph SHALL provide New workspace and New tab through the
common Actions control on desktop and compact layouts. New workspace SHALL offer
an explicitly confirmed destination host. New tab SHALL identify its selected
workspace and owning host; selecting an agent or terminal SHALL target that
entity's owning workspace. A missing New tab target SHALL explain that a workspace
or one of its entities must be selected, without using hidden Spaces focus.

Office room and desk creation, shared tab-strip and mobile tab creation,
Inspector create-tab shortcuts, and Spaces creation SHALL use the same qualified
preparation and creation behavior. Visual creation SHALL retain the current visual
view. Spaces SHALL retain its existing terminal layout, navigation and input
behavior while sharing those operations.

#### Scenario: Create a tab in each visual view

- **WHEN** a user selects a current workspace or its agent/terminal in Office, Desk,
  Tree or Graph and activates New tab
- **THEN** World creates a tab in that exact workspace and host without requiring
  a visit to Spaces, retains the visual view and presents the created terminal

#### Scenario: Create a workspace with no visual entity selected

- **WHEN** a user activates New workspace without an entity selected
- **THEN** World identifies the chosen destination host for confirmation and
  creates only on that captured host and runtime generation

#### Scenario: New tab has no selected workspace

- **WHEN** a user opens Actions with only a host selected or with no selection
- **THEN** New tab explains its missing workspace target, while New workspace
  remains available for an admitted destination and does not inherit Spaces focus

#### Scenario: Create using a mobile control

- **WHEN** a user on a compact layout creates a workspace or tab from a visual view
- **THEN** creation and destination controls remain reachable without a desktop
  tab strip, canvas pointer precision or a hover-only explanation

#### Scenario: Create in Spaces

- **WHEN** a user creates a workspace or tab in Spaces
- **THEN** the same destination, preparation and failure rules apply and the
  created terminal appears through the existing Spaces presentation

### Requirement: Qualified creation preparation and readiness

World SHALL capture the creation destination and resolve a valid source on that
owning connection and runtime generation before mutation. For browser-local
creation it SHALL prepare and retain this browser's current source attachment
without requiring a visible terminal, an existing Inspector or prior Spaces
navigation. The source whose readiness is checked SHALL be the source used for
dispatch, including workspace, tab, pane and terminal identity.

World SHALL establish the destination runtime's navigation mode and current
topology before choosing a creation path. Missing or cached operational state
SHALL NOT be treated as proof of shared navigation or an empty runtime. A
validated empty-host bootstrap SHALL remain available when no workspace exists;
an existing workspace without an admitted source SHALL not invoke that bootstrap.
Shared navigation SHALL retain its existing creation behavior without imposing a
browser-local endpoint requirement.

Equivalent creation controls SHALL derive availability, preparation progress and
unavailable explanations from the same qualified state. A ready destination whose
source can be prepared SHALL permit the user to start that preparation and creation
without another view transition. Preparation SHALL have a finite deadline and
expose progress and failure. Method advertisement alone SHALL NOT establish this
browser's attachment ownership; detached, superseded or other-browser attachments
SHALL not admit mutation.

World SHALL maintain one terminal owner per qualified terminal across preparation,
Spaces and Inspectors. Ownership handoff and cleanup SHALL not detach a
replacement owner or invalidate a source while an admitted creation depends on it.
Preparation SHALL not send shell input or change unrelated workspace/tab selection.
Changing filters or another context's focus SHALL not retarget a submitted
operation. Losing the captured source or runtime SHALL reject pre-dispatch work
without connection or control-API fallback.

#### Scenario: Create in a second room without opening its Inspector

- **WHEN** a ready browser-local host contains two workspaces and a user activates
  the second room's add-desk control before opening its terminal
- **THEN** World prepares a source within that second workspace and creates there,
  regardless of the first room's existing attachment or browser navigation

#### Scenario: Create on an unobserved ready host

- **WHEN** a ready host has aggregate topology but no loaded operational session
  and a user starts creation on it
- **THEN** World establishes its current navigation mode and qualified source
  before dispatch, without selecting that host globally or assuming shared mode

#### Scenario: Readiness and New Room dispatch use the same source

- **WHEN** a user starts New Room from workspace B while workspace A is the
  connection's remembered browser-selected workspace
- **THEN** preparation, method checks and browser-local dispatch use the captured
  source in B and do not switch to A during submission

#### Scenario: An advertisement belongs to another browser

- **WHEN** a source advertises creation methods through another browser's live
  terminal session and this browser has no current source attachment
- **THEN** World treats the source as needing preparation and does not dispatch
  creation based only on that advertisement

#### Scenario: Source attachment changes after the button renders

- **WHEN** a source detaches, reconnects, closes or changes attachment incarnation
  after a creation control was rendered ready
- **THEN** readiness is revoked, late replies cannot restore obsolete ownership,
  and submission revalidates or prepares the same qualified source before dispatch

#### Scenario: Spaces and Inspector share a creation source

- **WHEN** creation preparation and a Spaces/Inspector presentation require the
  same qualified terminal, including during a view handoff
- **THEN** they reuse or transfer its exclusive ownership, do not race competing
  attaches and retain the source for the admitted creation's lifetime

#### Scenario: Create the first workspace on an empty host

- **WHEN** current qualified observation confirms that the chosen host has no
  workspaces and the user confirms New workspace
- **THEN** World uses the validated empty-host bootstrap once without requiring
  a nonexistent terminal source

#### Scenario: A capability or destination is unavailable

- **WHEN** the captured host is stale/offline/retired, no valid source exists in
  a nonempty browser-local runtime, or the negotiated endpoint lacks creation
- **THEN** World explains the specific unavailable state and performs no mutation
  on that host, a replacement generation or another connection

### Requirement: Creation completion and terminal presentation

World SHALL suppress duplicate submissions of a pending creation intent and keep
its captured destination through preparation, dispatch and completion. Successful
visual creation SHALL open or focus the exact qualified root terminal returned by
the creation operation, using the shared Inspector while retaining the active
visual view. All creation entry points SHALL apply the same bounded admission
behavior when runtime topology becomes visible asynchronously.

The previous Inspector SHALL remain available until the created terminal can be
admitted and focused. A failed create SHALL report failure without replacing it.
A successful create followed by admission/focus failure SHALL report that the
workspace/tab exists and that presentation failed. A missing root terminal
identity SHALL be treated as a presentation failure, without guessing a terminal.

Changing visual views SHALL not lose creation completion. A later explicit user
selection or Inspector action SHALL supersede an older automatic focus intent
without changing its creation destination or hiding its successful result.
Runtime replacement and transport retirement SHALL fence late completion.
An uncertain outcome after dispatch SHALL be reported as potentially created and
SHALL NOT trigger an automatic repeated creation.

#### Scenario: Topology admits a newly created terminal later

- **WHEN** creation returns its root terminal before World topology admits it
- **THEN** World retains the previous Inspector, waits within a bounded admission
  window and opens only that exact terminal after current admission succeeds

#### Scenario: Global workspace or shared tab-strip creation succeeds

- **WHEN** a user creates through New workspace or the shared tab strip while a
  visual view is active
- **THEN** the same qualified terminal completion used by Office desk creation
  presents the result without switching to Spaces

#### Scenario: Creation or presentation fails

- **WHEN** creation is rejected, the returned root identity is absent, or created
  terminal admission/focus does not succeed before its deadline
- **THEN** World preserves the previous Inspector and distinguishes a creation
  failure from a successful creation whose terminal could not be presented

#### Scenario: User activates a creation control repeatedly

- **WHEN** a user double taps, double clicks or repeats a create shortcut while
  the same creation intent is preparing or dispatching
- **THEN** World sends at most one mutation for that intent and exposes its progress

#### Scenario: User changes views or chooses another terminal while creating

- **WHEN** creation is pending and the user changes to another visual view or
  explicitly opens another terminal
- **THEN** completion remains qualified and available across views, and an older
  focus intent does not replace the user's newer explicit Inspector choice

#### Scenario: Creation reply is lost after dispatch

- **WHEN** a timeout, reconnect or runtime retirement prevents a definite reply
  after creation may have been dispatched
- **THEN** World identifies the captured host and uncertain outcome, preserves the
  previous Inspector and does not automatically create again

### Requirement: Office creation affordances follow operational capacity

Office's drawn creation affordances, their semantic browser controls and shared
Actions SHALL agree on the qualified operation's availability, progress, cursor
and unavailable explanation. Temporary scene-layout readiness SHALL be distinct
from connection, source and capability unavailability.

The number of rendered desks SHALL remain bounded, and overflow SHALL remain
visible. Reaching the scene's eight-desk presentation bound SHALL NOT prohibit
creating another admitted tab in that workspace. Office SHALL retain a reachable
creation control and present the new terminal independently of scene capacity.

#### Scenario: A room already renders eight desks

- **WHEN** a ready workspace already occupies the eight rendered desk positions
  and the user activates its creation control
- **THEN** World can create another tab and open its terminal while preserving
  bounded rendering and truthful overflow information

#### Scenario: Canvas and browser control change readiness

- **WHEN** a room's source preparation or availability changes
- **THEN** its drawn plus and semantic control expose consistent availability and
  pointer feedback, with an explanation reachable on touch devices

#### Scenario: Scene geometry is being updated

- **WHEN** Office temporarily lacks matching rendered and semantic geometry
- **THEN** it prevents stale canvas activation, distinguishes this rendering state
  from runtime failure and keeps the shared creation menu usable

## MODIFIED Requirements

### Requirement: Common view navigation

The native World shell SHALL offer Desk, Spaces, Office, Tree and Graph once each and SHALL keep
rendered view, browser history and canonical paths `/desk`, `/spaces`, `/office`, `/tree` and `/graph`
consistent. The World root and unknown paths SHALL resolve to Office. Invalid view values SHALL
resolve to Office; explicit canonical paths, including `/desk`, SHALL retain their
requested views.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
Hosts filter; a muted aggregate health indicator with the bounded space/agent/stale summary
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
Office SHALL be the primary default surface after a valid managed profile is selected. Office, Tree
and Graph SHALL remain spatial views of the same topology, and Spaces SHALL remain the first-class
operational workspace and profile-management surface rather than being removed or embedded into
another view.
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

- **WHEN** a user changes among Desk, Office, Spaces, Tree and Graph
- **THEN** the view selector, version, aggregate health summary, Hosts filter, Manage connections, applicable
  search/Fit/zoom controls and shell tools remain in one top bar and the selected view receives all
  remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Desk, Spaces, Office, Tree and Graph with the current host filter
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

- **WHEN** a user opens the World root with a valid restored or default managed profile
- **THEN** World opens Office as the primary surface and keeps Desk, Tree, Graph and Spaces
  available through the same navigation and shell

#### Scenario: Open the default view

- **WHEN** a user loads the World root, an unknown route or an invalid view value
- **THEN** Office appears within the common shell and connection onboarding remains
  available if no admitted runtime exists

#### Scenario: Open an explicit view route

- **WHEN** a user loads `/desk`, `/spaces`, `/office`, `/tree` or `/graph`
- **THEN** the requested view appears and subsequent browser history preserves that
  explicit selection

### Requirement: Visual-route Actions

Desk, Office, Tree and Graph SHALL expose a common named Actions control for the explicitly selected
space, agent or terminal. The control SHALL be reachable by pointer and keyboard on desktop and
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

- **WHEN** a user selects an actionable agent in Desk, Office, Tree or Graph and opens Actions
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
