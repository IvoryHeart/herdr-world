# World surfaces

## Purpose

Keep Town, Board, Desk and Spaces as native presentations over one filtered aggregate,
independent qualified operational contexts, one docked Inspector and floating Inspectors,
and exclusive ownership of each qualified terminal.

## Requirements

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
  and Town, Board and Inspector show the text after their existing observation
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

Desk, Town and Board SHALL expose a common named Actions control for the explicitly selected
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

### Requirement: Terminal file links use the originating Inspector

Activating a workspace file link in a terminal presented by Town or Board SHALL bring that
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

In Town and Board, activating an Inspector window whose selected resource is Terminal
SHALL focus its terminal input and its selected pane. Explicitly selecting a pane within that
window SHALL make that exact pane the input recipient, including when another pane or window was
previously focused. Bringing a window forward SHALL NOT route typed input to another pane. Moving
between visual views SHALL preserve the qualified pane target. Selecting a non-Terminal resource
SHALL not steal keyboard focus for terminal input.

#### Scenario: Answer an agent in a split terminal

- **WHEN** an agent in one pane requests input and the user selects that pane in a Town or Board
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
On phones, a terminal screen's app bar SHALL carry Back, the terminal's identity,
Tabs and the overflow menu; the tab strip SHALL be hidden, and tab and window
switching SHALL stay in that bar. The composer SHALL reserve its own content space.
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

#### Scenario: Use the phone tab list

- **WHEN** the user opens Tabs from a terminal screen's app bar on a phone
- **THEN** the list preserves native tab creation and closure, restores minimized
  windows, and includes retained windows from other hosts or workspaces

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

### Requirement: Arrange existing terminal windows from the shared tab bar

The shared tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions. On desktop the control SHALL sit at the right edge of the tab bar; on mobile it SHALL appear inside the existing ellipsis-expanded floating controls, including when the tab strip is hidden for one tab. The shared shell Actions command menu SHALL expose the same view-wide arrangement choices and unavailable reasons in every view. Each choice MAY be given a configurable keyboard shortcut, with none assigned by default; invoking an assigned shortcut SHALL follow the same availability and Restore rules without sending terminal input. The shell's existing shortcut defaults and numbered Actions order SHALL remain unchanged. Single SHALL show one active window fitted to the available stage, except while a Spaces workspace is suspended by Close all terminal windows. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. Each visible Spaces tab window SHALL present that tab's Herdr-reported split or zoom layout in Single and multiwindow arrangements, with the tab window owning each pane it presents. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows. If its Terminal resource is selected, it SHALL show an actionable focus affordance for the active tab window without attaching a second terminal or changing the selected resource tab.

In Town and Board, an arrangement SHALL include every currently visible Inspector conversation across managed hosts, including the docked Inspector. It SHALL reposition only conversations that are open when invoked. Single SHALL show the active Inspector while suspending terminal presentations in other conversations that remain open under the existing dock and floating admission rules. In particular, ordinary selection of B while A is docked SHALL still close A before admitting B; Single SHALL NOT retain A as a hidden extra Inspector or change the one-docked-Inspector rule. World SHALL admit distinct floating Inspectors without a fixed presentation-count cap; this SHALL NOT change Spaces' existing tab admission. All four views SHALL use the same arrangement choices and geometry rules over their current window sets. Arranging SHALL NOT itself create or close Herdr tabs, panes, terminal sessions, Inspectors or connections, change the host filter, connection lifecycle or resource tab, or send terminal input. Hidden visual Inspectors SHALL remain hidden and unmodified while Spaces is visible, and hidden Spaces tab windows SHALL remain unmodified in a visual view.

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

- **WHEN** two or more Inspectors are visible in Town or Board and a user chooses an arrangement
- **THEN** every visible Inspector, including a docked one, participates while its resource tab, selected pane, session and close/dock controls remain available

#### Scenario: Use Single in a visual view

- **WHEN** several Inspectors are open in Town or Board and the user chooses Single
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

- **WHEN** Close all terminal windows is invoked in Town or Board while one conversation is visible and another is hidden by Single or compact layout
- **THEN** all open Inspector conversations across managed hosts close, no conversation reappears after changing arrangement or returning to desktop, and Herdr tabs, panes, processes and sessions remain open

#### Scenario: Open all selected-host terminals

- **WHEN** the user chooses Open all terminal windows in Town or Board
- **THEN** one Inspector window opens for every actionable terminal tab within the current host filter that lacks a window, existing Inspector conversations remain open, the resulting set uses scrollable Grid when usable, and no Herdr tab, pane, process or session is created or closed

### Requirement: Present one Inspector per Herdr tab with its split panes

An actionable Herdr tab SHALL have at most one World Inspector conversation. Selecting any pane in that tab through Town, Board, the common navigator or inside the Inspector's own split Terminal SHALL focus that conversation, select the requested pane within it and show the current Herdr split-pane layout when Terminal is selected. The Inspector identity and window geometry SHALL remain stable as selection moves among sibling panes; its header and pane/agent-specific resource applicability SHALL follow the selected pane, with Agent History available only when that pane has an admitted agent session. A non-terminal space Inspector SHALL remain a separate conversation. If the selected pane closes while sibling panes remain, the Inspector SHALL select a remaining live pane in the same qualified tab; when the tab no longer exists, the conversation SHALL retire.

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

Town and Board SHALL offer accessible Pin, Unpin and browser-local Pinned
only controls in the shell Actions menu. Pinned only retains filtered multi-host hierarchy context and filters
search within that set. Board SHALL prioritize watched leaves while
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

### Requirement: Desk attention triage

Desk SHALL present every current actionable agent within the host filter by what it needs from the
operator. Needs you SHALL list blocked agents, oldest wait first, with the question read from the
bottom of the agent's visible screen. To review SHALL list done agents, idle agents whose latest turn
ended within 12 hours, and agents this browser observed stop working within 12 hours, each with its
turn receipt or, without one, its latest screen lines. In flight SHALL list working agents with their
current request and a live screen line. Remaining agents SHALL collapse into a quiet list. Cards and
rows SHALL name each agent by the name the operator gave Herdr, otherwise the thread title its harness
writes to the terminal, otherwise the harness, and SHALL show its harness, model, workspace, tab and
working folder when known. Every card and row SHALL identify its owning host.
Desk SHALL offer three modes and SHALL open on Now for each browser session: Now (the lanes above),
Agents (every current actionable agent within the host filter, agents recently opened from the Desk first, then
workspaces, grouped by workspace identity and ordered by their most recently active agent) and
Reviewed (each agent's latest stop that the operator marked reviewed, newest first and reopenable,
while that agent remains idle or done). Older stops are not retained. One search SHALL filter every
mode by agent name, thread title, harness, workspace, tab, folder, request and report. Marking a
stop reviewed SHALL offer an immediate undo.
On wide screens, opening an agent from the Desk SHALL show its existing Inspector docked beside the
Desk as a reading pane, with the lanes folded into one prioritized queue. Moving through the queue
with J and K SHALL show the next agent in the reading pane without moving keyboard focus out of
the queue, Enter SHALL move focus into its terminal, and Esc SHALL close the pane. On narrow screens
the Inspector SHALL open full screen instead.
Receipts, full reports and screen reads SHALL target each leaf's immutable connection ID and runtime
generation. Every card's primary action SHALL open the existing terminal Inspector for that exact
connection-qualified pane. Desk SHALL NOT send terminal input, answer approvals, assign tasks or run
lifecycle commands itself. Review marks SHALL apply to one stop of one agent session and SHALL remain
unavailable until a receipt has been read for the agent's present state; when no receipt can be read
for that state, the stop SHALL become markable without one. Keyboard shortcuts (J and K to move, Enter to
open, E to mark reviewed) SHALL apply only while focus is on the Desk or the page itself, SHALL NOT
replace the native activation of a focused control, and SHALL act on the card that holds keyboard
focus: focusing any control in a card makes it the active card, J and K move keyboard focus with the
highlight, and focus stays on the same agent while lanes reorder.
Within the shared shell, Desk SHALL participate in the shell Actions menu, window arrangements of the
Inspectors it opens, and view-local failure isolation. On wide screens it SHALL select the agent shown
in its reading pane only to dock that agent's Inspector; other selection-driven behavior
(visual-route Action targets, the shared view-control search and watched visual projection) SHALL
NOT apply to it. Managed hosts outside the filter
SHALL appear only as non-actionable summaries drawn from the aggregate observation. Review marks, observed stops and recent opens SHALL be scoped to the connection, runtime generation,
pane and agent session across host filter and operational focus changes, so they never carry over
to another session or a same-named pane on another host.

#### Scenario: Answer a blocked agent

