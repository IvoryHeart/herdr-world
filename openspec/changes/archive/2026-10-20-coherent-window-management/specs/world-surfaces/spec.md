## ADDED Requirements

### Requirement: Coordinated window presentation

World SHALL use consistent window controls and placement rules for Inspectors and
arranged Spaces terminal windows. Opening or focusing a window SHALL preserve all
other window placements. Focus order SHALL be independent of layout order.
Minimize SHALL retain an accessible window-switcher entry and its restore state.
Window close SHALL dismiss presentation without ending a Herdr tab or session.
Maximize SHALL fill the usable work area and Restore SHALL return to the previous
placement. A retired runtime SHALL retire only its own windows.

#### Scenario: Open and focus after snapping

- **WHEN** a user snaps A, opens B, focuses A and then snaps B to the same region
- **THEN** A retains its placement, B overlaps it in that region and focus only
  determines which window is on top

#### Scenario: Minimize, maximize and restore

- **WHEN** an arranged window is maximized, minimized and restored from the switcher
- **THEN** its placement and resource selection remain recoverable without a
  duplicate terminal attachment or a change to another window

#### Scenario: Dismiss a Spaces presentation

- **WHEN** the user closes an arranged Spaces window
- **THEN** its Herdr tab and session remain open and explicit tab selection can
  present it again

### Requirement: Shared window work area

Windows SHALL use the measured work area outside persistent shell controls.
Desktop windows SHALL support accessible movement and resizing from all edges and
corners, and snapping SHALL preview its destination. Explicit arrangements SHALL
retain stable participants and expose shared tile dividers where applicable.
Compact presentation SHALL show one active window while preserving desktop state.
The mobile ellipsis and expanded menu SHALL remain floating without reserving a
permanent row. Mobile SHALL hide the tab strip and retain tab and window switching
in those floating controls. The composer SHALL reserve its own content space.
Terminal fitting SHALL use its visible content box and preserve qualified ownership.

#### Scenario: Resize an arranged pair

- **WHEN** the user moves a shared divider in a tiled pair
- **THEN** the adjacent windows resize together within their usable minima and
  unrelated windows keep their placement

#### Scenario: Open the keyboard and return to desktop

- **WHEN** an arranged desktop workspace becomes compact and the user opens the keyboard
- **THEN** its active terminal fits above the keyboard and visible controls, and
  returning to desktop restores the previous desktop window placements

#### Scenario: Preserve the Roamgate foundation

- **WHEN** a window changes placement, view or presentation
- **THEN** its terminal protocol, pane layout and workspace resource operations
  retain their existing connection and runtime generation without a duplicate owner

#### Scenario: Use one floating mobile tab list

- **WHEN** the user expands the mobile ellipsis and opens the second-row Tabs menu
- **THEN** that menu preserves native tab creation and closure, restores minimized windows, and includes retained windows from other hosts or workspaces; Arrange SHALL sit beside Tabs in the second row; the third row SHALL contain terminal/resource controls without a duplicate tab/window list icon or arranger

## MODIFIED Requirements

### Requirement: Common view navigation

The native World shell SHALL offer Desk, Spaces, Office, Tree and Graph once each and SHALL keep
rendered view, browser history and canonical paths `/desk`, `/spaces`, `/office`, `/tree` and `/graph`
consistent. The World root and unknown paths SHALL resolve to Office.
The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
Hosts filter; a muted aggregate health indicator with the bounded space/agent/stale summary
in its accessible label and tooltip SHALL remain in that top bar. The shell SHALL provide one shared view-control slot there: Office, Tree and
Graph SHALL place search in it, and Graph SHALL additionally place Fit and zoom in it. World SHALL
NOT stack a second view-navigation, Visual Control Plane status bar or view-local search/zoom header
above the application stage.
The inherited Spaces workspace navigator, desktop focused tab strip and review-annotations control SHALL
remain the common frame around Desk, Spaces, Office, Tree and Graph. Changing views SHALL replace only the
center surface. Graph SHALL not place a second workspace hierarchy beside that common navigator on
desktop. Inspector-created review drafts SHALL remain visible and editable through the same
workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
the navigator or the focused tab strip SHALL resolve through the same qualified World selection
path and open or focus the matching Inspector only after exact focus succeeds.
Office SHALL be the primary default surface after a valid managed profile is selected. Desk, Tree
and Graph SHALL remain views of the same topology, and Spaces SHALL remain the first-class
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
- **THEN** World opens Desk as the primary surface and keeps Office, Tree, Graph and Spaces
  available through the same navigation and shell

#### Scenario: Open the default view

