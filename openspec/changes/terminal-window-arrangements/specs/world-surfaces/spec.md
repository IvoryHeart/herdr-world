## ADDED Requirements

### Requirement: Arrange existing terminal windows from the shared tab bar

The desktop tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Single, Cascade, Columns, Rows, Grid and Restore positions. Single SHALL show one active window fitted to the available stage. In Spaces, the eligible terminal windows SHALL be the already open Herdr tabs of the focused workspace, including tabs that Single currently hides; choosing another arrangement SHALL present those tabs together without creating new Herdr tabs, panes or sessions. Selecting a tab or focusing a Spaces terminal window SHALL make that tab active. The one Spaces Inspector SHALL follow only the active tab and selected pane; it SHALL remain a separate resource surface outside the arranged terminal windows.

In Office, Tree and Graph, an arrangement SHALL include every currently visible Inspector conversation on the selected host, including the docked Inspector and a Tree inline Inspector. It SHALL reposition only conversations that are open when invoked. Single SHALL show the active Inspector while keeping the other conversations open for later selection. The visual Inspector limit SHALL NOT cap Spaces' existing tabs. All four views SHALL use the same arrangement choices and geometry rules over their current window sets. Arranging SHALL NOT create or close Herdr tabs, panes, terminal sessions, Inspectors or connections, change the selected host or resource tab, or send terminal input. Hidden visual Inspectors SHALL remain hidden and unmodified while Spaces is visible, and hidden Spaces tab windows SHALL remain unmodified in a visual view.

Cascade, Columns, Rows and Grid SHALL be one-time actions on the eligible windows at invocation. A later new tab or Inspector SHALL use its normal opening presentation until another multiwindow arrangement is chosen. Single SHALL follow the active tab or Inspector, including a newly opened one, while keeping its other windows open and hidden.

#### Scenario: Use Single in Spaces

- **WHEN** Spaces is in its default Single arrangement and the user selects a different open tab
- **THEN** that tab's Herdr pane layout fills the available stage, the prior tab's terminal presentation is suspended, and the one Spaces Inspector follows only the newly active tab and pane

#### Scenario: Arrange existing tabs in Spaces

- **WHEN** the focused workspace has several open Herdr tabs and the user chooses Columns, Rows, Grid or Cascade in Spaces
- **THEN** the eligible tabs appear as separate terminal windows in that arrangement without a new Herdr tab, pane, session or connection, and the Spaces Inspector remains bound to the active tab

#### Scenario: Arrange all visible Inspectors

- **WHEN** two or more Inspectors are visible in Office, Tree or Graph and a user chooses an arrangement
- **THEN** every visible Inspector, including a docked or inline one, participates while its resource tab, selected pane, session and close/dock controls remain available

#### Scenario: Use Single in a visual view

- **WHEN** several Inspectors are open in Office, Tree or Graph and the user chooses Single
- **THEN** the active Inspector fills the available stage, the other conversations remain open without live hidden terminal attachments, and selecting one of them brings that Inspector into Single

#### Scenario: Open another Inspector after arranging

- **WHEN** a user opens another Inspector after arranging the earlier windows
- **THEN** the new Inspector uses its normal opening geometry and the earlier windows do not move until another arrangement is chosen

#### Scenario: Only one eligible window

- **WHEN** a view has one eligible tab or Inspector
- **THEN** Single remains usable and multiwindow choices explain that another eligible window is needed

#### Scenario: Use the arrangement control with a keyboard

- **WHEN** a keyboard user opens the arrangement control, chooses a labelled placement or dismisses it
- **THEN** focus moves predictably among its options and returns to the control or previously focused terminal without sending that navigation as terminal input

### Requirement: Fit and restore window arrangements

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With more than four windows, Grid SHALL tile four and leave the remainder floating above them with reachable headers. Cascade SHALL offset all current windows diagonally in focus order so older title regions remain visible behind newer windows. Each arrangement SHALL use the available stage below the tab bar and outside the visible Spaces Inspector dock, preserve the minimum usable dimensions for its window type, and keep applicable title, close and dock controls reachable. An option that cannot fit every eligible window under these rules SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an eligible window set, World SHALL capture its previous presentation and each window's available prior geometry, including the Spaces Single state or an Inspector's dock/inline state. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance, changing the current active tab/pane or moving an instance that has never participated. Restoring Spaces' original Single presentation SHALL show its currently active tab. A Tree inline return SHALL use its exact leaf if that leaf is still visible, and otherwise use the normal docked overlay. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable window and preserve desktop arrangement positions for return to desktop. A selected-host or runtime-generation change SHALL discard the prior live arrangement and restore snapshot with the retired windows. Spaces and visual views SHALL retain their respective window placement while inactive without arranging each other's hidden windows. Spaces SHALL keep tab-window placement separate for each focused workspace and SHALL detach the old workspace's terminal presentations when focus changes to another workspace.

#### Scenario: Two columns and three rows

