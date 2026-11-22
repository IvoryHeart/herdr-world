# Desk Attention notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Desk or /desk for Now, Agents and Reviewed, with shared search.
- Cards open exact agent Inspectors; Answer leads to Needs you and review offers Undo.
- Wide screens dock a reading pane and support J/K/Enter/E; phones open the Inspector full-screen.
- TUI/core use the same qualified receipts and stops; missing native evidence remains explicit.

**Code:**

- `web/src/world/DeskView.tsx`
- `web/src/world/handoffs.ts`
- `server/src/world/desk-watches.ts`
- `server/src/rpc/desk.ts`
- `server/src/storage/terminal-marks.ts`

**Tests:**

- `web/src/world/DeskView.test.ts`
- `web/src/world/DeskView.browser.test.ts`
- `server/src/world/desk-watches.test.ts`
- `server/src/rpc/desk.test.ts`

**Pitfalls:**

- Review marks belong to a stop and session, not a name or receipt polling timestamp.
- A previous report must not enable reviewing a new stop whose report is pending.
- Outside-filter summaries are read-only until explicit Reveal & open admission.
- Superseded reveal/focus work cannot revive on returning to Desk.
- There is no Desk view CLI; task summaries are covered by history.
