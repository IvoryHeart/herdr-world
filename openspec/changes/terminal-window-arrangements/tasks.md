## 1. Make Herdr tab presentation reusable

- [x] 1.1 Add focused regressions for sibling-pane selection from both World selection and in-Inspector terminal focus, one Inspector per qualified tab, preservation of valid workspace/checkout Files state and ordinary Changes mode and selection, rejection of late agent-specific replies, split/close reconciliation and failure on retired host or tab ancestry.
- [x] 1.2 Separate live generation-qualified Inspector tab identity and selected pane context from stable connection/workspace/tab geometry storage. Route Office, Tree, Graph, navigator and in-Inspector sibling selection to the same tab window; test migration from old pane-key geometry and reconnect after a newer tab-key save.
- [x] 1.3 Extract the Spaces split-pane renderer for a specified tab and use it for both multiple Spaces tab windows and World Inspector Terminal views; observe visible tab layouts through bounded, lease-fenced `pane.layout` reads and preserve one attachment per qualified pane during Spaces/World handoffs.
- [x] 1.4 Make the one Spaces Inspector follow the active tab and pane, including tab-strip/window/sibling focus, while retaining valid workspace/checkout Files state and ordinary Changes mode and selection and fencing prior pane/session agent-specific replies. When its Terminal resource is selected, present a Focus tab window action instead of a terminal attachment; the Spaces tab window owns its Herdr split or zoom presentation in Single and multiwindow modes, and the action focuses the selected pane.
- [x] 1.5 Verify split, zoom, resize, pane close, background tab changes, focus/input, and layout reply races with focused and browser tests.

## 2. Arrange eligible windows in every view

- [x] 2.1 Implement and test a pure geometry resolver for Single, Cascade, Columns, Rows and Grid across window counts, stage bounds, window-specific minimum dimensions, deterministic focus order and unavailable reasons.
- [x] 2.2 Add one shell-level arrangement action and restore snapshot over view-specific qualified window sets: already open tabs of the focused workspace in Spaces and currently visible Inspector instances in Office, Tree and Graph. Scope Spaces geometry to its workspace without overwriting saved visual Inspector geometry. Ensure Single follows existing Inspector admission and docked replacement semantics, never revives closed Inspectors on Restore, switches active windows without duplicate terminal attachments, and does not auto-arrange later opens under multiwindow presets.
- [x] 2.3 Include docked and Tree inline Inspectors through temporary free geometry and reversible portal transfer.
- [x] 2.4 Add one accessible layout menu with visual choices to the shared tab bar. Label the one-window choice Single with a single-rectangle icon. Disable multiwindow choices with a reason when fewer than two windows are eligible; preserve one active window on compact layouts.
- [x] 2.5 Verify drag/resize/dock after arranging, Restore, docked A replaced by B during Single, new and closed windows/tabs, stage/viewport changes, connectors, focus and terminal refit without Herdr mutation.

## 3. Accept, document and deliver

- [x] 3.1 Run desktop browser scenarios across Office, Tree, Graph and Spaces for Single and two through six windows, split panes, Spaces Inspector on Terminal during both Single and arranged tabs, sibling focus preserving workspace/checkout resources while fencing agent-specific replies, focused-workspace and selected-host changes, docked/inline return and compact-to-desktop return. Assert one attachment per pane and an actionable Focus tab window control.
- [x] 3.2 Update `FEATURES.md`, the affected World surfaces current spec, the knowledge map if ownership paths move, and the appropriate `CHANGELOG.md` Unreleased entry; preserve unrelated edits.
- [x] 3.3 Run focused checks during development and `bun run check` on the final candidate, inspect diff/history for generated output and sensitive data, obtain independent review, and record verification and actual agent usage in the PR template before a ready PR.
- [x] 3.4 Use `bun run agent:usage` with explicit Codex sessions and PR time boundaries to compare recorded agent roles, token and time boundaries, checks and review repairs with PR #109's process baseline; record any supported delivery-workflow adjustment without adding a new gate.
