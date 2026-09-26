## ADDED Requirements

### Requirement: Arrange existing terminal windows from the shared tab bar

The shared tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions. On desktop the control SHALL sit at the right edge of the tab bar; on mobile it SHALL appear inside the existing ellipsis-expanded floating controls, including when the tab strip is hidden for one tab. The shared shell Actions command menu SHALL expose the same view-wide arrangement choices and unavailable reasons in every view. Each choice MAY be given a configurable keyboard shortcut, with none assigned by default; invoking an assigned shortcut SHALL follow the same availability and Restore rules without sending terminal input. The shell's existing shortcut defaults and numbered Actions order SHALL remain unchanged. Single SHALL show one active window fitted to the available stage. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. Each visible Spaces tab window SHALL present that tab's Herdr-reported split or zoom layout in Single and multiwindow arrangements, with the tab window owning each pane it presents. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows. If its Terminal resource is selected, it SHALL show an actionable focus affordance for the active tab window without attaching a second terminal or changing the selected resource tab.

In Office, Tree and Graph, an arrangement SHALL include every currently visible Inspector conversation on the selected host, including the docked Inspector and a Tree inline Inspector. It SHALL reposition only conversations that are open when invoked. Single SHALL show the active Inspector while suspending terminal presentations in other conversations that remain open under the existing dock and floating admission rules. In particular, ordinary selection of B while A is docked SHALL still close A before admitting B; Single SHALL NOT retain A as a hidden extra Inspector or change the one-docked-plus-five-floating limit. The visual Inspector limit SHALL NOT cap Spaces' existing tabs. All four views SHALL use the same arrangement choices and geometry rules over their current window sets. Arranging SHALL NOT itself create or close Herdr tabs, panes, terminal sessions, Inspectors or connections, change the selected host or resource tab, or send terminal input. Hidden visual Inspectors SHALL remain hidden and unmodified while Spaces is visible, and hidden Spaces tab windows SHALL remain unmodified in a visual view.

Cascade, Columns, Rows and Grid SHALL be one-time actions on the eligible windows at invocation. A later new tab or Inspector SHALL use its normal opening presentation until another multiwindow arrangement is chosen. Single SHALL follow the active tab or Inspector, including a newly admitted one, while hiding only other windows that remain open under normal selection rules.

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

### Requirement: Fit and restore window arrangements

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. They SHALL shrink windows evenly below their normal floating minimum when needed, while keeping window controls and terminal content usable. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile four and leave the remainder floating above them with reachable headers. Cascade SHALL use the normal viewport-fitted default floating-window size, shrinking all windows equally only when needed to fit its diagonal offsets, and SHALL keep older title regions visible behind newer windows. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, with balanced stage insets at supported UI scales and reachable title, close and dock controls. A tiled window SHALL retain its usable compact minimum during explicit resize. An option that cannot fit every eligible window at usable dimensions SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an eligible window set, World SHALL capture its previous presentation and each window's available prior geometry, including the Spaces Single state or an Inspector's dock/inline state. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance, changing the current active tab/pane or moving an instance that has never participated. Restoring Spaces' original Single presentation SHALL show its currently active tab. A Tree inline return SHALL use its exact leaf if that leaf is still visible, and otherwise use the normal docked overlay. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable window and preserve desktop arrangement positions for return to desktop. A selected-host or runtime-generation change SHALL discard the prior live arrangement and restore snapshot with the retired windows. Spaces and visual views SHALL retain their respective window placement while inactive without arranging each other's hidden windows. Spaces SHALL keep tab-window placement separate for each focused workspace and SHALL detach the old workspace's terminal presentations when focus changes to another workspace.

#### Scenario: Two columns and three rows

- **WHEN** two eligible windows fit Columns, or three fit Rows, and the user chooses that option in any view
- **THEN** they occupy nonoverlapping side-by-side columns or top-to-bottom rows within the available stage

#### Scenario: More than two columns or rows

- **WHEN** three or more eligible windows fit after shrinking evenly to usable compact sizes and the user chooses Columns or Rows
- **THEN** all eligible windows remain in one nonoverlapping row or column with their controls reachable

#### Scenario: Arrange visual Inspectors at a scaled UI

- **WHEN** a user chooses Columns for two visible Inspectors on a wide desktop with increased UI scale
- **THEN** both windows fit within the visual stage with balanced top and bottom spacing and reachable controls

#### Scenario: Three-window and four-window Grid

- **WHEN** three or four eligible windows fit Grid
- **THEN** three use one tall column beside two stacked windows, or four occupy the four corners, with usable terminal content in each