- **WHEN** a user loads the World root, an unknown route or an invalid view value
- **THEN** Office appears within the common shell and connection onboarding remains
  available if no admitted runtime exists

#### Scenario: Open an explicit view route

- **WHEN** a user loads `/desk`, `/spaces`, `/office`, `/tree` or `/graph`
- **THEN** the requested view appears and subsequent browser history preserves that
  explicit selection

### Requirement: Shared entity detail drawer

Office, Tree and Graph SHALL provide one consistent shell-owned Inspector in a managed
window surface, with a full-work-area compact presentation. Every Inspector SHALL
identify its qualified entity with a compact icon, name and bounded status or read-only-host cue and
SHALL give its primary area to immediately visible applicable Terminal, Files, Changes and Agent
History tabs. Identity and resources SHALL share one lifecycle, header and close control rather than
stack a separate agent profile card above the resource pane. Terminal SHALL be the first tab and the
initial tab for a newly opened terminal-capable entity; changing one Inspector's active tab SHALL NOT
change another Inspector or the default for a later entity.

Selecting an actionable entity in Office, Tree or Graph SHALL open or focus its managed
Inspector without changing another window's placement. Tree SHALL use the same window
surface and SHALL NOT transfer an Inspector into an expanded leaf. The common navigator
and focused tab strip SHALL use the same qualified admission. New Office Inspectors SHALL
honour the Floating or Snap right preference; the legacy Docked preference SHALL migrate
to Snap right. Existing Inspectors SHALL retain their placement. A newly opened wide-screen
Desk reading Inspector SHALL start snapped right, with its queue remaining usable.

Every desktop Inspector SHALL expose snap, minimize, maximize/restore and close controls,
a draggable header and resize handles on every edge and corner. Snapping into an occupied
region SHALL overlap without moving or discarding its occupant. Changing presentation SHALL
retain the selected resource and its state. Window controls SHALL affect presentation only;
terminal input activation SHALL remain an explicit qualified content interaction.

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

- **WHEN** the user snaps, moves, resizes, minimizes, maximizes or restores an Inspector
- **THEN** it retains its qualified resource state and other windows retain their placement

#### Scenario: Expand and detach a Tree leaf Inspector

- **WHEN** a user opens an actionable Tree leaf and then changes to Graph or Office
- **THEN** the same managed Inspector retains its placement and resources without a second
  inline presentation or duplicate terminal ownership

#### Scenario: Dock while another Inspector is docked

- **WHEN** A occupies the right half and the user snaps B there
- **THEN** B overlaps A, both remain open and focusing either changes only their stacking order

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

Office SHALL expose a persisted Inspector opening preference with Snap right and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved. In
Snap right mode, a newly opened Office entity SHALL use the right half of the work area
without replacing any occupant. A legacy Docked preference SHALL map to Snap right. In
Floating mode, each newly opened Office entity SHALL use its own
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

- **WHEN** the user selects Snap right or Floating in the common settings menu and opens new Office
  entities
- **THEN** Snap right overlaps an occupied right region without displacing it, Floating opens distinct bounded cascaded windows,
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

Desktop Inspectors and arranged Spaces windows SHALL provide accessible snap, minimize, maximize, resize and close controls. Maximize SHALL temporarily expand the selected window over the available work area while preserving its current arrangement participants. It SHALL save the complete prior presentation and geometry, including snap or arrangement placement, so the window's Restore control returns it to that state. Resizing SHALL update the selected window's usable dimensions without changing its terminal or conversation ownership. If global Restore positions is invoked while a window is maximized, it SHALL restore the captured arrangement baseline and clear the maximize snapshot so a later window Restore cannot reinstate stale placement.

#### Scenario: Maximize and restore a floating terminal
- **WHEN** a user maximizes a floating terminal window in Office and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior size and position when restored

#### Scenario: Maximize and restore a docked terminal
- **WHEN** a user maximizes a snapped terminal window in Office and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior snap and size

#### Scenario: Maximize and restore an arranged terminal
- **WHEN** a user maximizes one terminal window in an Office arrangement and then restores it
- **THEN** it returns to its prior arranged placement while the other arrangement participants retain their geometry

#### Scenario: Restore arrangement positions while a window is maximized
- **WHEN** a user invokes Restore positions while an arranged terminal window is maximized
- **THEN** participants return to their captured baseline presentation and geometry, and a later window Restore does not restore the superseded maximized snapshot

#### Scenario: Resize any Office terminal window
- **WHEN** a user resizes a floating, snapped, or arranged terminal window
- **THEN** the selected window changes size and its terminal remains attached to the same conversation

