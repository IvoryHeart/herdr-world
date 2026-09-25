## ADDED Requirements

### Requirement: Arrange open Inspector windows from the shared tab bar

The desktop tab bar SHALL offer one keyboard- and pointer-accessible arrangement control with labelled visual choices for Cascade, Columns, Rows, Grid and Restore positions. An arrangement SHALL include every currently visible Inspector conversation on the selected host, including the docked Inspector and a Tree inline Inspector. It SHALL reposition only conversations that are open when invoked. It SHALL NOT create or close tabs, panes, terminal sessions, Inspectors or connections, open background Herdr tabs as windows, change the selected host or resource tab, or send terminal input. Office, Tree and Graph SHALL use the same arrangement state and geometry rules. Spaces SHALL retain its one native terminal surface; while Spaces is visible, hidden World Inspectors SHALL remain hidden and unmodified.

#### Scenario: Arrange all visible Inspectors

- **WHEN** two or more Inspectors are visible in Office, Tree or Graph and a user chooses an arrangement
- **THEN** every visible Inspector, including a docked or inline one, participates while its resource tab, selected pane, session and close/dock controls remain available

#### Scenario: Open another Inspector after arranging

- **WHEN** a user opens another Inspector after arranging the earlier windows
- **THEN** the new Inspector uses its normal opening geometry and the earlier windows do not move until another arrangement is chosen

#### Scenario: No multiwindow presentation in Spaces

- **WHEN** Spaces is active with only its native terminal surface visible
- **THEN** the control has no actionable arrangement and explains why, and a later return to a visual view restores the retained Inspector placement

#### Scenario: Use the arrangement control with a keyboard

- **WHEN** a keyboard user opens the arrangement control, chooses a labelled placement or dismisses it
- **THEN** focus moves predictably among its options and returns to the control or previously focused terminal without sending that navigation as terminal input

### Requirement: Fit and restore window arrangements

Columns SHALL place the current windows side by side, and Rows SHALL place them top to bottom, without overlap. Grid SHALL place two windows side by side, three as one full-height column beside two stacked windows, and four in separate corners. With five or six visible Inspectors, Grid SHALL tile four and leave the most recently focused one or two floating above them. Cascade SHALL offset all current windows diagonally in focus order so older title regions remain visible behind newer windows. Each arrangement SHALL use the available visual stage below the tab bar, preserve the minimum usable Inspector dimensions, and keep the title, close and dock controls reachable. An option that cannot fit SHALL be unavailable with an explanation and SHALL leave current geometry unchanged.

At the first arrangement of an open Inspector instance, World SHALL capture its previous geometry and dock/inline presentation. Restore positions SHALL return every still-open participating instance to that captured presentation and geometry without reopening a closed instance or moving an instance that has never participated. A Tree inline return SHALL use its exact leaf if that leaf is still visible, and otherwise use the normal docked overlay. Explicit drag, resize, dock and close actions SHALL continue to work after arranging. Viewport changes SHALL keep title controls reachable; a compact layout SHALL keep only one active usable Inspector and preserve desktop arrangement positions for return to desktop. A selected-host or runtime-generation change SHALL discard the prior arrangement and restore snapshot with the retired conversations.

#### Scenario: Two columns and three rows

- **WHEN** two eligible Inspectors fit Columns, or three fit Rows, and the user chooses that option
- **THEN** they occupy nonoverlapping side-by-side columns or top-to-bottom rows within the available stage

#### Scenario: Three-window and four-window Grid

- **WHEN** three or four eligible Inspectors fit Grid
- **THEN** three use one tall column beside two stacked windows, or four occupy the four corners, with usable terminal content in each

#### Scenario: More than four open Inspectors

- **WHEN** five or six Inspectors are visible and Grid fits four corner windows
- **THEN** four occupy those corners and the most recently focused one or two remain movable, reachable floating windows above them

#### Scenario: Diagonal Cascade

