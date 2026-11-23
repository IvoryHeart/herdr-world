# world-storage notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Shared settings, runtime status, durable Board layout and terminal marks.

**Code:**

- `server/src/workspace/`
- `server/src/worktree/`
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
- `server/src/storage/leftovers.ts` (schema 17 cleanup; version 16 belongs to Board elements)
- `server/src/storage/leftovers.test.ts` (populated folder hashes, snapshot/export faults, migrated CLI history/undo and 2000-row limit)
- `server/src/storage/catalog.ts` (schema-17 command history, retired source and meta declarations)
- `server/src/storage/testing/leftovers-fixture.ts` (testing only: seed an empty preview
  folder with schema 13–16 data: `bun server/src/storage/testing/leftovers-fixture.ts <data-dir> 15`)
- `server/src/storage/legacy-review-migration.ts` (historical schemas 9/10 only)
- `server/src/storage/legacy-reviews.test.ts` (historical review export and byte refusal)
- `server/src/world/persistent-terminal-marks.ts` (current Desk/watch projection)
- `server/src/world/terminal-mark-controls.test.ts` (current ownership/publication controls)
- `server/src/storage/world-storage.ts`
- `server/src/storage/legacy-archive.ts` (moves imported legacy JSON, backups and
  snapshots beyond the newest three to `<data>/legacy/`)
- `server/src/storage/legacy-archive.test.ts`
- `server/src/storage/testing/legacy-data-fixture.ts` (testing only: seeds an
  empty preview data folder as a pre-SQLite World left it, with five snapshot
  stand-ins: `bun server/src/storage/testing/legacy-data-fixture.ts <data-dir>`)
- `server/src/storage/world-storage-crash.test.ts`
- `server/src/storage/`
- `server/src/config/`

**Pitfalls:**

- Shared settings and conditional writes retain service ownership.

Schema 17 keeps CLI history and conditional undo in `command_changes` (existing
2000-row limit) and retains the source as `retired_ledger_changes` for one release.
Import markers and pending profile assignments/imported connections live in
`meta`. Historical review rows export privately to `legacy/retired-completion-reviews.<hash>.json`;
they no longer transfer reviews to current Desk stops and never expire automatically.
To roll back, stop World and restore the pre-upgrade snapshot named by the error.

| Store | Owner | Identity | Limit / lifetime | Browser |
|---|---|---|---|---|
| `command_changes` | CLI history/undo | change ID | 2000 admitted history rows | no |
| `retired_ledger_changes` | schema-17 rollback | change ID | retained for one release; no automatic pruning | no |
| `meta` | storage/profile import metadata | name | no automatic pruning | no |
