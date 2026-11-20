## Why

Shipyard's data (#1013) has no screen. Issue #1028 presents it where work is already watched: Town gets a harbour beside the town center and Board's Work lens gets a Releases tab, both reading the one Shipyard projection.

## What Changes

- Town's harbour: a lighthouse lamp for main's checks, crates on the quay for merged changes waiting for the next release, ships for the latest releases (a pennant when a World here runs one). On a narrow town it folds to a sign on the town center.
- The Work lens gains a Releases tab: main, waiting, shipped and running stages with links to GitHub and fresh local Worlds. Town's harbour opens it; Board opens it from Work.
- A testing-only `?shipyardFixture` switch shows synthetic rare states.
- Links only: no release, tag, install, preview-start or deployment action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-shipyard`: adds the Town and Board presentation requirement; the data requirements are unchanged.

## Impact

Browser only: a shared Shipyard store and view model, the Work lens's tab, Town's harbour lot, art and DOM layer. The Town grows wider by the harbour's lot on wide layouts. No server, API or dependency change.
