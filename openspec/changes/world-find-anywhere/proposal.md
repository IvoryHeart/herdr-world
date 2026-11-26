## Why

Cmd+K found agents only in Town, Board and Desk, and choosing one only selected
it there. Spaces listed just its own connection's agents, so an agent on
another machine or on herdr-core could not be found and opened from one place
(#1329).

## What Changes

- The command box's **In World** group lists World's agents, rooms, tables and
  terminals on every connected runtime and machine, in every view, Spaces
  and the phone's Find or act included. Spaces' connection-only Agents group
  goes.
- Search matches name, room, table, machine, runtime, harness, status word and
  task summary, in the same search the views use.
- A row shows the agent's icon in its tab colour, its name and place, a runtime
  icon and its status mark.
- Opening a result shows its terminal in Spaces on its own connection, whichever
  runtime runs it: a Herdr TUI node with its tab and pane focused; a herdr-core
  terminal shown in Spaces' terminal area through World's watch of it. Offline,
  stale or reconnecting nodes stay listed and marked, and opening one says why.
- In Town, Board and Desk choosing a result goes to it there and opening is a
  second action (#1355, change `world-one-search`).

## Impact

- `web/src/world/worldCommandBox.tsx`, `web/src/world/worldSearch.ts`,
  `web/src/components/CommandCombobox.tsx`, `web/src/world/WorldFoundationApp.tsx`,
  `web/src/App.tsx`, `web/src/world/useWorldVisualActions.tsx`,
  `web/src/world/SpacesCoreTerminal.tsx`, `web/src/world/spacesCore.ts`.
- Help entry `world.command-box`; shell-navigation and terminal-windows notes.
- No new persisted data; no server change. Agent identity stays the qualified
  pane target behind `worldFoundTarget` until #1309.
