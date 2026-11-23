## Why

The town center's ring had grown to ten entries, several of them places that
already have a building in Town (Apartments, Library, the post office's Needs
you), some with counts that repeat the buildings' signs. It was crowded on a
phone and mixed actions with places.

## What Changes

- The first ring keeps only actions that are not a building (New agent, Town
  master, Focus, Summary, Lenses, Profiles, New room) plus one **Buildings**
  entry. First-ring entries show no counts; Focus shows "On" while a focus
  runs.
- **Buildings** opens a second ring around itself with every Town place that has a
  building and opens now: Apartments, Library, Post office, Observatory,
  Warehouse. Choosing one opens what a press on its building opens.
- Each ring opens around the entry that opened it, as the first opens around
  the town center: Buildings' place is the second ring's centre, Back. The
  same rule holds at any later depth. Back, Escape and the phone's Back step
  back one ring, focused on the entry that opened it. A press outside closes
  them all.
- Counts stay on the buildings' signs. Both rings use the same geometry, so
  they fit a phone with targets of today's size.
- Help gains a town center entry with its picture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/town`: the town center ring and its Buildings ring.
- `world-surfaces/apartments`: the ring reaches Apartments through Buildings,
  without a count.

## Impact

Browser: `web/src/world/town/TownCenterMenu.tsx`, `townCenterBuildings.ts`,
`useTownCenter.ts`, `TownCanvas.tsx`, `town.help.ts`. Tests:
`TownCenterMenu.dom.test.ts`, `townCenterBuildings.test.ts`,
`useTownCenter.test.ts`, `townCenter.browser.ts`.