- **WHEN** an agent within the host filter is blocked on an approval
- **THEN** its Needs you card shows the approval question and choices from its screen, and Answer
  opens that pane's terminal Inspector without sending any input

#### Scenario: Review a finished turn

- **WHEN** an agent finishes a turn
- **THEN** its card moves from In flight to To review with the request, closing report, duration,
  tool calls and edited files, and marking it reviewed hides only that stop

#### Scenario: Return to a reviewed stop

- **WHEN** an operator marks a stop reviewed and later wants it back
- **THEN** Undo restores it immediately, and while the agent stays idle or done, Reviewed lists that
  stop with its receipt and a Reopen action

#### Scenario: Find the agent worked with recently

- **WHEN** an operator searches for words from an agent's thread title, tab, folder or request, or
  opens Agents
- **THEN** the matching agents appear with those identifying details, with agents recently opened
  from the Desk listed first, and selecting one opens its terminal Inspector

#### Scenario: Work through the queue beside a reading pane

- **WHEN** an operator on a wide screen opens a card and then presses J
- **THEN** the agent's Inspector stays docked beside a one-column queue and shows the next agent,
  while keyboard focus stays in the queue until Enter moves it into that terminal

#### Scenario: Keys aimed at other controls

- **WHEN** a keyboard user presses Enter on a focused button or in the top bar while Desk is shown
- **THEN** that control activates normally and no terminal Inspector opens

#### Scenario: Colliding agent panes on filtered hosts

- **WHEN** two filtered hosts expose the same native pane ID
- **THEN** Desk triages both agents and reads each host's own receipt and screen, and reviewing one
  stop does not mark the other host's stop reviewed

### Requirement: Bounded turn receipts

The service SHALL answer `agent_turn.get` for an exact pane and agent session by deriving the latest
turn from the session transcript it already resolves for Agent History, without storing it. When the
caller names the session fingerprint it shows, the service SHALL return no receipt if the pane runs
another session before or after the read, and the browser SHALL publish a receipt or complete report
only for the session and stop that its card shows. Stop identities SHALL name the session file, not
only its file name. A turn
SHALL consist of the steps after the latest user message. The receipt SHALL carry at most 600
characters of the request, at most 2,400 characters of the closing agent message (up to 32,000 when
the complete report is requested, with truncation reported), start and end times from agent steps,
tool-call and command counts and at most 24 edited file paths. Projection placeholders (such as
reasoning and usage records) and trailing system records SHALL NOT become the report, extend the
duration or change the stop's identity.

#### Scenario: A hook record arrives after a reviewed stop

- **WHEN** a system record is appended to a transcript after a stop the operator marked reviewed
- **THEN** the receipt keeps the same stop identity, report and end time, and the stop stays reviewed

### Requirement: Bounded Desk observation

Desk SHALL partition and count every current actionable agent within the host filter. It SHALL read receipts for at most 40 agents
and visible screens for at most 16 panes globally, choosing blocked, then done, working and idle agents
first. Capacity SHALL be shared fairly among hosts within each urgency tier, with independent per-host
queues. Failed or retired hosts SHALL NOT redirect reads to another host or prevent healthy hosts
from being read. Pending reads SHALL retain active admission until settlement; status, activity and
visibility refreshes SHALL coalesce queued work without overlapping reads of the same kind on one host.
Receipts SHALL refresh on a status or activity change and every 20 seconds; screens SHALL refresh
every 4 seconds. Reads SHALL stop while the page is hidden, including reads already queued, and resume when it is
shown. Receipts and
screen excerpts SHALL be keyed by connection, runtime generation, pane and agent session, so a
replaced session never shows the previous session's text and a refresh does not remove a shown
receipt.

#### Scenario: More agents than the read bound

- **WHEN** a host has 40 idle agents and one blocked agent
- **THEN** the blocked agent appears in Needs you and is among the agents whose screens and receipts
  are read

#### Scenario: A Desk read completes after host retirement

- **WHEN** a receipt, full report or screen read completes after its runtime is retired
- **THEN** its result is not published and healthy hosts remain independently readable

#### Scenario: Slow Desk host alongside a healthy host

- **WHEN** a filtered host's receipt or screen read remains pending
- **THEN** another host's receipts, review controls and screen polling progress independently,
  and equally urgent hosts share the bounded read admission fairly

### Requirement: Creation from the current World view

Town, Desk and Board SHALL provide New workspace and New tab through the
common Actions control on desktop and compact layouts. New workspace SHALL offer
an explicitly confirmed destination host. New tab SHALL identify its selected
workspace and owning host; selecting an agent or terminal SHALL target that
entity's owning workspace. A missing New tab target SHALL explain that a workspace
or one of its entities must be selected, without using hidden Spaces focus.

Town room and desk creation, shared tab-strip and mobile tab creation,
Inspector create-tab shortcuts, and Spaces creation SHALL use the same qualified
preparation and creation behavior. Visual creation SHALL retain the current visual
view. Spaces SHALL retain its existing terminal layout, navigation and input
behavior while sharing those operations.

#### Scenario: Create a tab in each visual view

- **WHEN** a user selects a current workspace or its agent/terminal in Town, Desk or
  Board and activates New tab
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
- **THEN** the same qualified terminal completion used by Town desk creation
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

### Requirement: Town scene

Town SHALL present a town in which each presented host is one building along a
road, each admitted Herdr workspace of that host is a room on a carpet inside its
building, and each admitted tab is a desk in its room. A desk SHALL be a table
with one seat per admitted pane up to four drawn seats, sized to its panes: a
one-pane desk SHALL be a solo desk, a two-pane desk a small table with one seat on
each side, and three or four panes a four-seat team table; an agent pane SHALL show
its agent character at its seat while seated, and a non-agent pane SHALL show a
screen without a character. Panes beyond the drawn seats SHALL remain
individually reachable through an exact count and chooser. Each building SHALL
contain a lounge and a reception, and the reception SHALL show the user behind
its counter. Scene position SHALL NOT change an entity's authoritative host,
workspace, tab or pane ancestry.

A building for a host whose topology is cached after failure SHALL be visibly
stale and its entities SHALL be non-actionable. Town SHALL NOT invent activity,
cost, completion or project data when no authoritative state or optional provider
supplies it.

#### Scenario: Several hosts with different workspaces

- **WHEN** three filtered hosts expose different numbers of workspaces, tabs and panes
- **THEN** Town shows three buildings, each containing exactly its host's rooms,
  desks and seats with qualified identities, and no room appears in another host's building

#### Scenario: A tab has more panes than drawn seats

- **WHEN** a tab contains six admitted panes
- **THEN** its desk draws four seats, shows the exact count of six, and the two
  remaining panes stay individually selectable through the chooser

#### Scenario: A host's runtime fails

- **WHEN** a presented host's connection fails and Town retains its cached topology
- **THEN** its building is marked stale, its desks and agents cannot start
  operations, and other buildings remain fully usable

#### Scenario: No observation provider is configured

- **WHEN** no optional provider supplies cost, activity or project data
- **THEN** Town shows authoritative Herdr state only and omits or labels the
  unavailable figures instead of showing estimates

### Requirement: Stable Town placement

Town SHALL derive room order from Herdr's native workspace order and desk order
from Herdr's tab list order within each workspace, which Herdr keeps when a tab
moves (a tab's number is not its position). Desk slot i of a room SHALL be the
room's i-th drawn tab, in reading order, so a reorder in Herdr, Spaces or Town
moves desks. A room's capacity SHALL step through a
bounded set of grid sizes that always leaves at least one free desk spot: a room
grows square until it reaches its shape's width (four desks on a phone, six on
portrait and mid-width screens, eight on wide screens) and then extends
downward, up to 127 drawn desks, and its building grows around it, so a room of
real size shows every desk. Only a room with more tabs than that SHALL leave
desks undrawn: it SHALL keep the selected desk and the three newest tabs, then
desks whose agents need the user, are working or are unknown, then finished
ones, hiding idle and empty desks first, and SHALL count every hidden desk on
the room. Zooming into a room taller or wider than the usable view, from its
card or with Zoom in, SHALL open at its first desks. While a
scene is live, a topology change SHALL NOT reorder rooms or move a desk to
another room: a tab Herdr adds last SHALL take the first free spot of its room
without moving other desks, and a closed tab SHALL leave no gap: the desks after
it in reading order SHALL close up in their existing order while the desks
before it keep their spots. A room that reaches a new capacity step MAY shift
later rooms and rows of the same building without reordering rooms, and its
desks MAY reflow to the step's columns; it SHALL keep its size step when desks
close. Room placement SHALL be re-derived from native order when the scene is
rebuilt. Town SHALL take its shape from its container's size rather than one
breakpoint: on a phone, rooms SHALL stack in one column and buildings in one
vertical column; on a portrait screen or a half-width window, rooms SHALL form
two columns and buildings SHALL stack (or share a street when the window is
landscape); on a wide screen, rooms SHALL form three columns and buildings
SHALL share one street. Rooms SHALL fill their building's columns in workspace
order, and while a scene is live each room SHALL keep its column, so a room
that grows moves only the rooms below it in that column. The lounge SHALL stay
above the rooms, and the lobby and reception below them. A reflow that would move rooms
or buildings SHALL wait while the user presses, scrolls or zooms and until a
short pause after, and the camera SHALL then follow the room in view so it
stays where it was.

