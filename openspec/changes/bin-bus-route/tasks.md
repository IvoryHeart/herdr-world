## 1. Trip timing

- [x] 1.1 Add the bus's speed and the trip rule (`binBusTripMs`, `binBusRoute`) to `shared/bin.ts`.
- [x] 1.2 Time the bus in the service by its riders' routes; depart a minute after the first waiter, never before the bus out is back.
- [x] 1.3 Add `world.bin.route` (browser actor only); the first report per entry stands.

## 2. Town and the bin

- [x] 2.1 Town measures each waiting agent's route on its roads and reports it.
- [x] 2.2 Every view counts down to the bus's return to Apartments; Town's bus shows its speed and distance.
- [x] 2.3 Unit and DOM tests for the rule, the service, the labels and Town's measure.
- [x] 2.4 Update the Town and world-effects notes and `docs/world-effects.md`.

## 3. Synchronize

- [ ] 3.1 Synchronize these deltas into `world-surfaces/town` after merge.
