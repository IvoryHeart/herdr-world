# History notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Inspector Agent History and Details Chat/Timeline read the captured pane's transcript.
- Manual Codex linking uses preview plus confirmation; task-summary CLI reports current work on desks/cards.
- Phone History shares the qualified terminal Message draft and explicit send confirmation.
- TUI/core use their session adapters; SSH transcripts stay on the selected host.

**Code:**

- `server/src/agent/session-history.ts`
- `server/src/herdr/task-summary.ts`
- `server/src/herdr-core/history.ts`
- `web/src/components/AgentHistoryChat.tsx`
- `web/src/components/HistoryTerminalComposer.tsx`

**Tests:**

- `server/src/agent/session-history.test.ts`
- `server/src/herdr/task-summary.test.ts`
- `server/src/herdr-core/history.test.ts`
- `web/src/components/AgentHistoryComposer.test.tsx`

**Pitfalls:**

- Guessed Codex history is read-only and has no session fingerprint or Send authority.
- A shared daemon's unseen clients limit inference; uniqueness is within the selected connection.
- Task summaries expire with their exact session fingerprint; task-summary has no --clear.
- Switching Chat/Timeline cannot imply older transcript pages were fetched.
- Never use local transcript fallback for a failed remote lookup.
