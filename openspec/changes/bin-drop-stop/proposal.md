## Why

Agents dropped on two different bus stops in Town all waited at one stop:
Town forgot which stop an agent was dropped on and placed every waiting agent
at the stop nearest its room.

## What Changes

- An agent dropped on a Town bus stop waits at that stop. World keeps the
  stop with its bin entry (`BinEntry.stop`), so every Town, and Town after a
  reload, shows it there.
- The stop is kept as one corner of a building (the building's Town key and
  top-left, top-right, bottom-left or bottom-right), not as a place on the
  map, so it stays the same stop as Town grows or reflows and is the like
  stop on another browser's layout.
- Where that building or corner has no stop in a Town, and for an agent put
  in the bin any other way (the bin, the **⋯** menu, Board), the agent waits
  at the stop nearest its room, as before.
- The bus's one trip calls at every stop with someone waiting before it goes
  back to Apartments, as it already did; it now has more than one stop to
  call at when agents were dropped on different stops.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/town`: a waiting agent stands at the stop it was dropped
  on.

## Impact

Shared: `shared/bin.ts`. Service: `server/src/world/bin.ts` (memory only;
`server/src/storage/catalog.ts` row updated). Browser:
`web/src/world/bin/binStore.ts`, `web/src/world/bin/WorldBin.tsx`,
`web/src/world/bin/binDrop.ts`, `web/src/world/town/townBinDrop.ts`,
`townBus.ts`, `townDrag.ts`, `scene/townInteraction.ts`, `TownCanvas.tsx`,
`townRoomActions.ts`, `web/src/world/TownView.tsx`. Tests:
`server/src/world/bin.test.ts`, `web/src/world/town/townBus.test.ts`,
`web/src/world/town/scene/townInteraction.test.ts`.
