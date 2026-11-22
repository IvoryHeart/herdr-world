# Board notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Board or /board; host zones, workspace/tab cards and pane rows open qualified Inspectors.
- Work pill, Next, view menu, note handles and drawing palette expose distinct actions.
- Phone Board retains cards, notes, strings, fit/zoom and overflow; drawings are read-only there.
- TUI/core share the Board document; core pin labels and native moves retain their own authority.

**Code:**

- `web/src/world/BoardView.tsx`
- `web/src/world/board/BoardSketch.tsx`
- `web/src/world/board/boardModel.ts`
- `server/src/world/board-groups.ts`
- `server/src/storage/board-port.ts`
- `server/src/cli/world.ts`

**Tests:**

- `web/src/world/BoardView.test.ts`
- `web/src/world/board/boardModel.test.ts`
- `web/src/world/board/boardSketchGeometry.test.ts`
- `server/src/service/board-storage.test.ts`

**Pitfalls:**

- Canvas position is not native workspace ancestry or identity.
- Strings require witnessed terminals; matching names or reused IDs are insufficient.
- Sending a note requires explicit recipient checks; drawing never sends to agents.
- Notes/drawings use conflict checks; layout last-writer behavior is not a note merge policy.
- CLI board card commands arrange cards; native moves share town-moves.