#### Scenario: A tab is created while the user watches

- **WHEN** a new tab is admitted in a room that has free spots
- **THEN** the new desk appears in the first free spot and every other desk and
  room keeps its position

#### Scenario: A tab closes in the middle of a room

- **WHEN** a tab whose desk sits between other desks closes
- **THEN** the desks after it close up in order, the desks before it keep their
  spots, and the room keeps no empty gap

#### Scenario: A room fills its capacity step

- **WHEN** a room's last free spot is taken
- **THEN** the room grows to the next capacity step with a free spot, rooms keep
  their order, and desks keep their room and their order

#### Scenario: Agents fill a room past its old size

- **WHEN** a room has 24, 50 or 100 tabs
- **THEN** the room extends and draws a desk for every tab, the newest included,
  on a phone, a half-width window, a wide screen and a portrait monitor

#### Scenario: A room grows while the user watches

- **WHEN** a room gains enough tabs to grow while the user holds the town
- **THEN** no room or building moves until the user lets go and pauses, and
  then the rooms below it in its column move down while the room in view stays
  where it was

#### Scenario: Tabs are reordered outside Town

- **WHEN** the user moves a tab to the front of its workspace in Spaces or in
  Herdr
- **THEN** that tab's desk takes its room's first slot and the desks before its
  old slot shift one slot on, once Herdr reports the new order

### Requirement: Town zoom levels

Town SHALL present town, overview, room and desk levels over the same
placement, selected by on-screen size. The town level SHALL show roofs with host
summaries. The overview level SHALL show one status card per room with its name,
desk count, working count, a status distribution, a waiting count when non-zero
and a project signal line when a provider supplies one, plus one reception board
per host showing waiting agents. The room level SHALL show tables with a status
mark per seat. The desk level SHALL show characters, screens and animation with
per-seat targets. Waiting attention SHALL be visible at every level. Status SHALL
be conveyed by text or accessible names in addition to colour. The desktop
default view SHALL fit every presented building at the overview level; the phone
default view SHALL fit the first building's width. When the presented rooms are
too many for readable cards at the fit-all zoom, the desktop default MAY fit
every building at the town level instead, with cards appearing as the user
zooms in. Only on-screen buildings need to keep their room cards, plaques and
reception boards in the document.

Activating a room at the overview or room level SHALL zoom to that room, and a
double tap or double click SHALL zoom in at its location. Zoom controls SHALL
remain available as visible buttons.

#### Scenario: Read the whole office at a glance

- **WHEN** the user opens Town on a desktop with three hosts and twenty-four rooms
- **THEN** every room's status card and every host's reception board are visible
  without panning, and rooms with waiting agents show their waiting count

#### Scenario: Open a town too large for room cards

- **WHEN** the user opens Town on a desktop where the presented rooms are too
  many for readable cards at the fit-all zoom
- **THEN** every building is visible under its roof with its host summary, and
  zooming in shows the room cards of the buildings on screen

#### Scenario: Zoom from a room card to its desks

- **WHEN** the user activates a room's status card
- **THEN** Town zooms to that room and its tables, seats and agents become
  individually targetable

#### Scenario: Zoom out past the overview

- **WHEN** the user zooms out beyond the fit-all view
- **THEN** roofs cover the buildings and each roof shows its host's room and desk
  counts while the reception boards keep showing waiting agents

### Requirement: Town agent locations

Town SHALL seat working and unknown agents at their pane's seat. A blocked agent
SHALL move to its host's reception and queue in order of when it became blocked,
oldest first, within a bounded number of queue positions; further blocked agents
SHALL stay at their seat with a waiting cue and the reception SHALL show the exact
overflow count. A done agent SHALL also go to its host's reception, queued after
the blocked agents, show a completion marker, and leave finished work on its
desk until its status changes or the user checks the completion by opening its
terminal or marking it reviewed; a checked agent SHALL then go to the lounge.
Because Herdr may report a finished agent as idle, Town SHALL also treat an
agent it observes going from working or blocked to idle as done until checked.
A check covers one completion: when the agent works, asks or finishes again,
its next completion SHALL be unchecked. This browser-local state SHALL NOT
represent approval or mutate Herdr. Desks
SHALL carry their tab's name from the room level, and each seat its agent's or
terminal's name at the desk level. An idle agent SHALL move to a lounge spot in its
building, or remain seated with an idle cue when no spot is free. When an
agent's status changes, it SHALL move to its new location, and an answered agent
SHALL return to its seat. Location and movement SHALL be presentation only: they
SHALL NOT delay operational state, and every agent SHALL keep its exact qualified
pane target wherever it stands.

#### Scenario: An agent asks for input and is answered

- **WHEN** a working agent becomes blocked and the user answers it
- **THEN** the agent walks to its host reception and joins the queue in age order,
  and after the answer it walks back to its seat while its pane identity and
  terminal target stay unchanged

#### Scenario: More agents are blocked than queue positions

- **WHEN** a host has more blocked agents than its reception's queue positions
- **THEN** the oldest fill the queue, the rest show a waiting cue at their seats,
  the reception shows the exact total, and every blocked agent remains reachable

#### Scenario: An agent finishes

- **WHEN** an agent becomes done
- **THEN** it walks to its host's reception behind any waiting agents and shows a
  completion marker, and inspecting it does not change Herdr state

### Requirement: Pinned Town desks

The user SHALL be able to pin and unpin a Town desk from its agent window's
menu. A pin SHALL be a World view setting saved on the World service with the
terminal colours, keyed by the desk's tab, so every device sees it; it SHALL NOT
change Herdr and SHALL be separate from Spaces' browser-local tab pins. A pinned
desk SHALL show a pin and keep its cell in its room through tab reorders,
capacity steps and rebuilt scenes; the room SHALL grow to hold the cell, and
the other desks SHALL take the free cells in tab order. A pinned desk SHALL NOT
be picked up for a drag, nor be a reorder target, until unpinned. An agent at
a pinned desk SHALL NOT go to the lounge: it SHALL leave its seat only for
reception, when blocked or done and not yet checked, and SHALL return to its
seat once checked or answered. A pin SHALL follow its tab to another workspace
and SHALL be dropped when its tab closes. When a room has more desks than Town
presents, its pinned desks and the selected desk, with their agents, SHALL
still be presented, even past the bound, and other desks SHALL be omitted
instead; only pins beyond the 127 desks a room can draw MAY go undrawn.

#### Scenario: A pinned agent finishes and is seen

- **WHEN** an agent at a pinned desk finishes and the user checks it
- **THEN** it waits at reception until checked and then walks back to its seat,
  never to the lounge

#### Scenario: A pinned desk in a crowded room

- **WHEN** a room's tabs exceed Town's desk bound and more of its tabs are
  pinned than the bound, with another desk selected
- **THEN** every pinned desk, the selected desk and their agents stay
  presented, and only unpinned desks are omitted

#### Scenario: A room reflows around a pinned desk

- **WHEN** tabs are added or reordered in a room with a pinned desk
- **THEN** the pinned desk keeps its cell and the other desks fill the free
  cells in tab order

### Requirement: Town attention rail

Town SHALL present the agents that need the user in the same order as Desk
attention triage: blocked agents oldest first, then done agents newest first. On
desktop the list SHALL be a left rail grouped by host and then room, with
collapsible host groups, and the user SHALL be able to hide it to a count and
restore it; this choice SHALL persist per browser. On phones the list SHALL be a
bottom tray that remains reachable while a peek or card is open. Hovering an
entry SHALL show its card, and activating an entry SHALL open that agent's
window on Chat, where replies go. A keyboard command SHALL open the next agent
that needs the user.
The rail SHALL list a bounded number of entries and count the rest.

#### Scenario: Work through waiting agents on desktop

- **WHEN** three agents in two hosts are blocked and the user presses the next-agent key repeatedly
- **THEN** Town opens each agent's exact pane in age order and the rail
  reflects each answer without reordering unrelated entries

#### Scenario: Hide the rail

- **WHEN** the user hides the desktop rail and reloads Town
- **THEN** the rail stays hidden, shows the waiting count, and can be restored with one action

### Requirement: Town agent peek