#### Scenario: More than four open windows

- **WHEN** five or more eligible windows are visible and Grid can keep every header reachable
- **THEN** four occupy the corners and the remaining windows stay movable, reachable floating windows above them

#### Scenario: Diagonal Cascade

- **WHEN** two or more eligible windows fit Cascade and the user chooses it
- **THEN** each window has the normal default floating size fitted to the stage, each later window is offset diagonally above the earlier windows, and every title region can be used to raise its window

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
- **THEN** the visual Inspectors retain their own placement, the hidden Spaces windows release their terminal presentations, and returning to Spaces recovers its tab arrangement within the current stage

#### Scenario: Switch the focused Spaces workspace

- **WHEN** tabs in workspace A are arranged and the user focuses workspace B in Spaces
- **THEN** no tab window from A remains visible or attached in B, and returning to A recovers its arrangement if those tabs still exist in the current runtime generation

#### Scenario: Switch host after arranging

- **WHEN** a user switches the selected host or its runtime generation changes with arranged Inspectors open
- **THEN** retired conversations and their restore snapshot cannot reposition or reopen an Inspector for the replacement host or generation

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

## MODIFIED Requirements

### Requirement: Shared live terminal conversations

Office, Tree and Graph SHALL open qualified agents, occupied desks and terminal nodes in live
Inspector conversations backed by the shell's existing resource and terminal/session owners.
Selecting the same qualified entity through another representation SHALL focus its existing
Inspector instead of creating a competing resource context or terminal attachment. Every open
conversation SHALL belong to the one selected operational host and its current runtime generation.
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

Desktop SHALL support up to five floating Inspector conversations alongside the one docked
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
the existing selected-connection browser lease. Opening another window or navigating among Office,
Tree and Graph SHALL NOT detach, redirect or duplicate conversations while that host and generation
remain selected. Selecting Spaces SHALL suspend every visual Inspector presentation so the native
Spaces workspace is unobstructed and SHALL transfer the exact selected terminal presentation only
after its visual owner detaches. The retained visual conversation state SHALL be restored when the
user returns to a visual view. Explicitly activating another host SHALL retire every outgoing visual
and Spaces terminal mount before the replacement becomes operational; World SHALL NOT retain
simultaneous terminal conversations from several hosts in this change. All conversations SHALL use
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

- **WHEN** a user explicitly activates another host while one or more conversations are open
- **THEN** World retires every outgoing conversation before admitting the new selected-host lease
  and never redirects input to a colliding terminal on the replacement host

#### Scenario: Selected conversation host reconnects

- **WHEN** the selected host reconnects while one or more conversations are open
- **THEN** World retires every conversation from the replaced generation and enables a new
  attachment only after the current generation is admitted

#### Scenario: Conversation target temporarily disappears

- **WHEN** a snapshot refresh or reconnect temporarily omits a conversation target
- **THEN** World retains the conversation until current admitted state confirms the qualified pane
  no longer exists

#### Scenario: Desktop conversation limit is reached

- **WHEN** five distinct conversations are open and the user requests a sixth
- **THEN** World keeps the existing floating and docked Inspectors and reports the bounded limit
  visibly

### Requirement: Visual-route Actions

Office, Tree and Graph SHALL expose a common named Actions control for the explicitly selected
space, agent or terminal. The control SHALL be reachable by pointer and keyboard on desktop and
compact layouts, identify the captured host, space and pane as applicable, and offer the
target's existing applicable Terminal, Files, Changes, Agent History and Go to Spaces actions.
It SHALL also expose view-wide window arrangements independently of entity selection. The shell's
right-side Roamgate-derived Actions command menu SHALL retain its original shell commands and add
target actions, Pin, Unpin, Pinned only and arrangements in visual views, without a duplicate
view-toolbar Actions control; the view toolbar SHALL keep search available.
Target actions SHALL reuse the shared Inspector and selected-connection focus path; they SHALL NOT use
hidden Spaces focus, create another terminal owner, send terminal input, assign tasks or control
an agent lifecycle. A missing or unavailable target SHALL explain why no target action can run.

Before dispatch, Actions SHALL validate the captured connection ID, runtime generation, entity
identity and current selected entity against the selected-host projection. Changing selection,
host or generation, or losing the current observation, SHALL invalidate the capture and prevent
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
  selected host or creating a pane

#### Scenario: The capture retires before dispatch

- **WHEN** selection, selected host, runtime generation or observed entity changes while Actions
  is open
- **THEN** World invalidates the capture, reports that target actions are unavailable, and performs no target action