- **WHEN** two or more Inspectors fit Cascade and the user chooses it
- **THEN** each later window is offset diagonally above the earlier windows and every title region can be used to raise its window

#### Scenario: Requested layout cannot fit

- **WHEN** the available stage cannot hold a requested placement at usable dimensions
- **THEN** that placement explains its unavailability and invoking it leaves all Inspector geometry unchanged

#### Scenario: Restore after arranging a Tree Inspector

- **WHEN** an inline Tree Inspector and floating Inspectors were arranged and the user chooses Restore positions
- **THEN** the Tree Inspector returns to its exact visible leaf when available, or its normal docked overlay, and the still-open floating Inspectors return to their captured geometry without losing resource or terminal state

#### Scenario: Return from a compact viewport

- **WHEN** a desktop arrangement is viewed at a compact width and then at desktop width again
- **THEN** compact mode shows its one active usable Inspector and the prior desktop arrangement remains recoverable without an offscreen title or duplicated terminal

#### Scenario: Switch host after arranging

- **WHEN** a user switches the selected host or its runtime generation changes with arranged Inspectors open
- **THEN** retired conversations and their restore snapshot cannot reposition or reopen an Inspector for the replacement host or generation

### Requirement: Present one Inspector per Herdr tab with its split panes

An actionable Herdr tab SHALL have at most one World Inspector conversation. Selecting any pane in that tab through Office, Tree, Graph or the common navigator SHALL focus that conversation, select the requested pane within it and show the current Herdr split-pane layout when Terminal is selected. The Inspector identity and window geometry SHALL remain stable as selection moves among sibling panes; its header and pane-specific resources SHALL follow the selected pane, with Agent History available only when that pane has an admitted agent session. A non-terminal space Inspector SHALL remain a separate conversation. If the selected pane closes while sibling panes remain, the Inspector SHALL select a remaining live pane in the same qualified tab; when the tab no longer exists, the conversation SHALL retire.

Resource replies captured for an earlier selected pane SHALL NOT replace the header, Files, Changes or History content of a later selected sibling. Switching panes SHALL preserve only resource state that remains valid for the newly selected pane and its current session.

Pane placement, zoom and resize inside an Inspector SHALL follow Herdr's tab layout. Window arrangements SHALL act outside that layout. Every terminal pane SHALL have at most one active browser presentation and attachment across Spaces and visual views, qualified by connection, runtime generation, workspace, tab, pane and terminal identity. Missing, stale or mismatched tab layout data SHALL never attach another pane or show cached layout as actionable current topology.

#### Scenario: Open sibling panes from different World nodes

- **WHEN** two selected World nodes refer to sibling panes in the same Herdr tab
- **THEN** they focus one Inspector window and the selected pane's identity and applicable resources update without a second terminal attachment

#### Scenario: Split a pane in a floating Inspector

- **WHEN** Herdr splits the pane shown by a floating Inspector into two panes in the same tab
- **THEN** the Inspector Terminal shows both panes in Herdr's reported arrangement, and input goes only to the pane the user focuses

#### Scenario: Move between Spaces and a split Inspector

- **WHEN** a tab with multiple panes is shown in Spaces and later in its World Inspector, or the reverse
- **THEN** the same Herdr panes and layout remain visible after the handoff and no terminal gains a second live attachment

#### Scenario: Selected pane closes

- **WHEN** the selected Inspector pane closes while another pane remains in its qualified tab
- **THEN** the Inspector stays on that tab, selects a remaining pane and updates its resource tabs without binding to a pane from another tab or host

#### Scenario: An older resource reply arrives after sibling selection

- **WHEN** pane A's Inspector resource request finishes after the user has selected sibling pane B
- **THEN** the Inspector keeps B's identity and applicable resources and does not display A's late result as B's data

#### Scenario: Tab layout becomes stale

- **WHEN** a pane closes, moves to another tab or its host generation changes while an Inspector waits for layout data
- **THEN** an obsolete response is ignored and no pane is attached under an incorrect tab or host
