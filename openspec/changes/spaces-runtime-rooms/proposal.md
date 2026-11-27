## Why

Spaces' navigator did not show rooms the way each runtime has them (#1430). A
Herdr TUI room was hard to find next to herdr-core rooms, and a herdr-core room's
tabs, one terminal each, read as rooms of their own. The navigator had no tab
level: it put terminals straight under the room and showed tabs only as numbered
chips. It looked tab names up in the active connection's store, so a host that
was not the active connection lost them. The saved agent layout could also pull
terminals out of their rooms into a separate list. Town, Board and Desk showed
the rooms correctly.

## What Changes

- Spaces' navigator lists each connected runtime's rooms, each room's tabs as rows
  in the runtime's order, and each tab's terminals under it.
- Room and tab names are the ones World publishes and Town shows: a room's World
  label, and a tab named as Town names its desk.
- Each room carries Town's runtime mark (Herdr TUI or herdr-core).
- Choosing an agent or terminal opens it as before. Choosing a tab opens its agent,
  or its first terminal.
- In Spaces the navigator ignores the saved agent layout (Compact, Nested,
  Separate) and drops the repeated per-runtime "Workspaces" heading. A herdr-core
  host shows no empty head.
- No renaming, moving or runtime writes.

## Impact

- `web/src/world/spacesRooms.ts` (new), `web/src/world/WorldNavigator.tsx`,
  `web/src/components/WorkspaceTree.tsx`, `web/src/components/WorkspaceRows.tsx`,
  `web/src/components/WorkspaceTree.css`, `web/src/world/town/TownRuntimeIcon.tsx`.
- Shell-navigation notes. No new persisted data, and no server or runtime change.
