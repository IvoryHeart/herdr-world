# Watchlist notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town/Board shell Actions provide Pin, Unpin and browser-local Pinned only.
- Search and bounded presentation prioritize watches without changing operational authority.
- Shared pins survive browser/service restart and can be removed while unavailable.
- TUI/core watches require the same current source bindings; these are separate from desk pin labels.

**Code:**

- `server/src/world/watchlist.ts`
- `server/src/storage/terminal-marks.ts`
- `web/src/world/watchlistStore.ts`
- `web/src/world/visualRouteActions.ts`

**Tests:**

- `server/src/world/watchlist.test.ts`
- `web/src/world/watchlistStore.test.ts`
- `web/src/world/visualRouteActions.test.ts`

**Pitfalls:**

- A watch is observational and cannot authorize input, files or mutations.
- Unpin captures watch_id; an old tuple must not delete a replacement watch.
- Complete current absence clears a pin; failure/cached absence cannot.
- The 128-watch bound and per-view leaf bounds are different limits.
- Board/Town CLI layout pins are not this qualified pane watchlist.

## Usage reference

- **Agent interest.** The button beside an agent's name in its Inspector
  header in Town, Board and Spaces (or **⋯ → Attention** in mobile windows) sets **Default (from groups)**, explicit
  **Watch**, **Muted** or **Focused**, saved by the World service for its terminal on
  every device. Chimes
  read it: a muted agent never chimes, and while a focused agent is reachable
  only focused agents and the Town master's needs-you chime (Watching then
  says it is quiet). A focus on an offline host silences no one until the host
  is back. Interest never hides
  anything from reception. An explicit agent choice wins; otherwise Group Focus
  beats Group Mute, with Default contributing no claim. Focus combines currently
  reachable effective-focused agents and Group members. Hover explains the source
  and any overridden group claim. Team/Pod controls live in Groups; v1 hides them
  on Room/Desk. Group preferences survive away members and are removed atomically
  with deletion. Individual interest follows the terminal through moves, and goes
  when its host shows the terminal has closed, including after reconnecting.
  A failed save shows an error and keeps the previous choice; reopen the
  button to retry.
