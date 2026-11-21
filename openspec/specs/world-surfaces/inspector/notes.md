# Inspector notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town/Board/Desk selection, common navigator/tab strip and Actions open the shared Inspector.
- Headers offer dock/undock, resource tabs, worktree chooser and pane selection; Settings controls opening mode.
- Phones use the same resources through a compact full-screen window and Back.
- TUI/core reuse the resource surface; core applicability follows coreInspector and its runtime adapter.

**Code:**

- `web/src/world/useWorldInspectorWindows.ts`
- `web/src/world/WorldInspectorConversation.tsx`
- `web/src/components/WorkspaceInspectorHost.tsx`
- `server/src/agent/worktree.ts`
- `web/src/world/coreInspector.ts`

**Tests:**

- `web/src/world/WorldInspectorWorktree.test.ts`
- `web/src/world/WorldInspectorChatWorktree.test.ts`
- `web/src/chatFocus.test.ts`
- `server/src/agent/worktree.test.ts`

**Pitfalls:**

- An Inspector represents one qualified tab, with selected pane-specific agent resources.
- Files and Changes share the admitted agent worktree; workspace defaults cannot substitute.
- Navigator selection replaces the docked conversation; explicit docking swaps presentations.
- Delayed focus/resources must not put one identity over another agent's content.
- No Inspector CLI exists; native operations remain owned by their captured runtime.
