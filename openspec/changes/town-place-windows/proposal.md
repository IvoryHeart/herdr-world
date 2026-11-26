## Why

Town's places opened only from their signs: a press on the post office, the
library, Apartments, the observatory or the warehouse building did nothing,
and each opened a differently shaped window (Needs you as a side tab, the
Work and Usage lenses full screen, Library and Apartments as their own
dialogs).

## What Changes

- A press on a place's building, not only its sign, opens what the sign
  opens. Hovering the building lights its sign; touch works as a click; the
  signs stay the keyboard targets.
- Every place opens in one window frame: a centred modal of one size over
  dimmed Town, with the same header and close button, Escape and Back
  through the layer stack, and content that scrolls inside. On a phone the
  frame is a sheet from the bottom that keeps a strip of Town visible.
- The post office opens Needs you in that frame; closing it returns the
  Needs you tab to how it was, with any unsent answer. Other openers still
  show the tab. The warehouse opens Integrations in it while GitHub is off.
- What each window contains does not change. The town center keeps its
  radial menu; the Town summary stays a managed window.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/town`: place buildings open their windows, and every place
  window shares one frame.

## Impact

Browser: `web/src/world/PlaceWindow.tsx`, `web/src/world/town/townPlaces.ts`,
the Town hit test and interaction, the place sign components, the Library,
Apartments, Work and Usage lenses and the Needs you host. Tests:
`web/src/world/town/townPlaces.browser.ts` through the TownCanvas `places`
cases, `townPlaces.test.ts`, the Town interaction and Needs you unit tests.
