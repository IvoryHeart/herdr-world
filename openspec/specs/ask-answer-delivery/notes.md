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

**Pitfalls:**

- Saved answers and delivery acknowledgements retain their exact asker.
