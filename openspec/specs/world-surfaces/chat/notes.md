# Chat notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Inspector Chat opens from agent activation, Needs you, peek Open chat and resource tabs.
- The composer offers attachments, slash commands, explicit Send and harness menu/key controls.
- Phone Chat uses the same draft and captured prompt flows without a second terminal key bar.
- TUI/core require a readable supported conversation; guessed Codex history is read-only.

**Code:**

- `server/src/adapters/agent-input.ts`
- `server/src/adapters/herdr-runtime.ts`
- `server/src/adapters/agent-input.test.ts`
- `server/src/service/rpc-dispatch.ts`
- `server/src/service/terminal-input.test.ts`
- `web/src/terminalComposer.ts`
- `web/src/terminalPaste.ts`

- `web/src/attachmentUploads.ts`
- `web/src/components/InspectorChat.tsx`
- `web/src/components/TerminalComposer.tsx`
- `server/src/agent/conversation.ts`
- `server/src/agent/pending-prompt.ts`
- `server/src/herdr-core/recipient.ts`

**Tests:**

- `server/src/agent/pending-prompt-captured.test.ts`
- `server/src/herdr-core/delivery.test.ts`
- `web/src/world/WorldInspectorChatWorktree.test.ts`
- `web/src/components/TerminalComposer.uploads.test.ts`

**Pitfalls:**

- A reported session alone does not make startup Chat readable or authorize Send.
- Prompt recognition needs complete native and transcript witnesses, not quoted prose.
- Folder trust uses its pre-session process witness; do not fabricate a session fingerprint.
- Successful input is not a confirmed answer; preserve uncertain receipts.
- CLI ask answers use the durable ask ledger, not Chat's native prompt keys.

## Foreground admission

Explicit Terminal composer submissions, draft insertion, paste and review-feedback prefill retain raw terminal authority, including in shells and editors. World agent sends opt into foreground admission through server-side `withAgentInput` context; `agent.prompt` always requires admission. The browser's raw `pane.send_input` route still checks browser authorization and the captured connection/generation, without requiring an agent.

World agent text requires fresh native evidence of the addressed harness and session in the foreground. A shell, editor or unknown foreground refuses input even if its old agent report remains. An ask also retains its original process witness: after exit or replacement, Reception shows **Not sent** with not-attached evidence, and `herdr-world ask get ID` retains the answer. Old asks without the witness stay retrieval-only. No refused delivery revives for a new agent. Core cancels held native sends on observed foreground changes; neither runtime provides atomic foreground/session conditional typing, so the final native RPC race remains a runtime limitation.
