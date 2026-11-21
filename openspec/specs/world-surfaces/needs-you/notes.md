# Needs You notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Top-bar badge/Zen picker and the left handle open the same Needs you tab in every view.
- Town letters, Board badges, Desk Answer and Summary links open its requested item/page.
- Phones use a focus-owning full-screen list with Back; desktop can keep it beside the view.
- CLI ask/get/answer/withdraw shares the durable ledger; TUI/core placement keeps exact runtime/session.

**Code:**

- `web/src/world/NeedsYouTab.tsx`
- `web/src/world/NeedsYouItem.tsx`
- `server/src/world/world-cli-asks.ts`
- `server/src/cli/world.ts`
- `server/src/storage/world-storage.ts`

**Tests:**

- `web/src/world/NeedsYouAskerActions.dom.test.ts`
- `web/src/world/needsYou.test.ts`
- `server/src/world/world-question-ownership.test.ts`
- `server/src/world/question-backlog-storage.test.ts`

**Pitfalls:**

- Questions, blocked agents and finished work have different close/review actions.
- Dismiss all groups only verified terminal identity across the full backlog, never matching names.
- CLI cause keys are occupant-scoped; dismissal stays closed until withdrawal.
- Recorded, notified and delivered are distinct outcomes; preserve uncertainty.
- Native prompt answers use Chat checks; a durable ask answer is a different operation.
