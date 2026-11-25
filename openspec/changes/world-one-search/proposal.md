## Why

World had two searches. `/` and Ctrl+F searched the current view with a box
of its own, and choosing a result went to it there. Cmd+K opened the command
box, where choosing an agent opened its terminal in Spaces. The same name
typed in each did different things (#1355, finishing #159).

## What Changes

- One search: the command box. `/`, Ctrl+F (Cmd+F), Ctrl+K (Cmd+K), a view's
  search button and the phone's Find or act all open it. Town, Board and Desk
  keep no search box of their own.
- Its results come from pluggable sources: World's objects (`worldSearch.ts`
  stays the matcher), what only the current view has (Town's landmarks), the
  box's commands and the settings registry. Commands stay their own group.
- Choosing a result goes to it in the current view, as `/` did: Town flies
  to it and Board pans to its card (choosing it again selects it), Desk
  selects it. Where the
  view cannot show it (Spaces, Code, a host the Hosts filter hides) choosing
  opens it, and the row says so.
- Shift+Enter, or the row's Open terminal (Open in Spaces for a room, table
  or host), opens it.
- While the box is open, Town and Board light the matches. After a choice the
  view's toolbar keeps the search with its count; its end button or Escape
  ends it. Closing the box without choosing, or changing view, ends it.
- Desk's lane filter stays separate and is named Filter.

## Impact

- `web/src/world/worldFinder.ts` (new), `web/src/world/worldCommandBox.tsx`,
  `web/src/components/CommandCombobox.tsx`, `web/src/world/WorldFoundationApp.tsx`,
  `web/src/App.tsx`, `web/src/world/WorldViewToolbar.tsx`,
  `web/src/world/viewSearchShortcut.ts`, `web/src/world/town/useTownSearch.ts`,
  `web/src/world/board/useBoardSearch.ts`, `web/src/world/DeskView.tsx`.
- Removed: `web/src/world/WorldSearchResults.tsx`, `web/src/rootFlag.ts`.
- Help entry `world.command-box`; shell-navigation, terminal-windows, Town
  and Desk notes. The `world-find-anywhere` delta now says choosing goes and
  opening is the second action.
- No new persisted data; no server change; the qualified open path is
  unchanged.
