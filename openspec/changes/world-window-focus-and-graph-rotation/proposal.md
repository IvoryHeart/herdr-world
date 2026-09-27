## Why

Office terminal windows do not expose the same maximize and resize controls in every presentation, and a recently focused window can remain behind another window. Graph users can fit or rearrange the layout but cannot turn it to suit their workspace.

## What Changes

- Provide maximize and resize controls consistently on all Office terminal windows, including floating windows.
- Raise the latest focused terminal window above every other window, regardless of whether it is floating, docked, or arranged.
- Add left and right 90-degree Graph rotation controls beside Fit and Arrange; repeated turns accumulate, labels stay readable, and controls remain grouped.
- Add a close-all window action to both the arrangement menu and Actions menu, closing the active view's arrangement set without closing or killing the underlying Herdr terminals, panes, or sessions.
- Remove the five-floating-Inspector admission cap and tile every eligible Grid window in a count-based layout. Preserve usable tile sizes with vertical scrolling and mount only nearby terminal presentations for large sets.
- Scroll Columns horizontally and Rows vertically after their tiles reach the usable minimum, with nearby-window mounting and focus scrolling.
- Repeat Cascade diagonals in scrollable stages once a further offset would make windows too small.
- Add Open all terminal windows for the selected host in the Arrange and Actions menus, admitting one Inspector per terminal tab without changing Herdr sessions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: define consistent terminal window controls, focus-based stacking, view-menu close-all behavior, and quarter-turn Graph rotation.

## Impact

Browser presentation in Office and the Graph toolbar/layout; the existing `world-surfaces` contract and its focused and browser-level UI coverage. No service API or Herdr runtime behavior changes.
