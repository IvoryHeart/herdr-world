## Why

The bin's countdown came from a fixed timetable (a bus every four minutes, a
two-minute trip), not from the bus: Town hurried or slowed its drive to fit,
and a farther stop closed at the same moment as a near one. The countdown
should read when the bus actually arrives back at Apartments.

## What Changes

- The bus has a speed (36 km/h). Its trip lasts its route at that speed, out
  past every stop with riders and back, plus pulling away and in, its
  wait at each stop and its riders stepping off (`binBusTripMs`).
- Town measures the next trip on its roads, the bus's way past the stops of
  exactly the agents waiting and back, and reports it to World
  (`world.bin.route`). The first measure of those agents stands; when who
  waits changes, the next measure of the new set stands. Until a Town has
  measured it, the trip is a 500 m route with each waiting agent a stop.
- The bus sets off a minute after the first agent starts waiting, never
  before the bus out is back. It no longer runs on a four-minute timetable.
- Every view counts down to one shared moment: when the bus that takes them
  is back at Apartments, which is when they close. Town says "bus back in";
  other views say "closes in".
- A plate over Town's bus shows its speed and the route it is to drive, then
  how far it has left, as a share of World's route: every layout draws its
  own roads but reads the same distance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/town`: the close deadline comes from the bus's speed and
  its riders' routes.

## Impact

Shared: `shared/bin.ts`. Service: `server/src/world/bin.ts`,
`server/src/rpc/bin.ts`, `server/src/verbs/rpc.ts` and the policy baseline.
Browser: `web/src/world/bin/binStore.ts`, `web/src/world/bin/WorldBin.tsx`,
`web/src/world/town/TownBusLayer.tsx`, `townBus.ts`, `townBusDrive.ts`,
`townBusDemo.ts`, `townBus.css`. Tests: `server/src/world/bin.test.ts`,
`server/src/rpc/bin.test.ts`, `web/src/world/bin/binStore.test.ts`,
`web/src/world/town/townBus.test.ts`,
`web/src/world/town/townBusCountdown.dom.test.ts`.
