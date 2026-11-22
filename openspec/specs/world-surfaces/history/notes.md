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

## Usage reference

## Pane chat and input

In Spaces, **Show as a chat** on an agent pane displays its conversation while the
terminal keeps running. **Show the terminal** restores the live terminal; Ctrl+Alt+M
switches the active pane. The terminal remains the default; Settings → Agents →
Open agents as a chat can choose Chat for new agent panes. Town remains World's
phone entry point and the shared top app bar stays reachable. History retains its bounded window and
original Codex linking and transcript controls.

Pane chat shows screen-derived questions and working activity. Choice buttons type
only into that pane's captured connection/runtime; a hidden terminal cannot take
keyboard focus. Before a transcript exists the message box remains available;
a failed send stays marked for explicit retry or discard. Busy or unknown agents
still require confirmation. Drafts stay in memory and are shared with that pane's
terminal input. Switching or replacing the runtime never redirects a send.

Claude sessions expose their recorded slash commands and published artifact links.
Images recorded with recent messages load on demand within bounded per-session
budgets and open in a dismissible lightbox; host paths use World's qualified,
same-origin file endpoint. Optional Vim keys are configured under Settings → Keyboard →
Vim keys in agent chats. Settings → Integrations offers a submit key per agent
(Enter, Shift/Alt/Ctrl or Cmd/Super+Enter). If the text arrives but the modified submit key fails, the draft
is not restored or automatically sent again.

Automatic agent tab naming is enabled by default and can be disabled in Settings.
The control is under Settings → Agents → Automatic tab renaming. It names default
tabs from the active bound session or terminal title; custom names and manual
renames retain ownership.

Pane lifecycle: `web/src/components/usePaneChat.tsx`; screen state: `web/src/components/terminalViewState.ts`; metadata routing: `server/src/rpc/agent.ts`. Consumers: `web/src/components/AgentHistoryDrawer.paneChatFocus.test.tsx`, `web/src/agentChatMetadata.test.tsx`.
