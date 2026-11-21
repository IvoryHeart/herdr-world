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
