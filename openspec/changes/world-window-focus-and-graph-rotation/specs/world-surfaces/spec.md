## ADDED Requirements

### Requirement: Consistent terminal window controls

Every terminal window presented in Office SHALL provide accessible maximize and resize controls, including floating, docked, and temporarily arranged windows. Maximize SHALL expand the selected window to the available Office stage and allow the user to restore its prior size and position. Resizing SHALL update the selected window's usable dimensions without changing its terminal or conversation ownership.

#### Scenario: Maximize and restore a floating terminal
- **WHEN** a user maximizes a floating terminal window in Office and then restores it
- **THEN** it fills the available stage while maximized and returns to its prior size and position when restored

#### Scenario: Resize any Office terminal window
- **WHEN** a user resizes a floating, docked, or arranged terminal window
- **THEN** the selected window changes size and its terminal remains attached to the same conversation

#### Scenario: Use window controls without a pointer
- **WHEN** a user navigates to maximize or resize controls with a keyboard or assistive technology
- **THEN** each control has an accessible name and can be operated without pointer precision

### Requirement: Focus determines terminal window stacking

When a terminal window receives focus, World SHALL raise it above every other visible terminal window, regardless of window presentation or arrangement. Subsequent focus SHALL update the stacking order so the most recently focused window is on top.

#### Scenario: Focus a window behind another window
- **WHEN** a user focuses a terminal window that is behind another visible terminal window
- **THEN** the focused window moves above the other windows

#### Scenario: Focus changes after arranging windows
- **WHEN** windows have been arranged and the user focuses a different terminal window
- **THEN** the newly focused window is on top while the other windows retain their current geometry

### Requirement: Close all terminal windows from view menus

The arrangement menu and the shared Actions menu SHALL each offer the same accessible action to close all terminal windows in the active view's arrangement set. In Spaces, that set SHALL be the already open Herdr tabs of the focused workspace. In Office, Tree, and Graph, it SHALL be every currently visible Inspector conversation on the selected host, including docked and Tree inline Inspectors. The action SHALL dismiss those World window presentations without closing Herdr panes or tabs, ending terminal processes or sessions, or changing the selected host. The action SHALL be available independently of visual entity selection.

#### Scenario: Close every presented terminal window
- **WHEN** a user invokes Close all terminal windows from either menu while multiple terminal windows are open
- **THEN** all terminal windows in that view's arrangement set are dismissed and the underlying Herdr tabs, panes, and sessions remain open

#### Scenario: Close the arrangement set for each view
- **WHEN** a user invokes Close all terminal windows in Spaces, Office, Tree, or Graph
- **THEN** the action dismisses the focused workspace's open tab windows in Spaces, or all visible Inspector conversations in Office, Tree, or Graph

#### Scenario: Close all without an entity selection
- **WHEN** no visual entity is selected and terminal windows are open
- **THEN** the user can invoke the same close-all action from either menu

#### Scenario: No terminal windows are open
- **WHEN** a user opens either menu with no terminal windows presented
- **THEN** Close all terminal windows is unavailable or has no effect and does not change the underlying Herdr state

### Requirement: Rotate the Graph arrangement

Graph SHALL provide accessible controls to rotate its arrangement 90 degrees left or right. Each activation SHALL apply one quarter-turn from the current orientation, repeated activations SHALL accumulate in the chosen direction, and labels SHALL remain upright and readable. The rotation controls SHALL be grouped beside the existing Fit and Arrange controls.

#### Scenario: Rotate Graph in either direction
- **WHEN** a user activates Rotate left or Rotate right one or more times
- **THEN** the graph arrangement turns by 90 degrees per activation in that direction, with labels upright

#### Scenario: Reverse or complete a rotation
- **WHEN** a user rotates the Graph four times in one direction, or reverses a prior quarter-turn
- **THEN** the arrangement returns to its original orientation after four turns, or changes by the requested reverse turn

#### Scenario: Operate rotation controls accessibly
- **WHEN** a user reaches a Graph rotation control by keyboard or assistive technology
- **THEN** its direction is identified accessibly and activation rotates the arrangement by one quarter-turn
