# ask-answer-delivery notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Needs you, agent ask/get and Chat answer delivery.
- Agent `ask ls [--json]` lists retained questions for the verified calling
  terminal, newest first, including closed questions. It follows `result ls`'s
  JSON line/envelope style; `age_ms` is time since creation. An owner dismissal
  remains `dismissed`, and a later withdrawal supersedes an answer or dismissal.
- Use `ask ls`, not `ask list`. Command-word-only questions fail quietly with a
  usage hint, including when supplied after flags or sent directly to World.

**Code:**

- `shared/askCommands.ts`
- `shared/questionAsker.ts`
- `server/src/cli/world.ts`, `server/src/cli/world.test.ts`
- `server/src/cli/world-skill.ts`, `server/src/cli/integration.ts`, `server/src/cli/integration.test.ts`
- `server/src/world/world-cli.ts`, `server/src/world/world-cli-protocol.ts`
- `server/src/world/world-cli.test.ts`, `server/src/world/world-question-ownership.test.ts`
- `server/src/verbs/cli.ts`, `server/src/verbs/policy-baseline.json`
- `server/src/verbs/policy.test.ts`
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
