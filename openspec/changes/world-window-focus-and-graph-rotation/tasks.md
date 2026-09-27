## 1. Terminal window controls and focus order

- [x] 1.1 Add maximize and restore behavior to Office terminal windows and verify floating, docked, and arranged presentation contexts are restored.
- [x] 1.2 Ensure resize and maximize controls are available and accessible on each Office window presentation; verify geometry changes preserve terminal ownership.
- [x] 1.3 Raise the latest focused window across floating, docked, and arranged windows; verify focus changes do not alter geometry.
- [x] 1.4 Add the same close-all terminal-window action to the arrangement and Actions menus; verify Spaces suspension, tab/arrangement reopen behavior, and persistence across navigation without closing Herdr tabs, panes, or sessions.
- [x] 1.5 Close every visual Inspector conversation, including retained conversations hidden by Single or compact layout; verify none reappear after changing arrangement or returning to desktop.
- [x] 1.6 Verify Restore positions cancels a maximized window snapshot and restores the captured arrangement baseline.

## 2. Graph rotation

- [x] 2.1 Add left and right quarter-turn transforms to Graph and verify repeated and reversed rotations, including upright labels.
- [x] 2.2 Add accessible rotation controls beside Fit and Arrange; verify direction labels and keyboard activation.

## 3. Integration and documentation

- [x] 3.1 Add focused and browser coverage for maximize restoration, focus stacking, close-all and reopen transitions, and Graph rotation; verify all four requested behaviors and terminal-session preservation.
- [x] 3.2 Update the current `world-surfaces` specification and the appropriate Unreleased changelog entry; verify OpenSpec validation and inspect the final diff.

## 4. Inspector count and scalable Grid

- [x] 4.1 Remove the five-floating-Inspector admission limit across opening and Dock out; verify a sixth Inspector retains independent identity and close behavior.
- [x] 4.2 Tile all eligible Grid windows in count-based rows and columns, including six as 3×2 and sixteen as 4×4; scroll additional rows at a usable minimum and keep unavailable layouts from changing current geometry.
- [x] 4.3 Mount only nearby Grid windows and terminal portals, and scroll an offscreen focused window into view; verify large-count behavior in focused and browser coverage.
- [x] 4.4 Update the World contract and changelog for the revised count and Grid behavior; verify focused tests and OpenSpec validation.

## 5. Scrollable Columns and Rows and host-wide Open all

- [x] 5.1 Scroll Columns horizontally and Rows vertically at the usable tiled minimum in Spaces and visual views; virtualize offscreen presentations and scroll focused windows into view.
- [x] 5.2 Add Open all terminal windows to Arrange and Actions for every actionable terminal tab on the selected host, preserving existing Inspector conversations and Herdr sessions.
- [x] 5.3 Cover large layouts and Open all in focused and browser tests, update current and delta contracts and changelog, and verify the branch through the tracked push hook.

## 6. Repeating Cascade

- [x] 6.1 Repeat the reachable Cascade diagonal in scrollable stages when another offset would violate window minimums, in Spaces and visual views.
- [x] 6.2 Cover large Cascade geometry and browser scrolling, update current and delta contracts and changelog, and verify through the tracked push hook.

## 7. Stage clipping for visual scrolling

- [x] 7.1 Clip scrolled visual Inspector windows to their measured stage and make overflow scrollbars visible, without clipping maximized or normally floating windows.
- [x] 7.2 Add horizontal and vertical scroll hit-testing regressions, update current and delta contracts and changelog, and verify through the tracked push hook.

## 8. Reachable visual arrangement scrolling

- [x] 8.1 Place visible, accessible scroll controls near the arranged Inspector windows for horizontal Columns and vertical Rows, Grid and Cascade; keep them synchronized with focus scrolling and the existing stage clipping.
- [x] 8.2 Cover direct scroll-control interaction and Cascade control placement in browser tests, and update the current and delta contracts and changelog.
