## Why

Two terminals carrying the same `herdr.space=crew` appear as separate spaces in
the owner's Android app (#1435). World's labels already match the published app
adoption contract; its documentation incorrectly promises that `where` also names
spaces in Herdr's apps.

## What Changes

- Pin launches and moves to one machine-local space ID with distinct tab IDs,
  including readback from an isolated real core.
- Correct the naming promise: app layout names and label-based grouping are
  separate; no supported display-name label exists yet.
- Document dispatcher labels and prepare an upstream Android report without
  changing app-owned layout or the stacked PR's room-name derivation.

## Capabilities

### Modified Capabilities

- `herdr-core-runtime`: clarify app placement identity and its naming limit for
  World-started terminals and moves.

## Impact

Existing launch/move writes stay unchanged. Focused provider and live-core tests,
capability notes, and an upstream report supply the evidence. No new storage,
view-specific state, dependencies or runtime authority changes.
