## Why

A herdr-core agent shown in Spaces could not be chosen from Spaces' navigator,
and there was no way to switch to the host's other core terminals. The navigator
made every herdr-core host's tree inert, because a core host is never
`actionable` for Herdr TUI operations (#1390).

## What Changes

- Spaces' navigator rows on a live herdr-core host choose what Spaces shows. They
  offer no Herdr TUI menus, dragging or workspace creation. A stale host's cached
  tree stays inert.
- While Spaces shows a herdr-core terminal, the tab strip lists that host's live
  terminals from the World object, grouped by World's rooms, labelled with the
  agent name or terminal label, and the open one is marked. Clicking a tab, or the
  previous, next and numbered tab keys, shows that terminal and sends nothing to
  herdr-core. Create and close keys do nothing there.
- The strip follows World live. A terminal that stops leaves it; the open one stays
  as gone. Spaces never moves to another connection or runtime generation.
- On a phone the strip scrolls like the Herdr TUI strip and hides with one tab.
- Herdr TUI hosts are unchanged.

## Impact

- `web/src/world/WorldNavigator.tsx`, `web/src/components/WorkspaceTree.tsx`,
  `web/src/world/spacesCore.ts`, `web/src/world/SpacesCoreStrip.tsx`,
  `web/src/world/WorldFoundationApp.tsx`, `web/src/App.tsx`.
- Shell-navigation notes. No new persisted data; no server or herdr-core change.
