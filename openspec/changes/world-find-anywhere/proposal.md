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
- Enter opens: a Herdr TUI node in Spaces on its own connection with its tab
  and pane focused; a herdr-core terminal in World's window. Offline, stale or
  reconnecting nodes stay listed and marked, and opening one says why.
- Shift+Enter, or the row's button, shows it in the current visual view.

## Impact

- `web/src/world/worldCommandBox.tsx`, `web/src/world/worldSearch.ts`,
  `web/src/components/CommandCombobox.tsx`, `web/src/world/WorldFoundationApp.tsx`,
  `web/src/App.tsx`, `web/src/world/useWorldVisualActions.tsx`.
- Help entry `world.command-box`; shell-navigation and terminal-windows notes.
- No new persisted data; no server change. Agent identity stays the qualified
  pane target behind `worldFoundTarget` until #1309.