#### Scenario: Use window controls without a pointer
- **WHEN** a user navigates to maximize or resize controls with a keyboard or assistive technology
- **THEN** each control has an accessible name and can be operated without pointer precision

### Requirement: Arrange existing terminal windows from the shared shell

The shared shell SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions. On desktop the control SHALL sit in the top bar beside the window switcher; on mobile it SHALL appear inside the existing ellipsis-expanded floating controls; the redundant mobile tab strip SHALL be hidden. The shared shell Actions command menu SHALL expose the same view-wide arrangement choices and unavailable reasons in every view. Each choice MAY be given a configurable keyboard shortcut, with none assigned by default; invoking an assigned shortcut SHALL follow the same availability and Restore rules without sending terminal input. The shell's existing shortcut defaults and numbered Actions order SHALL remain unchanged. Single SHALL show one active window fitted to the available stage, except while a Spaces workspace is suspended by Close all terminal windows. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. Each visible Spaces tab window SHALL present that tab's Herdr-reported split or zoom layout in Single and multiwindow arrangements, with the tab window owning each pane it presents. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows. If its Terminal resource is selected, it SHALL show an actionable focus affordance for the active tab window without attaching a second terminal or changing the selected resource tab.

In visual views, an arrangement SHALL include the currently presented, non-minimized
Inspectors across managed hosts. It SHALL reposition only conversations participating when
invoked. Single SHALL show the active Inspector while suspending other retained presentations.
Selecting B SHALL preserve A's conversation and placement. All views SHALL share arrangement
choices and geometry rules. Arranging SHALL NOT create or close Herdr tabs, panes, sessions
or connections, change the host filter or resource tab, or send terminal input. Hidden visual
Inspectors SHALL remain unmodified while Spaces is visible, and hidden Spaces windows SHALL
remain unmodified in a visual view. Minimized windows SHALL stay minimized during ordinary
arrangements; Open all terminal windows SHALL also restore minimized presentations.

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
- **THEN** every eligible Inspector participates while its resource tab, selected pane, session and window controls remain available

#### Scenario: Use Single in a visual view

- **WHEN** several Inspectors are open in Office, Tree or Graph and the user chooses Single
- **THEN** the active Inspector fills the available stage, other retained conversations stay open without live hidden terminal attachments, and selecting one of them brings that Inspector into Single under its existing presentation rules

#### Scenario: Replace a docked Inspector while Single is active

- **WHEN** A is presented in Single and ordinary selection admits B
- **THEN** B becomes the visible Single window, A remains available in the window switcher,
  and Restore can recover A without duplicate terminal ownership

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

- **WHEN** a user views the desktop top bar or expands the mobile ellipsis controls with one open tab
- **THEN** one arrangement control is reachable in the desktop top bar or inside the expanded mobile controls, with no separate mobile tab-strip icon

#### Scenario: Arrange from Actions or a shortcut

- **WHEN** a user chooses a layout from the shell Actions menu, or uses its assigned shortcut in the current view
- **THEN** that view applies the same eligible-window layout as the shell arrangement control, or leaves geometry unchanged when the choice is unavailable; the shell menu offers the layouts even without an actionable visual entity selected

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

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. They SHALL shrink windows evenly below their normal floating minimum when needed, then scroll horizontally for Columns or vertically for Rows at the usable tiled minimum. They SHALL mount only nearby windows and terminal presentations, and focusing an offscreen window SHALL scroll it into view. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile every eligible window in a count-based rectangular layout. Its column count SHALL be the smaller of the ceiling of the square root of the window count and the number of usable-width tiles that fit the stage; additional rows SHALL scroll vertically at no less than the usable tiled minimum height. Six SHALL form a 3×2 grid and sixteen a 4×4 grid when those shapes fit the stage, without floating overflow layers. Grid SHALL mount only nearby window shells and terminal presentations; focusing an offscreen window SHALL scroll it into view. Cascade SHALL use the normal viewport-fitted default floating-window size, shrinking all windows equally only when needed to fit its diagonal offsets, and SHALL keep older title regions visible behind newer windows. When a further offset would make a window smaller than its usable minimum, Cascade SHALL repeat the diagonal in another vertically scrollable stage, mount only nearby presentations, and scroll an offscreen focused window into view. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, with balanced stage insets at supported UI scales and reachable title and window controls. Scrollable visual arrangements SHALL expose a visible scrollbar on the applicable axis and clip their Inspector windows at the available stage, so offscreen windows cannot cover shell controls or receive pointer input beyond the stage. A tiled window SHALL retain its usable compact minimum during explicit resize. An option that cannot fit every eligible window at usable width SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an eligible window set, World SHALL capture its previous presentation and each window's available prior geometry, including Spaces Single, floating, snapped or tiled placement. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance, changing the current active tab/pane or moving an instance that has never participated. Restoring Spaces' original Single presentation SHALL show its currently active tab unless that workspace remains suspended by Close all terminal windows. A Tree inline return SHALL use its exact leaf if that leaf is still visible, and otherwise use the normal docked overlay. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable window and preserve desktop arrangement positions for return to desktop. A runtime-generation change SHALL remove only that runtime's retired windows from the arrangement and restore snapshot; other participants SHALL remain recoverable. A host filter change SHALL preserve the arrangement and restore snapshot. Spaces and visual views SHALL retain their respective window placement while inactive without arranging each other's hidden windows. Spaces SHALL keep tab-window placement separate for each focused workspace and SHALL detach the old workspace's terminal presentations when focus changes to another workspace.