Hovering an agent, a reception entry or a rail entry with a pointer SHALL open a
peek after a short delay, and tapping one SHALL open a pinned peek. The peek SHALL
show the agent's name, location and status, its latest message (the question
when it is waiting), answer options only when the pane's latest lines present a
numbered menu or a yes/no prompt, and actions to reply, open the Inspector, open
the terminal from the peek's header and go to the next waiting agent. Tapping an
agent, or the table of an agent away at reception or in the lounge, SHALL open
what the Town opens preference names: the agent's one window, World's
Inspector, on its Chat view (the default), or its terminal; tapping a room SHALL
only zoom to it. Activating an agent or its table, the needs-you list, N and
Next SHALL open the same window on Chat; no separate peek chat window SHALL
exist, and the peek card SHALL only preview an agent on hover. In Town the
Inspector SHALL dock right by default and keep the dock each window was left
with. Its top selector SHALL list Chat, Terminal, Changes and Files (Commits
last) and follow the window's own width: labelled from 640px, icons below, and
below 360px the active view with the others under ⋯. On a phone the Chat view
SHALL show one composer and no terminal key bar. The Town master's chat, named
by a setting, SHALL open docked on Chat once per visit on wide screens without
focusing its pane. A table SHALL stand for its agent that needs the user (waiting, then
finished) before the agent seated there. An agent opened this way, with either
preference, SHALL walk back to its desk and stay there until its status
changes, after which its status places it again; the tap SHALL NOT mark its
completion reviewed. Tapping and dragging SHALL stay separate gestures:
a tap never starts a move and a drag never opens a peek.

Peek keyboard shortcuts SHALL apply only while keyboard focus is in the Town
scene or in the peek; pointer hover alone SHALL NOT capture keys. In that context,
digit keys SHALL choose the corresponding answer. Town SHALL NOT capture keys while a terminal, search field or other editable
control has focus, during IME composition, or with Ctrl, Alt or Meta held, and a
hover peek SHALL NOT change the keyboard target. Answers
and replies SHALL be sent only to the exact qualified pane through the existing
input path. If the target closes, moves away or its runtime generation retires,
the peek SHALL close or show it as unavailable and SHALL NOT send input elsewhere.
Opening the terminal from a peek SHALL follow the Inspector presentation preference.

#### Scenario: Answer from a hover

- **WHEN** the user hovers a waiting agent whose pane exposes a permission choice and clicks Yes
- **THEN** exactly that pane receives the answer, the agent becomes working, and
  no other pane receives input

#### Scenario: A terminal has focus while another agent is hovered

- **WHEN** agent A's terminal has keyboard focus and the pointer hovers agent B so
  that B's peek opens, and the user types digits and letters
- **THEN** every key reaches only A's terminal and no answer is sent to B

#### Scenario: The target retires during a reply

- **WHEN** the peeked pane closes or its runtime generation retires before the reply is sent
- **THEN** World rejects the reply and does not redirect it to another pane, tab or host

#### Scenario: Tap the table of an agent waiting at reception

- **WHEN** Town opens Chat and the user taps the table of an agent that is
  waiting at reception
- **THEN** that agent's window opens on Chat, the agent walks back to its desk,
  and no terminal or peek card opens

#### Scenario: Town opens Terminal

- **WHEN** the user sets Town opens to Terminal and taps the table of a
  finished agent waiting at reception
- **THEN** that agent's terminal opens, no peek opens, the agent walks back to
  its desk, and its completion is not marked reviewed

#### Scenario: No recognizable choice is on screen

- **WHEN** a blocked agent's latest lines contain neither a numbered menu nor a
  yes/no prompt
- **THEN** the peek offers Reply and the terminal without answer buttons

### Requirement: Town peeks show recent chatter and take replies

An agent's peek SHALL show the agent's latest message from the conversation
read model that the Inspector's Chat reads (`agent_conversation.latest` for the
exact qualified pane), rendered as Chat renders it, and SHALL reread it when the
service reports the conversation changed, sharing Chat's watch rather than
polling. It SHALL NOT show terminal
screen text as the message; when the conversation is unavailable it SHALL show
Chat's reason. A waiting agent's question, read from the pane's latest lines,
SHALL be set apart below the message, with its answers as one-tap buttons. The
peek is a read-only preview: it SHALL have no reply line and no attachments of
its own, and its Open chat (Follow up for a finished agent) SHALL open the
agent's window on Chat. The peek's Open terminal action SHALL open the pane's
full terminal. Attaching files in the phone composer, Spaces or Chat SHALL show
one chip per file: uploading with byte progress where the
transport reports it, then done or failed, with Retry and Remove for a failed
file; picking a failed file again SHALL retry it. Send SHALL wait for uploads,
and a file picked again while it uploads SHALL NOT be uploaded twice. A path
whose upload finishes after its composer closed SHALL be kept for that pane and
join the draft of the next composer opened for it; a chip SHALL NOT show done
for a path that can no longer reach a draft. The peek's Inspector action SHALL open World's Inspector
on the agent's Files view, from which Changes and History are one tap away,
using the same path as the shell's Actions menu. Answers and replies SHALL be
sent only to the exact qualified pane, and the result SHALL be confirmed by a
short notice; a finished agent SHALL announce itself once.

#### Scenario: Reply from the peek

- **WHEN** the user chooses Open chat in an agent's peek
- **THEN** the agent's window opens on Chat, where the reply is written; the
  peek offers no reply line or attachments of its own

#### Scenario: The peek renders the latest message

- **WHEN** an agent's latest message contains a Markdown table
- **THEN** the peek shows a table, not the message's pipes

#### Scenario: An upload fails

- **WHEN** a file attached in a composer fails to upload
- **THEN** its chip says it failed and why, Retry uploads it again, and Send is
  not blocked by the failed file

#### Scenario: Open the Inspector from a peek

- **WHEN** the user taps Inspector in an agent's peek
- **THEN** World's Inspector opens on that agent's Files view

### Requirement: Town desk and agent moves

Town SHALL let the user move a desk to the next free spot of another room of
the same host and move an agent pane to another desk of the same host, by
dragging with a mouse, by holding and then dragging on touch, and from the
keyboard by pressing M on a focused desk or agent target, which opens a list of
destinations. Town SHALL NOT add visible move controls to the scene. While a
drag is in progress Town SHALL show where the desk or agent would land, or why
it cannot, and holding the carried desk or agent near the edge of the usable
view SHALL scroll the town toward that edge, so rooms out of view can be
reached. A picked-up desk or agent SHALL lift off and follow the pointer;
every move Herdr confirms, within a room or to another room, SHALL land on its
target with a puff of dust, and a refused move SHALL return to where it was.
Under reduced motion or calm motion the carried desk or agent SHALL stay under
the pointer, and every drag SHALL end with a short fade, without bounce, shake
or dust. A request SHALL be qualified by connection ID and runtime generation,
SHALL run in the World service, and SHALL be refused across hosts, for retired
generations, or when the runtime cannot export a tab's layout. Before sending
any move, a desk move SHALL capture the source tab's complete split tree with
`layout.export`, including each split's direction and ratio, and SHALL refuse
the move without mutation if any source pane is missing or the tree does not
account for every pane. Because Herdr closes a workspace when its last tab
leaves, moving a room's last desk, or the only pane of a room's last desk, SHALL
ask the user to confirm that the room will close before anything moves. It SHALL
then move the captured tree's first pane to a new tab in the target workspace and
replay the captured tree by moving each remaining pane into that tab with its
captured direction and ratio, confirming each step from Herdr before the next.

Because a move can replace a pane's operational ID, World SHALL record each
confirmed replacement from `pane.moved` and SHALL address every later split
target, rollback step and Town target by the current ID, including any further
replacement during rollback. If a step fails, World SHALL move the already-moved
panes back into the original tab using their current IDs and report the outcome.
It SHALL NOT retry an uncertain step, and if rollback fails it SHALL report the
actual resulting topology.

Town SHALL let the user reorder a desk within its room the same ways: dropping
it on another desk of its room puts it in that desk's slot, as a tab dragged
onto another in Spaces, and dropping it on the room's free spot puts it last of
the drawn desks, so in a room with more tabs than it draws the desk takes the
last drawn desk's place and stays in view. Only a seated agent stands for its
desk's slot; a drop on an agent in the lounge, at reception or walking SHALL
NOT reorder. The keyboard list SHALL offer the same places before other rooms. A reorder SHALL read the
workspace's tab order from Herdr and send one Herdr `tab.move` through the same
browser path as Spaces' tab strip, qualified by the desk's connection ID and
runtime generation. Town SHALL NOT keep an order of its own: desks SHALL move
when Herdr's new order is observed, and a refused reorder SHALL leave every desk
in place and say why; on a Herdr without `tab.move`, Town SHALL say so in plain
words before sending anything. The World service SHALL subscribe to Herdr's
`tab.moved` event where Herdr supports `tab.move`, so a reorder made anywhere
refreshes every view; when it cannot yet tell whether Herdr does, it SHALL retry
the subscription rather than subscribe without `tab.moved`. Agents keep their desk across a reorder: a seated agent moves with
its desk, an agent walking to it or sitting down walks to the new slot, and agents at reception
or in the lounge return to the same desk.

