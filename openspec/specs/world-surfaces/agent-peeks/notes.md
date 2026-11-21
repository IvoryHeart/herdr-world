# Agent Peeks notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town agent/reception hover previews; tap and keyboard activation open the agent's Inspector.
- Town and Board peeks offer Open chat, Open terminal, Files and qualified answer choices.
- Agents open preference selects Chat/Terminal; phone Chat has one composer and no terminal key bar.
- TUI/core share presentation; readable harness conversations and input capabilities determine availability.

**Code:**

- `web/src/world/town/TownPeek.tsx`
- `web/src/world/board/BoardPeek.tsx`
- `web/src/world/WorldInspectorConversation.tsx`
- `server/src/agent/conversation.ts`
- `web/src/attachmentUploads.ts`

**Tests:**

- `web/src/world/WorldInspectorChatWorktree.test.ts`
- `web/src/components/TerminalComposer.uploads.test.ts`
- `web/src/world/DeskView.test.ts`

**Pitfalls:**

- A peek is read-only conversation preview, not a separate chat window or upload composer.
- Hover alone cannot take keyboard focus or intercept typing in a terminal.
- Use the conversation watch for latest chatter; screen text is not the latest message.
- Opening an agent returns its character to its desk without marking work reviewed.
- There is no peek CLI; task-summary and ask have separate contracts.
