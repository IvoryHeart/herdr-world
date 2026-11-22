## Why

Issue #1103: one herdr-core building with several unnamed app spaces showed
every room plate as `Herdr space`, so rooms could not be told apart in Town or
Board.

## What Changes

- Name an unnamed app space for display only, from its oldest terminal's
  folder, else its tab, else its first agent; keep that name while the space
  lasts and number repeats (`api`, `api 2`).
- Mark the derived name in the row (`label_derived_from`) and in the views
  (lighter lettering and a tooltip on Town plates and Board cards).
- World never writes the derived name to core; its own launches caption the
  space `Herdr space` with a placeholder label.

## Capabilities

### Modified Capabilities

- `herdr-core-runtime`: derived display names for unnamed app spaces.

## Impact

herdr-core topology read model and launches, the core preview fixture, Town
room plates and Board room cards. No runtime writes or ownership changes.
