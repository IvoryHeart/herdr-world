## Why

On desktop, a narrow agent window showed only the active view's chip, which
looked like a view menu but did nothing when clicked. The other views were
hidden in the window's **⋯** actions menu, and the Inspector had a second,
separate **More views** menu for the same list. Choosing a view meant widening
the window until the tabs came back.

## What Changes

- When the Inspector's tabs do not fit (a crowded or narrow desktop window, a
  docked Inspector under 360px, or a phone window), one view menu replaces the
  tabs. Its trigger is drawn as the active view's tab with a small chevron
  (the chevron drops out in the narrowest Columns), and choosing a view there
  shows it at once.
- On desktop the menu lists every view the tab bar would, Commits included; a
  phone window keeps its four primary views.
- The window's **⋯** menu no longer lists the views, and the Inspector's
  **More views** menu is gone: one menu for the views.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/agent-peeks`: the Inspector's top selector folds into one
  view menu, drawn as the active tab, instead of putting the other views
  under **⋯**.

## Impact

- `web/src/components/WorkspaceInspectorHost.tsx`,
  `web/src/components/WorkspaceInspectorViewSelect.tsx` and their CSS.
- `web/src/world/windows/WindowControls.tsx` drops its `views` list.
- Tests: `web/src/components/WorkspaceInspectorViewSelect.test.ts`,
  `web/src/world/WorldTerminalHandoff.browser.tsx`.
