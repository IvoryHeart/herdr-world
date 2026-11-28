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
- `server/src/adapters/herdr-runtime.ts`, `server/src/connections/runtime.ts`
- `server/src/herdr-core/harness.ts`, `server/src/herdr-core/harness.test.ts`
- `server/src/herdr-core/ask-caller.ts`
- `server/src/herdr-core/occupant.ts` (`coreSessionProof`: core session evidence that survives a World restart)
- `web/src/world/town/AnswerDeliveries.tsx`, `web/src/world/town/AnswerDeliveries.test.ts`
- `web/src/world/town/answerOutbox.ts`, `web/src/world/town/answerOutbox.test.ts`
- `web/src/world/town/TownSummaryPanel.tsx`
- `web/src/world/terminalComposerRequest.ts`, `web/src/world/terminalComposerRequest.test.ts`
- `web/src/world/CoreTerminalComposer.tsx`, `web/src/components/TerminalView.tsx`
- `web/src/components/TerminalComposer.css` (shared editor styles for explicit desktop recovery)
- `web/src/world/AnswerDeliveries.browser.tsx`, `web/src/world/AnswerDeliveries.browser.test.ts`
- `server/src/herdr-core/runtime.ts`
- `server/src/herdr-core/connections.ts`, `server/src/herdr-core/testing/core-world.ts`
- `server/src/herdr-core/recipient.ts`
- `server/src/herdr-core/native-send.test.ts`
- `server/src/herdr-core/process-group.ts`

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
- `server/src/world/ask-delivery-types.ts` (stable self-answer ownership and exact original-recipient checks)
- `server/src/world/answer-record.ts`, `server/src/world/answer-dispatch.ts`
- `server/src/world/answer-dispatch.test.ts`, `server/src/world/world-cli-location.test.ts` (self-answer refusal after moves)
- `server/src/storage/answer-delivery-crash.test.ts`
- `server/src/agent/answer*`
- `server/src/world/owner-alert-connection.ts` (which Herdr connection alerts for a herdr-core or unplaced asker)
- `server/src/world/owner-alert-connection.test.ts`
- `server/src/world/world-cli-asks.ts`, `server/src/world/attention-dispatch.ts`
- `server/src/herdr-core/ask-caller.test.ts`
- `server/src/world/effect-restart.test.ts` (answers and questions across a World restart)
- `web/src/testing/AnswerContinuityFixture.tsx`, `web/src/world/AnswerContinuity.browser.tsx`, `web/src/world/AnswerContinuity.browser.test.ts` (`?answerContinuityFixture` restart preview)

**Pitfalls:**

- Saved answers and delivery acknowledgements retain their exact asker.
- A moved terminal still cannot answer its own question. Self-answer refusal
  follows its verified connection and terminal; delivery and acknowledgement
  retain the stricter captured recipient checks.
- A herdr-core default host makes the Herdr connection manager report the core
  ID as its default; never use `defaultId()` as an alert target (#1156).

## Foreground admission

Right before World types answers, Chat messages, notifications or prompts, it checks only the foreground process group's leader reported by the runtime. It uses the executable basename and ignores arguments. Shells, REPL interpreters, editors/pagers, ssh, sudo/su, database clients, tmux/screen/zellij and docker stop input. This includes shell scripts, bash --rcfile/--init-file/-o, node/python scripts and docker exec: arguments do not change the classification. Other executable names are allowed without matching the original agent session.

Children and MCP helpers are ignored. A shell started inside a live harness is a known limit: the harness leader still passes this check. World does no tty or /proc inspection for input admission. When the runtime provides no foreground information (including macOS, remote cores and a Herdr TUI without process info), this check preserves behavior before this PR. Existing connection, generation, terminal and delivery qualification still apply; missing foreground information does not override them.

In Reception > Outbox, **Not sent** names the refused program category in plain words. **Copy answer** copies the saved owner answer; the full `herdr-world ask get <id>` command reads it later. **Put in Terminal composer** opens that terminal's draft on desktop or phone and preserves existing text. It sends nothing; the owner reviews and sends explicitly. Refused deliveries and possible sends are never automatically replayed. Neither runtime makes the final OS foreground check and typing one indivisible operation.

The phone core Terminal keeps its Send controls open; desktop draft recovery opens them on request.

## Answers across a World restart

A saved answer, or one given to a question open across a World restart, is sent only after World proves the original harness session still runs at the captured terminal. `ask-recipient.ts` repeats the proof at answer recording, the dispatch fence and the final input guard. Herdr TUI needs the same connection, pane, terminal and harness-reported session plus an unchanged conversation fingerprint, so `claude --resume` in the same pane qualifies. herdr-core needs the same core terminal and the same harness session ID on the foreground program's command line (`coreSessionProof` in `server/src/herdr-core/occupant.ts`, saved as the core recipient's `session` with the question), so `claude --resume <id>` there qualifies; PIDs and names are not proof, and a program that names no session stays Not sent. Otherwise Reception > Outbox shows Not sent with a plain restart reason, Copy answer and `herdr-world ask get <id>`. Possible sends from before the restart stay uncertain and are never replayed; Send again reaches only a proven session. `/?answerContinuityFixture` previews both outcomes with synthetic agents.
