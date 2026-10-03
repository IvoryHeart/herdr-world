## Context

See [proposal.md](proposal.md) for the user outcome. Office terminal presentation already supports floating geometry and window focus callbacks, and Graph exposes Fit and Arrange in its toolbar. The changes belong to browser presentation; Herdr continues to own terminal and pane state.

## Goals / Non-Goals

**Goals:**

- Reuse the existing window geometry and focus behavior so controls work across window presentations.
- Keep Graph rotation in the presentation layer and preserve readable labels.

**Non-Goals:**

- Changing terminal ownership, Herdr layouts, Graph topology, or service APIs.
- Adding automatic rotation or changing the existing Fit and Arrange behavior.

## Decisions

- Implement maximize as a reversible window presentation state using the same stage bounds and prior geometry as move and resize. Snapshot the complete presentation context, including dock or tile placement. Global Restore positions returns windows to the arrangement baseline and clears maximize snapshots. Keep resize available on each window presentation; do not create a second terminal owner when geometry changes.
- Treat focus as the source of front-to-back ordering for all visible windows. Arrangement presets set geometry, while later focus updates stacking independently.
- Have both menus dispatch the same close-all action over the active view's existing arrangement set, independent of entity selection. In Spaces, persist a workspace-scoped suspended-presentation state across navigation; explicitly selecting a tab resumes only that tab in Single, and choosing an arrangement resumes all eligible tabs in that layout. Close all ends the prior multiwindow arrangement but preserves per-tab geometry. In Office, Tree, and Graph, close every open Inspector conversation, including ones retained but hidden by Single or compact layout. In every view, detach World presentations while leaving Herdr tabs, panes, processes, and sessions untouched.
- Rotate Graph positions around the current graph center in quarter-turn steps. Apply the inverse transform to label rendering so text remains upright. Keep rotation state in Graph presentation preferences alongside the existing camera/layout state, and expose directional controls next to Fit and Arrange.
- Admit distinct floating Inspectors without a five-window presentation cap; preserve exact connection and runtime identity and the one-docked-Inspector rule. Grid uses at most the ceiling of the square root of the eligible window count, capped by the number of usable-width tiles that fit the stage. Add rows at the usable tiled minimum when the count exceeds the visible height, and scroll vertically. Keep the established two-window and three-window arrangements. Reject Grid only if even one usable-width column cannot fit; leave current geometry unchanged when unavailable. Mount window shells and terminal portals only near visible rows, while preserving every eligible window in arrangement state so offscreen focus, close-all, and Restore remain correct. This supports six as three by two and sixteen as four by four without layering overflow windows.
- Keep Columns and Rows tiles at their usable minimum when count exceeds the viewport and scroll along the tile axis. Extend the same nearby-window mounting, focus scrolling, and arrangement geometry bounds used for Grid to both layouts.
- Keep Cascade's existing diagonal while it fits one stage. Once another offset would reduce width or height below the window minimum, repeat that diagonal in another vertically scrollable stage; preserve each group's reachable title offsets and virtualize distant groups.
- Clip fixed-position visual Inspector windows to the measured arrangement stage during scrolling. Keep the scrollbar visible above Inspector windows so offstage window portions neither paint over shell controls nor intercept their input.
- Open all walks actionable leaves of the selected host and admits at most one Inspector per terminal tab. Existing Inspectors retain their conversation state; the resulting set uses scrollable Grid when usable so a large host does not mount every terminal presentation at once. Spaces keeps its workspace-specific presentation rule, so this host-wide action is available in visual views.

## Risks / Trade-offs

- **Maximize can obscure other windows** → preserve the prior geometry and make restore available on the maximized window.
- **Stacking changes can interfere with drag or terminal focus** → raise on window focus and preserve the active pointer interaction and terminal attachment.
- **Rotating coordinates can move nodes outside the viewport** → keep Fit available and retain the user's rotation when fitting the graph.
- **A suspended Spaces workspace leaves an empty stage** → keep its open tabs visible in the tab controls and provide explicit selection and arrangement actions that resume presentation.

## Migration Plan

No server or Herdr migration is required. Existing saved window geometry and Graph preferences remain readable; new presentation state uses compatible defaults when absent.
