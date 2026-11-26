## Why

In a building that holds both runtimes of one machine, each room's plaque
and overview card named its runtime in a text tag ("Herdr TUI",
"herdr-core"). The tag took width from the room name and read as clutter.
The plaque also sat on the room's floor, over the top row of desks, so it
covered agents there. Hovering it opened its card, which then covered more
of the room.

## What Changes

- A room's runtime shows as a small pixel icon before its name, on its
  plaque and on its overview card: a terminal window for the Herdr TUI, a
  diamond for herdr-core. The two differ by shape as well as colour.
  Hovering, focusing or tapping the plaque's icon names the runtime in a
  tooltip. The accessible label keeps the runtime in words. Buildings with
  one runtime show no icon.
- Move menus show the icon beside a room's name. They add the runtime in
  words only where two entries would otherwise read the same.
- The plaque stands above the room, outside its floor, so no desk or agent
  sits under it.
- Hovering or focusing a plaque opens nothing. A click or tap on its title,
  or Enter or Space on the focused plaque, opens its card. Another click on
  the title, a press outside the plaque or Escape closes it. Only one card
  is open at a time. Dragging the name or the Move handle still moves the
  room and never opens the card.
- Town's Help gains an entry for the two icons.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/town`: room runtimes as icons, the plaque above the room,
  and the plaque's card opened by a click.

## Impact

Browser: `web/src/world/town/TownRoomPlaque.tsx`, `TownRuntimeIcon.tsx`,
`townPlaqueCard.ts`, `TownWorldLayer.tsx`, `townMoveMenu.ts`,
`TownChooser.tsx`, `townBuildings.ts`, the Town gesture
(`scene/townInteraction.ts`, `TownCanvas.tsx`) and the plaque styles. Help:
`town.help.ts` and the help stage's two-runtime town. Tests: the plaque,
buildings, move menu and interaction unit tests,
`townRoomPlates.browser.ts` through the TownCanvas `plates` cases, and
`TownOwnerTopology.browser.test.ts`.