- **WHEN** two eligible windows fit Columns, or three fit Rows, and the user chooses that option in any view
- **THEN** they occupy nonoverlapping side-by-side columns or top-to-bottom rows within the available stage

#### Scenario: Three-window and four-window Grid

- **WHEN** three or four eligible windows fit Grid
- **THEN** three use one tall column beside two stacked windows, or four occupy the four corners, with usable terminal content in each

#### Scenario: More than four open windows

- **WHEN** five or more eligible windows are visible and Grid can keep every header reachable
- **THEN** four occupy the corners and the remaining windows stay movable, reachable floating windows above them

#### Scenario: Diagonal Cascade

- **WHEN** two or more eligible windows fit Cascade and the user chooses it
- **THEN** each later window is offset diagonally above the earlier windows and every title region can be used to raise its window

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

An actionable Herdr tab SHALL have at most one World Inspector conversation. Selecting any pane in that tab through Office, Tree, Graph, the common navigator or inside the Inspector's own split Terminal SHALL focus that conversation, select the requested pane within it and show the current Herdr split-pane layout when Terminal is selected. The Inspector identity and window geometry SHALL remain stable as selection moves among sibling panes; its header and pane-specific resources SHALL follow the selected pane, with Agent History available only when that pane has an admitted agent session. A non-terminal space Inspector SHALL remain a separate conversation. If the selected pane closes while sibling panes remain, the Inspector SHALL select a remaining live pane in the same qualified tab; when the tab no longer exists, the conversation SHALL retire.

Resource replies captured for an earlier selected pane SHALL NOT replace the header, Files, Changes or History content of a later selected sibling. Switching panes through any focus path SHALL preserve only resource state that remains valid for the newly selected pane and its current session. In Spaces, the one workspace Inspector SHALL similarly follow the active tab and selected pane rather than retain resources for a previously active tab.

The live Inspector tab-window identity SHALL include connection ID, runtime generation, workspace ID and Herdr tab ID. Persisted Inspector tab-window geometry SHALL use a stable connection/workspace/tab key without runtime generation. Existing pane-key geometry MAY be read as a one-time fallback and migrated to the stable key. After migration and a runtime reconnect, the latest saved Inspector geometry SHALL be restored for that same connection, workspace and tab; the live conversation SHALL still retire on generation change. Spaces arrangement geometry SHALL remain separate and session-local, so arranging a tab in Spaces SHALL NOT overwrite its saved visual Inspector position.

Pane placement, zoom and resize inside an Inspector SHALL follow Herdr's tab layout. Window arrangements SHALL act outside that layout. Every terminal pane SHALL have at most one active browser presentation and attachment across Spaces and visual views, qualified by connection, runtime generation, workspace, tab, pane and terminal identity. Missing, stale or mismatched tab layout data SHALL never attach another pane or show cached layout as actionable current topology.

#### Scenario: Open sibling panes from different World nodes

- **WHEN** two selected World nodes refer to sibling panes in the same Herdr tab
- **THEN** they focus one Inspector window and the selected pane's identity and applicable resources update without a second terminal attachment

#### Scenario: Split a pane in a floating Inspector

- **WHEN** Herdr splits the pane shown by a floating Inspector into two panes in the same tab
- **THEN** the Inspector Terminal shows both panes in Herdr's reported arrangement, and input goes only to the pane the user focuses

#### Scenario: Focus a sibling inside a split Inspector

- **WHEN** pane A and pane B share an Inspector and the user focuses B inside its split Terminal while A's Files, Changes or History request is pending
- **THEN** terminal input and the Inspector's selected-pane header and applicable resources all follow B, and A's late reply cannot replace B's resource content

#### Scenario: Move between Spaces and a split Inspector

- **WHEN** a tab with multiple panes is shown in Spaces and later in its World Inspector, or the reverse
- **THEN** the same Herdr panes and layout remain visible after the handoff and no terminal gains a second live attachment

#### Scenario: Selected pane closes

- **WHEN** the selected Inspector pane closes while another pane remains in its qualified tab
- **THEN** the Inspector stays on that tab, selects a remaining pane and updates its resource tabs without binding to a pane from another tab or host

#### Scenario: An older resource reply arrives after sibling selection

- **WHEN** pane A's Inspector resource request finishes after the user has selected sibling pane B
- **THEN** the Inspector keeps B's identity and applicable resources and does not display A's late result as B's data

#### Scenario: Restore saved geometry after reconnect

- **WHEN** a pane-keyed position was migrated to a tab-keyed position, the user moves that tab window again, and the runtime reconnects
- **THEN** the old live Inspector retires and the reopened tab window uses the latest stable tab-keyed position instead of the older pane-keyed position

#### Scenario: Tab layout becomes stale

- **WHEN** a pane closes, moves to another tab or its host generation changes while an Inspector waits for layout data
- **THEN** an obsolete response is ignored and no pane is attached under an incorrect tab or host
