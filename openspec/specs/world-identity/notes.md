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
- `server/src/world/ask-delivery-types.ts` (stable question ownership versus exact recipient authority)
- `server/src/world/world-cli-asks.ts`, `server/src/world/ask-recipient.ts`, `server/src/world/answer-record.ts`, `server/src/world/answer-dispatch.ts` (shared self-answer refusal)
- `server/src/world/answer-dispatch.test.ts` (self-answer identity matrix and original-recipient boundary)
- `server/src/herdr-core/ask-caller.ts` (current core tab/room from World topology)
- `server/src/storage/catalog.ts` (existing actor snapshot stores and limits)
- `web/src/world/worldAsks.ts` (ask actor consumer)
- `server/src/world/agent-resolver.ts` (agent resolver: newcomers, held seats, away, ended, unresolved, conflicts, offers)
- `server/src/world/agent-records.ts` (resolves each complete listing of both runtimes; publishes `agents` and terminal-row `agent_id`)
- `server/src/storage/agent-store.ts` (agent records in `entities` and `facts`, seated by a `seat` binding)
- `server/src/world/binding-types.ts` (the `seat` binding policy)
- `server/src/world/world-cross-view.test.ts` (agent IDs, states and names across both runtimes, a reload and a restart)
- `quint/agent-identity.qnt`, `quint/agent-identity.ts`, `verification/contracts/agent-identity.md` (maintained model, replay adapter, contract)

**Pitfalls:**

- An agent's ID comes from World's store, never from a harness or runtime ID.
  A listing World cannot read clearly (a terminal shown twice) leaves seated
  agents unresolved and changes nothing. A hand-started terminal running an
  away agent's conversation is a new agent; "Same agent as …?" is not built yet.

- Names are display labels; durable identity is qualified by runtime.
- `herdr-world whoami` shows the caller's current runtime location. Herdr resolves
  an unchanged launch-time pane ID after a move; no process environment edit is
  needed. New asks, results and history use that location, while saved attribution
  remains a snapshot of where the caller was when it acted.
