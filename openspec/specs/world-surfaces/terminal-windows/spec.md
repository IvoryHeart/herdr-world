# World terminal windows

## Purpose

Define the user-facing terminal windows contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Exact visual terminal input focus

In Town and Board, activating an Inspector window whose selected resource is Terminal
SHALL focus its terminal input and its selected pane.

#### Scenario: Exact visual terminal input focus acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** Explicitly selecting a pane within that
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
arranged Spaces terminal windows.

#### Scenario: Coordinated window presentation acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** Opening or focusing a window SHALL preserve all
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

#### Scenario: Shared window work area acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** Desktop windows SHALL support accessible movement and resizing from all edges and
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

The shared tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions.

#### Scenario: Arrange existing terminal windows from the shared tab bar acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** On desktop the control SHALL sit at the right edge of the tab bar; on mobile it SHALL appear inside the existing ellipsis-expanded floating controls, including when the tab strip is hidden for one tab. The shared shell Actions command menu SHALL expose the same view-wide arrangement choices and unavailable reasons in every view. Each choice MAY be given a configurable keyboard shortcut, with none assigned by default; invoking an assigned shortcut SHALL follow the same availability and Restore rules without sending terminal input. The shell's existing shortcut defaults and numbered Actions order SHALL remain unchanged. Single SHALL show one active window fitted to the available stage, except while a Spaces workspace is suspended by Close all terminal windows. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. Each visible Spaces tab window SHALL present that tab's Herdr-reported split or zoom layout in Single and multiwindow arrangements, with the tab window owning each pane it presents. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows. If its Terminal resource is selected, it SHALL show an actionable focus affordance for the active tab window without attaching a second terminal or changing the selected resource tab.

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

### Requirement: Terminal window maximize and resize controls

Every terminal window presented in Town or Board SHALL provide accessible maximize and resize controls, including floating, docked, and temporarily arranged windows.

#### Scenario: Terminal window maximize and resize controls acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** Maximize SHALL temporarily expand the selected window over the available stage while preserving its current arrangement participants. It SHALL save the complete prior presentation and geometry, including dock or arrangement placement, so the window's Restore control returns it to that state. Resizing SHALL update the selected window's usable dimensions without changing its terminal or conversation ownership. If global Restore positions is invoked while a window is maximized, it SHALL restore the captured arrangement baseline and clear the maximize snapshot so a later window Restore cannot reinstate stale placement.

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

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap.

#### Scenario: Fit and restore terminal window arrangements acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** They SHALL shrink windows evenly below their normal floating minimum when needed, then scroll horizontally for Columns or vertically for Rows at the usable tiled minimum. They SHALL mount only nearby windows and terminal presentations, and focusing an offscreen window SHALL scroll it into view. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile every eligible window in a count-based rectangular layout. Its column count SHALL be the smaller of the ceiling of the square root of the window count and the number of usable-width tiles that fit the stage; additional rows SHALL scroll vertically at no less than the usable tiled minimum height. Six SHALL form a 3×2 grid and sixteen a 4×4 grid when those shapes fit the stage, without floating overflow layers. Grid SHALL mount only nearby window shells and terminal presentations; focusing an offscreen window SHALL scroll it into view. Cascade SHALL use the normal viewport-fitted default floating-window size, shrinking all windows equally only when needed to fit its diagonal offsets, and SHALL keep older title regions visible behind newer windows. When a further offset would make a window smaller than its usable minimum, Cascade SHALL repeat the diagonal in another vertically scrollable stage, mount only nearby presentations, and scroll an offscreen focused window into view. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, with balanced stage insets at supported UI scales and reachable title, close and dock controls. Scrollable visual arrangements SHALL expose a visible scrollbar on the applicable axis and clip their Inspector windows at the available stage, so offscreen windows cannot cover shell controls or receive pointer input beyond the stage. A tiled window SHALL retain its usable compact minimum during explicit resize. An option that cannot fit every eligible window at usable width SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

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

#### Scenario: Live terminal conversations across views acceptance rules

- **WHEN** World opens, focuses, arranges or transfers terminal presentations
- **THEN** Selecting the same qualified entity through another representation SHALL focus its existing
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
