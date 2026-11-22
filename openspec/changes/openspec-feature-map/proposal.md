## Why

Hand-edited feature references and source maps duplicate contracts and cause merge conflicts. OpenSpec capability specs and notes become the discovery source.

## What Changes

- Use native OpenSpec capability and active-change listing as the single agent discovery route, then capability specs, notes and their Code paths.
- Require each changed source to match notes Code paths; update those paths in the feature PR without waiting for archival. Retire the hand-written knowledge map and the separate agent lookup command.
- Move usage prose into capability notes and generate the ignored FEATURES.md and public feature reference at site build.
- Feature PRs use change-folder deltas. A post-main bot PR applies and archives completed changes in merge date order, stopping on conflict.

## Capabilities

### Modified Capabilities

- `distribution-boundaries`: capability discovery and reviewed contract synchronization.

## Impact

Contributor scripts, source coverage and PR policy, documentation site generation, capability usage notes and one archive workflow. No runtime or browser behavior change; no preview.

## Owner-directed revision (#1241)

Native OpenSpec discovery replaces the separate lookup after navigation evaluation
showed little use and missed active features. Public feature rendering stays in
the Pages build; shared notes parsing serves build and source-ownership checks only.
The public reference is generated output, not another agent knowledge entry point.
