## Why

Shipyard's data (#1013) has no screen. Issue #1028 presents it where work is already watched: Town gets a harbour at its right-most edge, one shipping lane per project, and Board's Work lens gets a Releases tab, both reading the one Shipyard projection.

## What Changes

- Town's harbour, at the town's right-most edge on open sea: one colour-coded shipping lane per project, each with a lighthouse lamp for main's checks, a hull on the slipway counting merged changes waiting for the next release, and ships for the latest releases (a pennant when a World here runs one); more projects than lanes end in a "+N more" lane. A phone's stacked town has the same harbour right of its buildings, reached by panning or zooming, and a signpost on the town center flies there.
- Open pull requests move from the post office to a warehouse on the harbour's shore, so cargo means one thing: the post office no longer holds them.
- The Work lens gains a Releases tab: main, waiting, shipped and running stages with links to GitHub and fresh local Worlds. Town's harbour opens it; Board opens it from Work.
- A testing-only `?shipyardFixture` switch shows synthetic rare states.
- Links only: no release, tag, install, preview-start or deployment action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-shipyard`: adds the Town and Board presentation requirement; the data requirements are unchanged.

## Impact

Browser only: a shared Shipyard store and view model, the Work lens's tab, Town's harbour and warehouse lots, art and DOM layers. A wide Town grows wider by the shore and its sea, which runs off the map's right edge. No server, API or dependency change.
