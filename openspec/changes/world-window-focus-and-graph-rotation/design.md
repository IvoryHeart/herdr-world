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

- Implement maximize as a reversible window presentation state using the same stage bounds and prior geometry as move and resize. Keep resize available on each window presentation; do not create a second terminal owner when geometry changes.
- Treat focus as the source of front-to-back ordering for all visible windows. Arrangement presets set geometry, while later focus updates stacking independently.
- Have both menus dispatch the same close-all action over the active view's existing arrangement set, independent of entity selection: focused-workspace tabs in Spaces and visible Inspector conversations in Office, Tree, and Graph. Dismiss World windows and detach their terminal presentations while leaving Herdr tabs, panes, processes, and sessions untouched.
- Rotate Graph positions around the current graph center in quarter-turn steps. Apply the inverse transform to label rendering so text remains upright. Keep rotation state in Graph presentation preferences alongside the existing camera/layout state, and expose directional controls next to Fit and Arrange.

## Risks / Trade-offs

- **Maximize can obscure other windows** → preserve the prior geometry and make restore available on the maximized window.
- **Stacking changes can interfere with drag or terminal focus** → raise on window focus and preserve the active pointer interaction and terminal attachment.
- **Rotating coordinates can move nodes outside the viewport** → keep Fit available and retain the user's rotation when fitting the graph.

## Migration Plan

No server or Herdr migration is required. Existing saved window geometry and Graph preferences remain readable; new presentation state uses compatible defaults when absent.
