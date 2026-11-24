## 1. Runtime icons

- [x] 1.1 Draw the Herdr TUI and herdr-core icons, told apart by shape, in Town's pixel style.
- [x] 1.2 Show the icon before the name on plaques and overview cards; keep the runtime in the accessible label and a tooltip.
- [x] 1.3 Show the icon in Move menus; add the runtime in words only where two entries would read the same.
- [x] 1.4 Cover the icons, the room runtime kind and the menu words with unit tests.

## 2. Plaque above the room

- [x] 2.1 Stand the plaque on the room's top edge, outside its floor.
- [x] 2.2 Open the card on a click or tap of the title, or Enter or Space; close it on a second click, a press outside or Escape; one card at a time.
- [x] 2.3 Route a tap on a movable name through the Town gesture so a drag never opens the card.
- [x] 2.4 Browser tests: hover and focus open nothing, a click opens and a second click closes, and every top-row agent takes a tap while cards are closed.

## 3. Help and notes

- [x] 3.1 Add the Town Help entry for the icons and capture only its picture.
- [x] 3.2 Document the controls and code paths in the Town notes.

## 4. Synchronize

- [ ] 4.1 Synchronize these deltas into `world-surfaces/town` after merge.
