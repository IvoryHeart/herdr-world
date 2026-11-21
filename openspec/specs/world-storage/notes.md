# world-storage notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Shared settings, runtime status, durable Board layout and terminal marks.

**Code:**

- `server/src/rpc/desk.ts`
- `server/src/rpc/desk.test.ts`
- `server/src/storage/profile-port.ts`
- `server/src/service/profile-storage.test.ts`
- `server/src/storage/board-port.ts`
- `server/src/service/board-storage.test.ts`
- `server/src/storage/runtime-status.ts`
- `server/src/service/runtime-status-storage.test.ts`
- `server/src/storage/terminal-marks.ts`
- `server/src/storage/terminal-marks.test.ts`
- `server/src/world/world-cli-asks.ts`
- `web/src/world/NeedsYouAskerActions.tsx`
- `server/src/world/world-question-ownership.test.ts`
- `server/src/world/question-backlog-storage.test.ts`
- `web/src/world/NeedsYouAskerActions.dom.test.ts`
- `server/src/storage/world-storage.ts`
- `server/src/storage/world-storage-crash.test.ts`
- `server/src/storage/`
- `server/src/config/`

**Pitfalls:**

- Shared settings and conditional writes retain service ownership.