An agent move SHALL be a single confirmed pane move into the target tab. The
service SHALL read the destination tab's complete layout, including panes Town
does not draw, and join the pane next to its last pane, splitting across the
table when the tab has an odd number of panes and beside it otherwise, with its
replacement ID recorded. Moves on one connection SHALL run one at a time, each
reading the topology, including the last-desk check, only when it starts.
Rollback SHALL be reported as complete only when every captured pane is found
back in the original tab; an unreadable topology, a retired runtime or a failed
compensation SHALL be reported as an incomplete move, and the runtime SHALL be
checked before every compensating move. When panes were moved back, World SHALL
report that the desk's pane layout may differ, because Herdr cannot always
rebuild the original split tree. While a move is pending, Town SHALL reserve the source
and target spots; the final placement SHALL follow confirmed Herdr topology.

#### Scenario: Move a desk to another room

- **WHEN** the user drags a three-pane desk onto another room of the same host
- **THEN** World captures the desk's split tree before moving anything, moves the
  three panes into one new tab in that workspace with the same split directions
  and ratios, shows the desk at the target spot after Herdr confirms, and the
  agents keep their agent identities while Town follows each replacement pane ID

#### Scenario: A moved pane receives a new ID

- **WHEN** Herdr confirms the first pane of a desk move with a different `pane_id`
  than its `previous_pane_id`
- **THEN** World addresses the next split and any rollback by the new ID, and
  Town's seat, peek and terminal targets for that agent use the new ID

#### Scenario: A source pane disappears before the move

- **WHEN** a pane of the selected desk closes between the user's drop and the
  capture of the split tree
- **THEN** World sends no pane move, the desk stays in place, and the user sees
  that the move could not start

#### Scenario: A desk move fails part-way

- **WHEN** Herdr rejects the second pane move of a three-pane desk
- **THEN** World moves the first pane back into the original tab by its current
  ID, Town returns
  the desk to its original spot, and the user sees that the move failed

#### Scenario: Drop on another host

- **WHEN** the user drops a desk over another host's building
- **THEN** no Herdr operation is sent, the desk returns to its spot, and Town
  explains that desks move only within one host

#### Scenario: Move a room's last desk

- **WHEN** the user drops the only desk of a room onto another room of the same host
- **THEN** Town asks to confirm that the room will close, and moves the desk only
  after the user confirms

#### Scenario: Reorder a desk in its room

- **WHEN** the user drags the room's first desk onto its third desk
- **THEN** World sends one `tab.move` for that tab on the desk's own connection
  and runtime generation, and after Herdr reports the new order the desk sits in
  the third slot and the second and third desks sit one slot earlier

#### Scenario: Move an agent to another desk

- **WHEN** the user drags an agent onto another desk in the same host
- **THEN** World moves exactly that pane into the target tab and the agent sits at
  the chosen seat after Herdr confirms

### Requirement: Town agent identity

Town SHALL derive an agent's identity from its connection profile and the agent
session identity reported to Herdr when present, and otherwise from its qualified
pane. Its appearance SHALL be a deterministic function of that identity. The agent
profile SHALL show only figures backed by authoritative state or an optional
provider and SHALL identify figures that are unavailable.

#### Scenario: An agent's pane moves

- **WHEN** an agent with a reported session identity moves to another desk
- **THEN** it keeps the same appearance and profile identity

#### Scenario: No session identity is reported

- **WHEN** an agent pane reports no session identity
- **THEN** Town uses the qualified pane identity and does not merge it with another agent

### Requirement: Room project signals

A room status card SHALL reserve a line for project signals, such as open pull
requests, the latest deployment and spend, supplied by optional providers mapped
to that workspace. Town SHALL omit the line when no provider supplies values and
SHALL convey a failed deployment with text as well as colour.

#### Scenario: Provider supplies deployment status

- **WHEN** a configured provider reports a failed deployment for a workspace
- **THEN** that room's card shows the failure in text and colour and its room card details show the same value

#### Scenario: No project provider

- **WHEN** no provider supplies project signals for a workspace
- **THEN** its room card shows no project line and no placeholder values

### Requirement: Town targets, motion and phone layout

Town SHALL provide keyboard- and pointer-accessible semantic targets for
buildings, rooms, desks, seats, agents, reception entries and rail entries, with
names that include status text. Compact targets inside desks and the reception
SHALL be at least 24 by 24 CSS pixels and other targets at least 48 by 48. Every
gesture SHALL have a visible control. Town SHALL honour reduced-motion
preferences and offer a calm setting that removes ambient motion and shortens
camera moves. On phones, Town SHALL keep one vertical navigation direction,
open peeks as a sheet above the tray, and close the peek, card and terminal
through the shared system Back behaviour. Town SHALL keep the established input
acknowledgement budgets at the dense fixtures and at three hosts with eight rooms,
fifteen desks per room and four panes per desk.

#### Scenario: Navigate Town by keyboard

- **WHEN** a keyboard user moves through Town targets
- **THEN** each building, room, desk, seat and agent is reachable with a name that
  includes its status, and activating it performs the same action as a pointer

#### Scenario: Use Town on a phone

- **WHEN** the user opens Town at a 390 px width
- **THEN** buildings are stacked vertically, room cards and the reception board are
  readable, the tray stays at the bottom, and Back closes an open peek before leaving Town

#### Scenario: Maximum observed scale

- **WHEN** three hosts present eight rooms each with fifteen desks of four panes
- **THEN** Town renders every room and keeps terminal input acknowledgement within the established budgets

### Requirement: Board view

World SHALL offer a Board view next to Town in the view switcher and the phone
navigation. Board SHALL present each presented host as a labelled zone, each
admitted Herdr workspace of that host as a workspace card inside its zone, each
admitted tab as a tab card near its workspace, and the user's notes. Every
admitted tab and pane SHALL remain reachable. A tab with several panes SHALL show
a row per pane, each with its own status, selectable and openable on its own, up
to four rows with an exact count and a chooser for the rest. A tab's status SHALL
be its most urgent agent pane's; plain terminal panes SHALL NOT colour it. A tab
whose panes are all plain terminals SHALL be drawn as a terminal without a status
pulse. Board position SHALL NOT change an entity's
authoritative host, workspace, tab or pane ancestry. A host whose topology is
cached after failure SHALL be visibly stale and its cards SHALL be
non-actionable. Town SHALL be unaffected.

A workspace card SHALL count its agents by status and its shells. The user MAY
give any workspace or tab card a colour from a fixed palette, saved with the
board; a tab card SHALL show its terminal colour (see Terminal colour), so a tab
without its own colour takes its workspace's, then its default. A card's colour
SHALL never stand for or hide a status: status keeps its own colours on the dot,
ring, badge and overview squares. From an actionable workspace card the user MAY
open a plain terminal tab or start an agent in a new tab without a note, and
from a live host's label MAY open World's New workspace dialog.

#### Scenario: Open Board

- **WHEN** the user chooses Board with two hosts that expose workspaces and tabs
- **THEN** each host appears as a zone with its workspace cards, and each workspace's tabs appear around it with their status

#### Scenario: A tab with an agent and a shell

- **WHEN** a tab holds an agent that needs the user and an idle shell
- **THEN** its card shows both panes as rows and is marked as needing the user, and tapping the shell row selects the shell

#### Scenario: Colour a workspace

- **WHEN** the user selects a workspace and picks teal
- **THEN** the workspace and its tabs without their own colour are tinted teal on every device, and each tab still shows its status colour

#### Scenario: Stale host

- **WHEN** a host's topology is cached after a failure
- **THEN** its zone and cards are shown as stale and offer no actions

### Requirement: Terminal colour

Every Herdr tab SHALL have one terminal colour from a fixed palette, shown as
its tab in Spaces, its card in Board and, when Town draws a table for it, that
table; a tab beyond a room's drawn tables keeps its colour in Spaces and Board.
Without a choice of its own a tab SHALL take its workspace's Board colour, if
any, or else a default derived only from its connection and Herdr tab ID, so it
is the same on every device and after reloads. A colour chosen in any view
SHALL be saved by the World service, keyed by connection and Herdr tab ID (as
Board keys a tab card, qualified when the tab ID is also a workspace ID),
SHALL appear in every view and on every device, and MAY be reset; reset is
offered only for a tab's own colour, not one inherited from its workspace. The
key carries no terminal witness, so after a Herdr restart a colour follows
whichever tab holds that ID. A tab World moves to another workspace SHALL keep
the colour it showed, whether chosen, inherited or default, saved as its own
colour. When World observes
Herdr close a tab on the connection's current runtime, it SHALL drop that tab's
saved colour. Terminal colour SHALL never stand for or hide a status. World
SHALL NOT write a colour to Herdr.