Maximize SHALL temporarily present a window over the available stage while preserving its other arrangement participants. It SHALL capture the complete prior presentation context and geometry, including snap placement, arrangement membership, tile geometry and order. The window's Restore control SHALL return it to that captured presentation. If Restore positions is invoked while a window is maximized, all still-open participants SHALL return to the captured arrangement baseline and the maximize snapshot SHALL be cleared; an individual Restore action SHALL NOT reapply superseded geometry.

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

- **WHEN** Inspector windows were arranged in Tree and the user chooses Restore positions
- **THEN** still-open participants return to their captured window placements without losing
  resource state, reopening closed windows or moving later nonparticipants

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

- **WHEN** a user maximizes a snapped Office Inspector and then activates its Restore control
- **THEN** the Inspector returns to its prior snap and geometry without losing its resource state or terminal ownership

#### Scenario: Maximize and restore an arranged Inspector

- **WHEN** a user maximizes an Inspector in a multiwindow arrangement and then activates its Restore control
- **THEN** it returns to its captured tile geometry and order while the other participants retain their placement

#### Scenario: Restore arrangement positions while maximized

- **WHEN** a user invokes Restore positions while an arranged Inspector is maximized
- **THEN** every still-open participant returns to its captured arrangement baseline and a later per-window Restore does not reinstate superseded geometry

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
Moving, snapping, resizing or maximizing an Inspector SHALL preserve its qualified
terminal owner and selected resource. Opening another Inspector SHALL retain existing
conversations. Single and compact views SHALL suspend hidden terminal presentations while
retaining window state, and minimize SHALL retain an accessible switcher entry.

Closing a window SHALL dismiss only its presentation and SHALL NOT close a Herdr tab, pane
or session. Native tab closure SHALL remain a separately named operation. The Inspector SHALL
NOT add another Open in Spaces shortcut; the primary view selector remains available.

Desktop windows SHALL have independent bounded placement, stacking, resource selection and
close/focus behavior. Terminal text SHALL retain configured metrics and fit the actual content
box, preserving input, selection, scrolling, uploads and compact input controls. Titles and
resize handles SHALL stay recoverable within the work area. Compact layouts SHALL present one
active usable Inspector. Connectors SHALL follow qualified visible scene anchors behind desktop
windows and SHALL be hidden when compact windows cover the scene. Presentation SHALL never
imply different runtime ancestry, resource scope or terminal identity.

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
- **THEN** World opens or focuses its qualified Inspector on Terminal in the current Snap right or
  Floating default presentation and draws a connector to the represented desk or agent

#### Scenario: Move an Inspector between docked and floating presentations

- **WHEN** the user changes a window between floating, snapped, tiled and maximized placements
- **THEN** the complete Inspector retains its resource state and qualified terminal ownership

#### Scenario: Change selection while an Inspector is docked

- **WHEN** A is open and the user selects B, including while Single is active
- **THEN** B is admitted only after qualified focus succeeds and A remains independently
  available without being retargeted or implicitly rearranged

#### Scenario: Select an entity from the common navigator

- **WHEN** an actionable space or agent is selected in the common navigator in a visual view
- **THEN** its managed Inspector opens or receives focus with the same qualified identity
  and resources as selection inside that view

#### Scenario: Dock into an occupied Inspector target

- **WHEN** A is snapped and the user snaps B into the same region
- **THEN** A retains its placement and resources while B is raised above it

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

## RENAMED Requirements

- FROM: `### Requirement: Arrange existing terminal windows from the shared tab bar`
- TO: `### Requirement: Arrange existing terminal windows from the shared shell`
