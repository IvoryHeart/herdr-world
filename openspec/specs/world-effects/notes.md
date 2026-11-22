# world-effects notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Queued close, move, undo and other conditional World actions.

**Code:**

- `shared/bin.ts`
- `server/src/world/bin.test.ts`
- `server/src/effects/runner.ts`
- `server/src/effects/recovery-matrix.test.ts`
- `server/src/effects/`

**Pitfalls:**

- An uncertain native result must not be automatically replayed.
