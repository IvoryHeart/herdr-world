## 1. Storage catalog (#1252)

- [x] 1.1 Catalog current tables, files, browser keys and memory owners; verify completeness and generated notes with `bun run test server/src/storage/catalog.test.ts`.
- [x] 1.2 Add the unused `declareData` seam and record target deltas; verify the focused test, quick typecheck and strict OpenSpec validation.

## 2. Later single-model steps (not delivered by #1252)

- [ ] 2.1 Stop legacy re-imports and archive leftovers/snapshots without deletion; verify pre-SQLite and schema 13–15 semantic fixture dumps.
- [ ] 2.2 Move roaming preferences and native-aware pins/order to their shared homes; verify idempotent browser uploads and runtime pin reconciliation.
- [ ] 2.3 Introduce entities/facts/records and fold Board families, usage and profiles into the single writer; verify identity ambiguity, revisions, snapshot recovery and full-chain fixture equality.
- [ ] 2.4 Deliver one owned-model stream and move Desk, Town, Board and Spaces consumers; verify cross-view consistency and read-only observation bounds.
- [ ] 2.5 Persist Bin holding, World-owned assignments/master and Ranger workspace entity references; verify restart behavior and all six owner decisions before archive.
