# world-identity notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Qualified host, room, desk, pane and agent identities.

**Code:**

- `server/src/storage/world-ids.ts`
- `server/src/world/binding-resolution.test.ts`
- `shared/worldIdentity.ts`
- `server/src/world/world-cli-actor.ts` (shared CLI caller location and verification)
- `server/src/world/world-ledger.ts` (actor snapshots on asks, results and history)
- `server/src/world/world-cli-location.test.ts` (isolated TUI/core move attribution)
- `server/src/herdr-core/ask-caller.ts` (current core tab/room from World topology)
- `server/src/storage/catalog.ts` (existing actor snapshot stores and limits)
- `web/src/world/worldAsks.ts` (ask actor consumer)
- `openspec/changes/world-agent-identity/agent-identity.qnt` (design-stage agent identity model; moves to `quint/` with its adapter)

**Pitfalls:**

- Names are display labels; durable identity is qualified by runtime.
- `herdr-world whoami` shows the caller's current runtime location. Herdr resolves
  an unchanged launch-time pane ID after a move; no process environment edit is
  needed. New asks, results and history use that location, while saved attribution
  remains a snapshot of where the caller was when it acted.
