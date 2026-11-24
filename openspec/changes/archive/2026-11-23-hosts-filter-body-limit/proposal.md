## Why

The archive of `hosts-filter-machines` (#1215) left the "Hosts filter lists
machines" requirement body at 927 characters, over the 500 that
`scripts/openspec-feature-map.test.ts` allows, so main failed its own checks.

## What Changes

- Move the requirement's naming, status, shared-menu, stored-selection and
  view-only rules, wording unchanged, into a "Hosts filter acceptance rules"
  scenario. The contract itself does not change.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `world-surfaces/shell-navigation`: restructures "Hosts filter lists
  machines" without changing its behavior.

## Impact

Documentation only. No code, storage or runtime behavior changes.
