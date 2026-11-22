## Why

Hand-edited feature references and source maps duplicate contracts and cause merge conflicts. OpenSpec capability specs and notes become the discovery source.

## What Changes

- Compute `bun run where` text/JSON lookup from capability names, Purpose, requirement names and notes.
- Require each changed source to match notes Code paths; retire the hand-written knowledge map.
- Move usage prose into capability notes and generate the ignored FEATURES.md and public feature reference at site build.
- Feature PRs use change-folder deltas. A post-main bot PR applies and archives completed changes in merge date order, stopping on conflict.

## Capabilities

### Modified Capabilities

- `distribution-boundaries`: capability discovery and reviewed contract synchronization.

## Impact

Contributor scripts, source coverage and PR policy, documentation site generation, capability usage notes and one archive workflow. No runtime or browser behavior change; no preview.
