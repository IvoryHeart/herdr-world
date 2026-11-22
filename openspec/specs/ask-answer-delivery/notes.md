# ask-answer-delivery notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Needs you, agent ask/get and Chat answer delivery.

**Code:**

- `server/src/config/data-paths.ts`
- `server/src/config/data-paths.test.ts`
- `server/src/world/ask-peers.ts`
- `web/src/world/NeedsYouItem.tsx`
- `server/src/service/world-ask-peers.test.ts`
- `server/src/world/ask-peers.test.ts`
- `web/src/world/NeedsYouSiblingQuestions.dom.test.ts`
- `server/src/world/ask-recipient.ts`
- `server/src/storage/answer-delivery-crash.test.ts`
- `server/src/agent/answer*`
- `server/src/world/owner-alert-connection.ts` (which Herdr connection alerts for a herdr-core or unplaced asker)
- `server/src/world/owner-alert-connection.test.ts`
- `server/src/world/world-cli-asks.ts`, `server/src/world/attention-dispatch.ts`
- `server/src/herdr-core/ask-caller.test.ts`

**Pitfalls:**

- Saved answers and delivery acknowledgements retain their exact asker.
- A herdr-core default host makes the Herdr connection manager report the core
  ID as its default; never use `defaultId()` as an alert target (#1156).