A terminal's colour SHALL be shown, and offered for change, beside its name in
the terminal's header (the window header on desktop, the app bar on a phone)
and in the terminal window's menu, as well as in the Spaces tab menu, the Town
peek and Board. Every picker SHALL be the same palette with **Default colour**,
opened as a transient layer.

#### Scenario: Colour a tab in Spaces

- **WHEN** the user picks pink from a tab's menu in Spaces
- **THEN** the tab's strip in Spaces, its table in Town and its card in Board show pink on every device

#### Scenario: Colour a terminal from its header

- **WHEN** the user opens the colour swatch beside a terminal's name and picks green
- **THEN** the terminal shows green in its header, Spaces, Town and Board, and the picker closes

#### Scenario: Reset a tab's colour

- **WHEN** the user chooses Default colour for a tab with a chosen colour
- **THEN** every view shows the tab's default colour again

#### Scenario: Move a desk without a chosen colour

- **WHEN** the user moves a desk whose tab shows its default colour to another room
- **THEN** the tab, under its new Herdr tab ID, shows the same colour in every view

### Requirement: Transient layers close top first

Menus, popovers, pickers and lists opened over a terminal or view SHALL form one
last-in, first-out stack. Escape and Back SHALL close only the top layer, one
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

### Requirement: Board placement and movement

Board SHALL keep cards where the user places them. Each tab SHALL keep its
position relative to its workspace and each workspace relative to its host, so
moving a workspace moves its tabs with it. While the user drags, cards SHALL
respond elastically; within about one second after the interaction ends the
board SHALL come to rest and SHALL NOT move again until the user acts or the
topology changes. Card movement SHALL NOT be a setting. Layout SHALL NOT depend
on zoom.

New tabs, unfolded tabs and new notes SHALL be placed in free space near their
workspace or the requested point without displacing other cards. Folding a
workspace SHALL gather its tabs into it and show their count; unfolding SHALL
place them into free space. Tidy SHALL rearrange the selected workspace's tabs,
or the whole board when nothing is selected, and SHALL offer an undo that
restores the previous positions. A pinned card SHALL keep its board position and
SHALL NOT follow its workspace.

#### Scenario: Pin a card

- **WHEN** the user pins a selected card from its bar (on a phone, from its
  terminal's header) and then tidies its workspace
- **THEN** the card shows a pin badge and keeps its position while the other
  cards are rearranged, and unpinning it lets it belong where it is beside its
  workspace again

#### Scenario: Drag a workspace

- **WHEN** the user drags a workspace card and releases it
- **THEN** its unpinned tabs follow and keep their arrangement around it, and the board is still within about one second

#### Scenario: Unfold into free space

- **WHEN** the user unfolds a workspace whose neighbours are close by
- **THEN** its tabs appear in free space around it and no other card moves

#### Scenario: Undo tidy

- **WHEN** the user tidies the board and chooses Undo
- **THEN** every card returns to its position before the tidy

### Requirement: Board moves between workspaces

Dragging a tab card over another workspace card of the same host SHALL mark
that workspace as the drop target, and dropping it there SHALL ask "Move the
tab to <workspace>?" with an option not to be asked again. The move SHALL use
World's qualified service move, the same as Town's, and strings to the moved
tab and its panes SHALL follow the move result. Moving a workspace's last tab
SHALL always ask, whatever the option says, and SHALL say that the workspace
will close. A tab SHALL NOT be dropped on another host.

#### Scenario: Move a terminal

- **WHEN** the user drags a terminal's tab onto another workspace of its host and confirms
- **THEN** the tab moves there with its panes still running, and notes strung to its panes stay attached

#### Scenario: Last tab

- **WHEN** the user drops a workspace's only tab onto another workspace, even with "Don't ask again" chosen
- **THEN** Board asks first and says the workspace will close

### Requirement: Board semantic zoom

Board SHALL zoom with the mouse wheel around the pointer, with pinch on touch
screens and with visible zoom controls, and SHALL fit everything on request.
Below an overview threshold Board SHALL hide tab cards and show each pane as a
square on its workspace card, filled in its status colour for an agent and
hollow for a plain terminal, with workspace, note and host labels
enlarged so they remain readable; above it the tab cards SHALL return. Strings
to a hidden tab SHALL attach to its workspace.

#### Scenario: Zoom out to the overview

- **WHEN** the user zooms out past the overview threshold
- **THEN** tab cards fade out, each workspace shows a status square per tab, and no card changes position

### Requirement: Board status pulses

Each tab card SHALL show its status (working, needs you, finished but not
checked, idle, no signal) by colour and badge. By default a tab whose agent is
working, and the selected tab, SHALL pulse; idle, finished, waiting and
no-signal tabs SHALL stay still, with needs you marked by its border and badge.
Pulses SHALL be switchable from the view's ⋯ menu and SHALL stop under reduced
motion; status SHALL remain visible by colour and badge without them.

#### Scenario: Turn pulses off

- **WHEN** the user turns Status pulses off in the ⋯ menu
- **THEN** no card pulses and each tab's status is still shown by its colour and badge

### Requirement: Board detail panel

Selecting a workspace, a tab or one of its panes on Board SHALL open World's
shared Inspector for that exact entity, with the same Terminal, Files, Changes
and Agent History tabs, docking and phone presentation as the other views,
rather than a Board-specific panel. Answers to a waiting agent SHALL go through
that Inspector's terminal and composer to the exact pane, qualified by
connection and runtime generation. In the overview, a tap on a workspace SHALL
centre it and zoom in instead of selecting it.

#### Scenario: Open a pane's detail

- **WHEN** the user taps the row of one pane in a tab with several panes
- **THEN** World's shared Inspector opens for that pane, with its Terminal, Files, Changes and Agent History

### Requirement: Board notes and strings

The user SHALL be able to create a note by double-click or double-tap on empty
board or from a card, and edit, colour and delete it. Notes SHALL belong to the whole board. The user SHALL be able to
string a note or card to another card by dragging from a card's handle or with
String to…, and to cut a string from the string itself or from the panel.
Dragging a handle onto empty board SHALL create a note strung to that card.
Stringing to a tab with more than one pane SHALL ask which pane; a single-pane
tab SHALL select its pane. A string to a tab or workspace SHALL be context only.

A note strung to an agent's pane SHALL offer to send the note to that agent.
The note text SHALL be delivered as a prompt to that exact pane only when the
user chooses Send, and only after World revalidates that the string is
attached on the current runtime generation and that the agent the note was
strung to is present on that pane; otherwise Send SHALL be refused with its
reason.

When a note is strung to a pane, the browser SHALL tell the service which agent
it showed there (its kind and Herdr session), and the service SHALL record that
agent as the string's recipient (kind, hashed session and foreground process
group) only if its own read of the pane finds the same kind and session. A
string whose agent could not be confirmed that way (no session shown, a
replacement before the read, no answer) SHALL stay unbound. Only the service
SHALL set a recipient, qualified by the anchor's connection, pane and terminal;
a re-witnessed anchor (after Herdr restarts) SHALL drop it. At Send the service SHALL compare the pane's agent
with the recipient: they are the same agent when their kinds match and their
sessions match, or, when either has no session, their process groups match.
Another agent in the same pane and terminal, or a string whose recipient was
never recorded, SHALL be refused with that agent named, and the note SHALL go
to it only when the user confirms that agent; the confirmed agent becomes the
string's recipient. Herdr cannot hold a pane between a check and the prompt, so
the service SHALL read the pane's agent again after the prompt and report a
change as possibly delivered to another agent, never as sent. A note SHALL offer to
start a new agent in a chosen workspace, which creates a tab, starts the agent
in it, waits within a bound for the agent to become interactive, then prompts
it with the note and strings the note to it. A timeout SHALL be reported as
uncertain without sending the note; a failure at any step SHALL be reported
with what was created; no step SHALL be retried automatically. Agent replies or results MAY be
shown on the note when they are reported; World SHALL NOT invent them.

#### Scenario: Send a note

- **WHEN** a note is strung to an agent's pane and the user chooses Send
- **THEN** the agent in that pane receives the note text as a prompt, and nothing is sent to any other pane

#### Scenario: Another agent in the same pane

