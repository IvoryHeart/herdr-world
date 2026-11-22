# Shell Navigation notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- View picker and canonical /town, /board, /desk, /spaces routes reach the four views.
- The shared navigator, tab strip, Hosts filter, Actions and Find or act work across views.
- Phone navigation, Zen, Back, transient menus and mobile shell commands share that frame.
- TUI/core use the same shell; unsupported target actions explain their runtime capability.

**Code:**

- `web/src/world/WorldFoundationApp.tsx`
- `web/src/world/visualRouteActions.ts`
- `web/src/world/worldSearch.ts`
- `web/src/layerStack.ts`

**Tests:**

- `web/src/world/WorldFoundationApp.test.ts`
- `web/src/world/visualRouteActions.test.ts`
- `web/src/world/worldSearch.test.ts`
- `web/src/systemBack.browser.tsx`

**Pitfalls:**

- The Hosts filter is not the operational connection selector.
- Actions capture the explicit entity; hidden Spaces focus must never supply a target.
- Retired Office/Graph/Tree routes redirect without creating a Back loop.
- No shell-navigation CLI exists; connection CLI ownership is in runtime-federation.
