# Appearance notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Terminal header/title-bar editor and menus reach name, colour, status and avatar in every view.
- Town/Board cards, room/building controls and Spaces sidebar menus also reach shared palette choices.
- Phone app bars expose the same appearance; profile assignment/Town master live with the terminal.
- TUI/core use exact native rename and terminal metadata; World persists appearance and palette overrides.

**Code:**

- `web/src/world/TerminalAppearanceEditor.tsx`
- `web/src/world/terminalColor.ts`
- `server/src/rpc/appearance.ts`
- `server/src/agent/terminal-settings.ts`
- `server/src/agent/profile-service.ts`

**Tests:**

- `server/src/rpc/appearance.test.ts`
- `web/src/world/terminalColor.test.ts`
- `server/src/agent/terminal-settings.test.ts`
- `web/src/world/TerminalAppearanceEditor.test.tsx`

**Pitfalls:**

- Native tab names are not World shadow names; split avatars are per pane.
- Tab colour inherits spawn/workspace defaults, never host colour or runtime status.
- Saved terminal choices require continuity evidence; reused IDs cannot inherit them.
- Herdr assignments have no TTL and end with terminals; World profiles/chimes persist separately.
- CLI colour commands affect shared appearance; task-summary is session-scoped metadata, not status text.
