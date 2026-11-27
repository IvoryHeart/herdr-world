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

- `server/src/world/answer-foreground.test.ts`
- `server/src/world/answer-dispatch.ts`
- `server/src/adapters/agent-input.ts`
- `server/src/adapters/agent-input.test.ts`
- `server/src/herdr-core/harness.ts`, `server/src/herdr-core/harness.test.ts`
- `server/src/herdr-core/ask-caller.ts`
- `web/src/world/town/AnswerDeliveries.tsx`, `web/src/world/town/AnswerDeliveries.test.ts`
- `web/src/world/town/answerOutbox.ts`, `web/src/world/town/answerOutbox.test.ts`
- `web/src/world/town/TownSummaryPanel.tsx`
- `web/src/world/terminalComposerRequest.ts`, `web/src/world/terminalComposerRequest.test.ts`
- `web/src/world/CoreTerminalComposer.tsx`, `web/src/components/TerminalView.tsx`
- `web/src/components/TerminalComposer.css` (shared editor styles for explicit desktop recovery)
- `web/src/world/AnswerDeliveries.browser.tsx`, `web/src/world/AnswerDeliveries.browser.test.ts`
- `server/src/herdr-core/runtime.ts`
- `server/src/herdr-core/recipient.ts`
- `server/src/storage/catalog.ts`

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

## Foreground admission

World sends answers, Chat messages, notifications and prompts only while the original agent is running in front in that terminal. A shell, editor, pager, different agent or unknown program stops delivery, including a shell or editor opened by the agent. Temporary failures to check the terminal leave the answer waiting. Changing a working title does not stop delivery. If the agent exits, restarts or resumes as a new process, World shows **Not sent** and keeps the answer readable with `herdr-world ask get <id>`; starting another agent never sends it again. Questions left open across a World restart or upgrade also show **Not sent** when answered and remain readable with that command. Agents started through a wrapper script cannot receive this input while the script stays in front; use `exec` in the script to let the agent take its place. In Reception > Outbox, **Copy answer** copies the saved owner answer, and **Put in Terminal composer** opens that terminal with the answer in its draft, preserving any existing draft. The owner reviews and sends it explicitly; putting it there sends nothing. Neither runtime can make the last foreground check and typing one indivisible operation.
