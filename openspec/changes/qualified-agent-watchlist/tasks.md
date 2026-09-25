## 1. Define and expose shared watch state

- [ ] 1.1 Add a pure service registry keyed by connection ID, generation and terminal-backed World ID, capped at 128 records with bounded labels; verify duplicate Pin, 128th/129th Pin, exact Unpin and agent↔terminal classification cases.
- [ ] 1.2 Add `world.watchlist.list/pin/unpin` as bridge-global methods in `server/src/index.ts`. Validate pin against the named ready runtime and exact live pane, reject unknown/stale targets without default-host fallback, and allow exact Unpin of an unavailable record. Verify no Herdr mutation or disk/browser persistence is introduced.
- [ ] 1.3 Retire records for a replaced connection generation, broadcast `world_watchlist_changed` with a process-local revision after each real mutation, and return revisioned List data. Verify simultaneous browsers, duplicate mutations and reconnect do not resurrect an older list.

## 2. Consume and present pins

- [ ] 2.1 Add a focused browser watchlist store that fetches List on bridge connection and change invalidation, ignores older replies/revisions within a connection, invalidates old requests/revisions on reconnect, and marks cached state unverified while disconnected. Verify a second browser observes Pin/Unpin without manually refreshing and a restarted service's empty revision-zero list replaces old state.
- [ ] 2.2 Resolve each record through current `WorldObject` before an action; verify a missing/stale pane is visibly unavailable and equal native IDs on another host or generation never resolve the pin.
- [ ] 2.3 Add accessible Pin/Unpin controls to the common selected-entity context of Office, Tree and Graph, with capacity and disconnected feedback. Verify mouse, keyboard, touch and compact operation use the same service mutation.
- [ ] 2.4 Add a shared Pinned only toggle alongside common visual search; verify it follows view navigation and selected-host switching, filters only the selected host, and does not change Spaces focus or the underlying all-host observation.
- [ ] 2.5 Filter Tree/Graph leaves while retaining full host/space ancestry, and Office leaves while retaining room/desk anchors. Verify search, disclosure, mixed-state tabs, Graph position pins, existing view bounds, and displayed/observed/omitted counts remain truthful.

## 3. Accept and deliver the workflow

- [ ] 3.1 Exercise two browser clients and two ready hosts with colliding native IDs, page reload, service restart, host switch, disconnect, missing pane and generation replacement in focused service/store and mounted-browser checks. Verify no watched action rebinds or routes to another host.
- [ ] 3.2 Update Features and affected source map for the shared process lifetime, add an Unreleased entry, and distinguish watch pins from workspace and Graph position pins in labels and documentation.
- [ ] 3.3 Synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect final diff/history for generated output and sensitive data, then open a ready PR with exact evidence for independent review.
