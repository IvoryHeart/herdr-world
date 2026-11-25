# world-effects notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Queued close, move, undo and other conditional World actions.

**Code:**

- `shared/bin.ts`: the bus's speed and `binBusTripMs`/`binRiderKey`, the
  trip rule the service times by and Town drives to.
- `server/src/world/bin.ts`: holding, departures (a minute after the first
  waiter, never before the bus out is back), route reports (`route`, the
  first measure of exactly those waiting stands) and the journal lines
  (`Bin holds …`, `Bin bus N set off with … aboard: … m there and back, … ms`,
  `Bin dropped …`, `Bin closing …`, `Bin close of …`) at info level in the
  service journal.
- `server/src/service/bin-service.ts`; wired in
  `server/src/service/world-service.ts` (complete pane lists from
  `server/src/world/snapshot.ts`, both runtimes' generations).
- `server/src/world/bin.test.ts`
- `server/src/world/bin-core-ended.test.ts`
- `server/src/effects/runner.ts`
- `server/src/effects/recovery-matrix.test.ts`
- `server/src/effects/`

**Pitfalls:**

- An uncertain native result must not be automatically replayed.
- A held agent whose pane and terminal are gone from a complete pane list read
  after it was held has ended by itself: it leaves the Bin with nothing
  closed. A list read before the hold witnesses nothing, so a just-started
  agent is never dropped by an earlier read.
- A stopped bus drives on once its last rider leaves, however it left: put
  back, ended by itself, or its host's runtime restarted. Otherwise it stands
  empty with no timer and later agents never board.
