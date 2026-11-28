# world-identity notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Qualified host, room, desk, pane and agent identities.

**Code:**

- `server/src/storage/world-ids.ts`
- `server/src/world/binding-resolution.test.ts`
- `shared/worldIdentity.ts`
- `server/src/world/world-cli-actor.ts` (shared CLI caller location and verification)
- `server/src/http/world-cli-endpoint.ts`, `server/src/http/world-cli-endpoint.test.ts` (platform selection, injected process lookup and both runtime authority checks)
- `server/src/world/caller-identity.ts`, `server/src/world/caller-identity.test.ts` (Linux socket ownership and shared ancestry)
- `server/src/world/caller-identity-darwin.ts`, `server/src/world/caller-identity-darwin.test.ts` (bounded numeric macOS socket/process inspection)
- `server/src/world/world-ledger.ts` (actor snapshots on asks, results and history)
- `server/src/world/world-cli-location.test.ts` (isolated TUI/core move attribution)
- `server/src/world/ask-delivery-types.ts` (stable question ownership versus exact recipient authority)
- `server/src/world/world-cli-asks.ts`, `server/src/world/ask-recipient.ts`, `server/src/world/answer-record.ts`, `server/src/world/answer-dispatch.ts` (shared self-answer refusal)
- `server/src/world/answer-dispatch.test.ts` (self-answer identity matrix and original-recipient boundary)
- `server/src/herdr-core/ask-caller.ts` (current core tab/room from World topology)
- `server/src/storage/catalog.ts` (existing actor snapshot stores and limits)
- `web/src/world/worldAsks.ts` (ask actor consumer)
- `openspec/changes/world-agent-identity/agent-identity.qnt` (design-stage agent identity model; moves to `quint/` with its adapter)

**Pitfalls:**

- Names are display labels; durable identity is qualified by runtime.
- Local CLI caller verification supports Linux and macOS for both runtimes.
  macOS uses the bundled lsof and ps without privileges, with a 1-second deadline
  and 256 KiB cap per command, at most 4096 processes and 64 ancestors. Unavailable
  tools, unreadable or ambiguous ownership, and exhausted limits stay unverified.
  Other platforms name unavailable verification in refused asks. A pane claim
  and a shared process group still grant no authority.
- `herdr-world whoami` shows the caller's current runtime location. Herdr resolves
  an unchanged launch-time pane ID after a move; no process environment edit is
  needed. New asks, results and history use that location, while saved attribution
  remains a snapshot of where the caller was when it acted.