- **WHEN** a note was strung to agent A, A exits and agent B starts in the same shell, keeping the pane and terminal, and the user chooses Send
- **THEN** nothing is sent; World says B is now in that pane and offers to send to B, and sends to B only if the user chooses that

#### Scenario: The agent changes during Send

- **WHEN** the pane's agent is replaced between the service's last check and the prompt
- **THEN** World reports that the note may have reached another agent and does not report it as sent

#### Scenario: String to a tab with two agents

- **WHEN** the user drags a note's string onto a tab with two agent panes
- **THEN** World asks which pane, and the string attaches to the chosen pane

#### Scenario: A new agent is slow to start

- **WHEN** the user starts an agent from a note and it is not interactive within the bound
- **THEN** World reports that the agent may still be starting and that the note was not sent, and offers Send

#### Scenario: Cut a string

- **WHEN** the user selects a string and chooses Cut string
- **THEN** the string is removed and the note and card stay where they are

### Requirement: Board persistence and identity

The World service SHALL persist board layout, pins, folds, notes and strings as
one board document, with every Herdr anchor qualified by its connection profile,
bounded in size, written atomically and revisioned, and SHALL broadcast changes
to other open clients. An open Board SHALL apply layout changes saved by other
clients; while it has a local drag or save in progress its own save follows and
replaces the layout (last writer wins). An edit to a note based on an outdated
revision of that note SHALL be rejected with the current board rather than
overwrite newer content; a note being edited SHALL keep its draft and the
revision editing started from, and a draft that cannot be saved (the note
changed or was deleted elsewhere) SHALL stay available, across view switches and
reloads in that browser, until the user saves it over the note, saves it as a
new note, or discards it. When the browser cannot store it, Board SHALL say the
draft lasts only in that tab. Authenticated World clients of the service MAY receive board content;
note text SHALL go to Herdr or an agent only on the user's explicit Send.

Strings SHALL be anchored to the connection profile and the Herdr workspace,
tab or pane ID. Labels, directories and agent kinds SHALL NOT decide identity;
renames and agent start or stop SHALL NOT detach a string. With each anchor the
store SHALL keep the terminal IDs last observed in its target as a continuity
witness. An anchor SHALL be:

- attached when its target exists on the current runtime generation and at
  least one witnessed terminal ID is still present in it, or, for a workspace
  or tab that held no terminals when strung or kept, while it exists (weak
  evidence, acceptable because such anchors never authorise Send); a pane
  anchor always needs a matching witnessed terminal;
- unresolved, keeping its saved anchor, while its host is connecting, offline,
  stale or filtered or its target is outside the admitted topology;
- unconfirmed when its host is current and its ID exists but no witnessed
  terminal ID survives, until the user keeps or detaches it;
- detached into a "Needs a home" tray only on authoritative absence: a close
  observed on the current generation, or a qualified get on the current
  generation answering not found. The detach SHALL apply only if the string
  still names the checked target, so a reply about an ID the string no longer
  uses (after a move) changes nothing.

While an anchor is attached on a current host, Board SHALL keep its witness in
step with the target's present terminals, so continuity survives panes opening
and closing. Only attached strings SHALL be actionable, and Send SHALL be
offered only for a current, actionable pane. At Send the service SHALL check
that the saved board still strings that note to that pane and that the note is
the revision the user sent, and SHALL send the saved text. Unresolved and
unconfirmed strings SHALL be drawn as such with their reason, at the target's
last known position or its host's zone when the target is not on the board. A
pane or tab anchor SHALL follow a pane or tab moved by World, from any view or
client, through the move result, rewritten by the service. After a move that
failed or rolled back, the service SHALL reconcile witnessed anchors from the
terminals the outcome positively observed and leave the rest unresolved. Items SHALL NOT be
deleted or re-attached without the user.

Card positions, pins, folds and colours are a layout preference keyed by
connection profile and Herdr ID, not a claim of identity: a new entity that
reuses an ID inherits that arrangement, while strings keep the continuity rules
above.

#### Scenario: World restarts while Herdr keeps running

- **WHEN** World restarts and its first observation of a host has no children yet
- **THEN** that host's strings are unresolved, and when the host's topology arrives with the same terminals they are attached again without any prompt

#### Scenario: A host disconnects

- **WHEN** a host goes offline
- **THEN** its notes stay where they are, their strings are drawn as unresolved, Send is disabled, and nothing moves to Needs a home

#### Scenario: Herdr restarts

- **WHEN** Herdr restarts and its workspaces, tabs and panes return with the same IDs but new terminals
- **THEN** the host shows one prompt listing the affected notes, and nothing is sent to those panes until the user keeps them

#### Scenario: A new session reuses IDs with identical names

- **WHEN** a new Herdr session reuses a workspace ID with the same label, directory and agent kind
- **THEN** the strings to it are unconfirmed rather than attached, because no witnessed terminal survives

#### Scenario: A renamed tab

- **WHEN** the user renames a tab that a note is strung to
- **THEN** the string stays attached

#### Scenario: A closed tab

- **WHEN** a tab that a note is strung to closes while its host is observed
- **THEN** the note stays on the board and its string moves to Needs a home

#### Scenario: A string to an empty workspace

- **WHEN** the user strings a note to a workspace with no tabs, and later opens a tab in it
- **THEN** the string is attached throughout, and the new tab's terminal becomes its witness

#### Scenario: A move made in another view

- **WHEN** a note is strung to a pane and the user moves that agent to another desk in Town
- **THEN** the service rewrites the string to the pane's new ID, and Board shows it attached to the moved pane

#### Scenario: Phone and desktop

- **WHEN** the user adds a note on the desktop while the board is open on a phone
- **THEN** the phone shows the note without a reload

### Requirement: Board on phones

On phones Board SHALL present the same board with hosts stacked vertically.
One finger SHALL drag a card or pan empty board, pinch SHALL zoom, double-tap on
empty board SHALL create a note, and tapping a card SHALL select it and centre it
above the panel.

#### Scenario: Phone board

- **WHEN** the user opens Board on a 390 px wide screen
- **THEN** the hosts' zones are stacked, cards can be dragged directly, and selecting a card opens the bottom sheet with the card visible above it

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
managed profiles and admitted runtime snapshots. Each managed connection SHALL be a host root,
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

### Requirement: Shared Inspector drawer

Town and Board SHALL provide one consistent shell-owned Inspector surface that can appear as
the one docked overlay or as a movable desktop window. Every Inspector SHALL
identify its qualified entity with a compact icon, name and bounded status or read-only-host cue and
SHALL give its primary area to immediately visible applicable Terminal, Files, Changes and Agent
History tabs. Identity and resources SHALL share one lifecycle, header and close control rather than
stack a separate agent profile card above the resource pane. Terminal SHALL be the first tab and the
initial tab for a newly opened terminal-capable entity; changing one Inspector's active tab SHALL NOT
change another Inspector or the default for a later entity.

Selecting an actionable entity in Town or Board SHALL follow the persisted Inspector opening
preference for newly opened entities and SHALL focus an existing entity in its current presentation.
The common workspace navigator and focused tab strip SHALL always admit the matching entity into
the docked Inspector, independently of that preference. Docked admission SHALL replace and
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

- **WHEN** the user selects an actionable space or non-agent terminal pane in Town or Board
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

### Requirement: Terminal window maximize and resize controls

Every terminal window presented in Town or Board SHALL provide accessible maximize and resize controls, including floating, docked, and temporarily arranged windows. Maximize SHALL temporarily expand the selected window over the available stage while preserving its current arrangement participants. It SHALL save the complete prior presentation and geometry, including dock or arrangement placement, so the window's Restore control returns it to that state. Resizing SHALL update the selected window's usable dimensions without changing its terminal or conversation ownership. If global Restore positions is invoked while a window is maximized, it SHALL restore the captured arrangement baseline and clear the maximize snapshot so a later window Restore cannot reinstate stale placement.

#### Scenario: Maximize and restore a floating terminal
- **WHEN** a user maximizes a floating terminal window in Board and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior size and position when restored

#### Scenario: Maximize and restore a docked terminal
- **WHEN** a user maximizes a docked terminal window in Town and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior dock and size

#### Scenario: Maximize and restore an arranged terminal
- **WHEN** a user maximizes one terminal window in an arrangement and then restores it
- **THEN** it returns to its prior arranged placement while the other arrangement participants retain their geometry

#### Scenario: Restore arrangement positions while a window is maximized
- **WHEN** a user invokes Restore positions while an arranged terminal window is maximized
- **THEN** participants return to their captured baseline presentation and geometry, and a later window Restore does not restore the superseded maximized snapshot

#### Scenario: Resize any terminal window
- **WHEN** a user resizes a floating, docked, or arranged terminal window
- **THEN** the selected window changes size and its terminal remains attached to the same conversation

