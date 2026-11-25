## 1. Remember the stop

- [x] 1.1 Add `BinStop` (building key and corner) to the bin entry in `shared/bin.ts`; the service keeps a well-formed one in memory and drops a malformed one.
- [x] 1.2 Town's drag reports the stop it was dropped on; Town turns it into a building corner and sends it with the bin request.

## 2. Place the rider

- [x] 2.1 Town finds the remembered stop in its own layout and places the rider there, or at the stop nearest its room when it has none.
- [x] 2.2 Unit tests for the round trip on every layout, a growing town, riders at two stops and the fallback.
- [x] 2.3 Update the Town notes and the storage catalog.

## 3. Synchronize

- [ ] 3.1 Synchronize these deltas into `world-surfaces/town` after merge (after `bin-bus-route`).
