# Shared surfaces notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town, Board, Desk and Spaces share the shell, host filter and operational contexts.
- Desktop and phone use the same qualified selection and accessibility contracts.
- Herdr TUI and herdr-core share projections; native operation support remains runtime-specific.
- Start with a feature's spec and adjacent notes from the capability index.

**Code:**

- `server/src/world/snapshot.ts`
- `web/src/world/WorldFoundationApp.tsx`
- `web/src/world/worldObject.ts`
- `web/src/world/interaction/gesture.ts`

**Tests:**

- `web/src/world/WorldFoundationApp.test.ts`
- `web/src/world/worldObject.test.ts`
- `web/src/world/WorldTerminalHandoff.test.ts`

**Pitfalls:**

- A view selection or filter is not permission to operate a runtime.
- Cached topology cannot establish absence or authorize commands.
- Keep one terminal owner and one browser transport across view transitions.
- CLI operations belong to their feature notes; there is no separate shell CLI.
