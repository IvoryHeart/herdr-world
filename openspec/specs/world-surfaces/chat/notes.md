# Chat notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Inspector Chat opens from agent activation, Needs you, peek Open chat and resource tabs.
- The composer offers attachments, slash commands, explicit Send and harness menu/key controls.
- Phone Chat uses the same draft and captured prompt flows without a second terminal key bar.
- TUI/core require a readable supported conversation; guessed Codex history is read-only.

**Code:**

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