#### Scenario: Use window controls without a pointer
- **WHEN** a user navigates to maximize or resize controls with a keyboard or assistive technology
- **THEN** each control has an accessible name and can be operated without pointer precision

### Requirement: Fit and restore terminal window arrangements

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. They SHALL shrink windows evenly below their normal floating minimum when needed, then scroll horizontally for Columns or vertically for Rows at the usable tiled minimum. They SHALL mount only nearby windows and terminal presentations, and focusing an offscreen window SHALL scroll it into view. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile every eligible window in a count-based rectangular layout. Its column count SHALL be the smaller of the ceiling of the square root of the window count and the number of usable-width tiles that fit the stage; additional rows SHALL scroll vertically at no less than the usable tiled minimum height. Six SHALL form a 3×2 grid and sixteen a 4×4 grid when those shapes fit the stage, without floating overflow layers. Grid SHALL mount only nearby window shells and terminal presentations; focusing an offscreen window SHALL scroll it into view. Cascade SHALL use the normal viewport-fitted default floating-window size, shrinking all windows equally only when needed to fit its diagonal offsets, and SHALL keep older title regions visible behind newer windows. When a further offset would make a window smaller than its usable minimum, Cascade SHALL repeat the diagonal in another vertically scrollable stage, mount only nearby presentations, and scroll an offscreen focused window into view. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, with balanced stage insets at supported UI scales and reachable title, close and dock controls. Scrollable visual arrangements SHALL expose a visible scrollbar on the applicable axis and clip their Inspector windows at the available stage, so offscreen windows cannot cover shell controls or receive pointer input beyond the stage. A tiled window SHALL retain its usable compact minimum during explicit resize. An option that cannot fit every eligible window at usable width SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an eligible window set, World SHALL capture its previous presentation and each window's available prior geometry, including the Spaces Single state or an Inspector's dock state. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance, changing the current active tab/pane or moving an instance that has never participated. Restoring Spaces' original Single presentation SHALL show its currently active tab unless that workspace remains suspended by Close all terminal windows. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable window and preserve desktop arrangement positions for return to desktop. A runtime-generation change SHALL remove only that runtime's retired windows from the arrangement and restore snapshot; other participants SHALL remain recoverable. A host filter change SHALL preserve the arrangement and restore snapshot. Spaces and visual views SHALL retain their respective window placement while inactive without arranging each other's hidden windows. Spaces SHALL keep tab-window placement separate for each focused workspace and SHALL detach the old workspace's terminal presentations when focus changes to another workspace.

Maximize SHALL temporarily present a window over the available stage while preserving its other arrangement participants. It SHALL capture the complete prior presentation context and geometry, including dock placement, arrangement membership, tile geometry and order. The window's Restore control SHALL return it to that captured presentation. If Restore positions is invoked while a window is maximized, all still-open participants SHALL return to the captured arrangement baseline and the maximize snapshot SHALL be cleared; an individual Restore action SHALL NOT reapply superseded geometry.

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

- **WHEN** an Town or Board arrangement has more windows than fit on screen
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

- **WHEN** an Town or Board Grid, Columns, Rows or Cascade arrangement extends beyond its visible stage
- **THEN** a visible scrollbar moves along the overflowing axis, and Inspector portions outside the stage are clipped and cannot intercept controls outside that stage

#### Scenario: Requested layout cannot fit

- **WHEN** the available stage cannot hold a requested placement at usable dimensions
- **THEN** that placement explains its unavailability and invoking it leaves all current window geometry unchanged

#### Scenario: Return from a compact viewport

- **WHEN** a desktop arrangement is viewed at a compact width and then at desktop width again
- **THEN** compact mode shows its one active usable tab or Inspector and the prior desktop arrangement remains recoverable without an offscreen title or duplicated terminal

#### Scenario: Return from Spaces to a visual view

- **WHEN** the user arranges existing tabs in Spaces and then returns to Town or Board
- **THEN** the visual Inspectors retain their own placement, the hidden Spaces windows release their terminal presentations, and returning to Spaces recovers its tab arrangement within the current stage unless that workspace was suspended by Close all terminal windows

#### Scenario: Switch the focused Spaces workspace

- **WHEN** tabs in workspace A are arranged and the user focuses workspace B in Spaces
- **THEN** no tab window from A remains visible or attached in B, and returning to A recovers its arrangement if those tabs still exist in the current runtime generation, unless A was suspended by Close all terminal windows

#### Scenario: Switch host after arranging

- **WHEN** one runtime generation changes with arranged Inspectors open on several hosts
- **THEN** only that runtime's retired conversations are removed, Restore cannot reopen them for a
  replacement generation, and other hosts retain their placement and restore history

#### Scenario: Maximize and restore a docked Inspector

- **WHEN** a user maximizes a docked Inspector and then activates its Restore control
- **THEN** the Inspector returns to its prior dock and geometry without losing its resource state or terminal ownership

#### Scenario: Maximize and restore an arranged Inspector

- **WHEN** a user maximizes an Inspector in a multiwindow arrangement and then activates its Restore control
- **THEN** it returns to its captured tile geometry and order while the other participants retain their placement

#### Scenario: Restore arrangement positions while maximized

- **WHEN** a user invokes Restore positions while an arranged Inspector is maximized
- **THEN** every still-open participant returns to its captured arrangement baseline and a later per-window Restore does not reinstate superseded geometry

### Requirement: Live terminal conversations across views

Town and Board SHALL open qualified agents, occupied desks and terminal nodes in live
Inspector conversations backed by the shell's existing resource and terminal/session owners.
Selecting the same qualified entity through another representation SHALL focus its existing
Inspector instead of creating a competing resource context or terminal attachment. Every open
conversation SHALL belong to its own admitted managed connection and current runtime generation;
conversations on several hosts SHALL be usable concurrently.
World SHALL use the current Roamgate-derived terminal, Files, Changes and Agent History components
and existing bridge connection; it SHALL NOT carry or synchronize replacement implementations from
Herdr Web. Retained World window code MAY provide presentation around the complete Inspector
without owning resource or terminal transport.

Activating an agent or terminal in Town or Board SHALL open or focus that entity's Inspector on its
Terminal tab in the presentation selected by the Inspector opening preference, preserving direct terminal access without creating
a terminal-only window. The same qualified terminal SHALL have exactly one live Terminal presentation at a time.
Docking, undocking or swapping Inspectors SHALL explicitly hand off that attachment after the old
target detaches while preserving the Inspector's selected tab and other resource state.

If ordinary selection replaces a docked Inspector, World SHALL close the outgoing docked
conversation before mounting the replacement context and SHALL NOT create a floating window in
Docked mode. Single arrangement SHALL follow this same admission rule: it SHALL NOT keep the
outgoing docked Inspector hidden, consume an extra window slot or restore that closed
conversation later. Floating conversations SHALL arise only from an explicit Dock out action
or a new Town or Board entity activation while Floating mode is selected. Other retained floating
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
filters or navigating among Town and Board SHALL NOT detach, redirect or duplicate
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

#### Scenario: Open a terminal from a Town desk

- **WHEN** a user activates an actionable occupied or terminal desk in Town
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
  Town or Board is active
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
- **THEN** Town and Board preserve the conversation and its view-local geometry, visible
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

### Requirement: Town in the World shell

Town SHALL be a World view with its own route and entries in the shell's view switcher and phone
navigation. Town SHALL render inside the shared World shell and SHALL NOT add a second application
top bar. Its attention rail SHALL live inside the Town view and be hideable there. Town search,
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

### Requirement: Qualified History presentation and explicit Codex linking

History SHALL offer Chat and Timeline over the same bounded loaded transcript.
Chat SHALL pair tool calls with their results and offer a conversation minimap
without implying older records have been fetched. Switching presentation SHALL
retain the selected runtime and pane lease.

A manual Codex session link SHALL require a full session UUID, readable metadata
from the selected runtime, a preview and explicit confirmation. The one-shot
preview SHALL expire after five minutes and bind the pane terminal, foreground
process/group, existing session and transcript identity. Confirmation SHALL reject
changed witnesses or runtime authority before reporting the link, then verify
Herdr retained it. Remote lookup SHALL NOT fall back to local transcripts.
The external runtime does not offer an atomic process-and-link operation; this
contract does not exclude a process change during the final report RPC.

#### Scenario: A pane changes after preview

- **WHEN** the captured runtime, terminal, foreground Codex process, existing
  session or transcript identity changes before confirmation
- **THEN** the link is refused and a fresh preview is required

#### Scenario: Nested Inspector navigation and transient UI

- **WHEN** terminal screen, Composer panel, Inspector navigation and a menu are open
- **THEN** successive system Back actions close menu, navigation, panel and screen
  before returning to the prior route
