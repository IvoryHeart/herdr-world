# Town Moves notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town moves desks by mouse drag or touch hold-and-drag; M on a focused target opens destinations.
- A desk can reorder within its room or move rooms; an agent can join another desk.
- Board cross-workspace moves and CLI town desk/group membership moves share service orchestration.
- TUI exports/replays split trees; core uses placement operations in herdr-core-runtime.

**Code:**

- `web/src/world/town/townMoveActions.tsx`
- `web/src/world/town/townMoveMenu.ts`
- `web/src/components/PaneMoveMenu.tsx`
- `server/src/world/town-move.ts`
- `server/src/herdr-core/town-move.ts`
- `server/src/cli/world-groups.ts`

**Tests:**

- `web/src/world/town/townMoves.test.ts`
- `server/src/world/town-move.test.ts`
- `server/src/herdr-core/town-moves.test.ts`
- `server/src/cli/world-groups.test.ts`

**Pitfalls:**

- Do not infer all move entry points from scene buttons: Town has drag and M controls.
- Also inspect Spaces pane handles/tab menus and Inspector split-pane controls (the #990 trap).
- The service queue is per connection; captured generations cannot fall back.
- Replacement pane IDs must flow through every later step and compensation.
- Last-room confirmation and unknown outcomes cannot be bypassed or automatically retried.
