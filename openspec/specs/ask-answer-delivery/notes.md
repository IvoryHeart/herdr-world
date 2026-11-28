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
- `server/src/adapters/terminal-readers.ts`, `server/src/adapters/terminal-readers.test.ts`
- `server/src/adapters/herdr-runtime.ts`, `server/src/connections/runtime.ts`
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

**Pitfalls:**

- Saved answers and delivery acknowledgements retain their exact asker.
- A moved terminal still cannot answer its own question. Self-answer refusal
  follows its verified connection and terminal; delivery and acknowledgement
  retain the stricter captured recipient checks.
- A herdr-core default host makes the Herdr connection manager report the core
  ID as its default; never use `defaultId()` as an alert target (#1156).

## Foreground admission

Right before World types answers, Chat messages, notifications or prompts, it checks what is reading that terminal, including foreground children. A process counts only when it is in the terminal's foreground process group and its stdin is that terminal's PTY. Stdio MCP servers, language servers and other helpers on pipes do not block delivery; a PTY-reading child still does. A shell, interactive REPL, editor/pager, ssh, sudo/su or database client stops input. Other programs are allowed, including agents resumed or restarted, arbitrary agents, non-shell wrappers and npm installations. Shells are recognized by executable basename alone, including bash --rcfile/--init-file/-o and script/-c launchers. Multiplexers (tmux, screen, zellij) and nested shell launchers (docker, busybox sh) also stop input. A tool child (ssh, python (including scripts and stdin), psql, sudo) under an admitted leader means busy: nothing is sent, World says to try again shortly without saying the agent has gone, and saved answers wait for a fresh check. Empty command lines are temporary too. World does not match the original agent session or hash its process IDs. A failed check says to try again shortly and leaves saved answers waiting. Runtime/terminal qualification and no replay of refused or uncertain sends still apply.

In Reception > Outbox, **Not sent** names the current program category in plain words. **Copy answer** copies the saved owner answer; the full `herdr-world ask get <id>` command reads it later. **Put in Terminal composer** opens that terminal's draft on desktop or phone and preserves existing text. It sends nothing; the owner reviews and sends explicitly. Neither runtime makes the final OS foreground check and typing one indivisible operation. Automatic input requires readable Linux PTY/process evidence: TUI probes its qualified host, while core uses its local host process namespace. Missing evidence stays temporarily unavailable; it never falls back to local PIDs for a remote host.

The phone core Terminal keeps its Send controls open; desktop draft recovery opens them on request.
