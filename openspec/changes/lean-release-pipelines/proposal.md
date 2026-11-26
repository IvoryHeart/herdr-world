## Why

Issue #1382 authorizes one automated release path with three owner steps. Manual authorization and duplicate platform builds delay delivery while failing to test the bytes installed by users.

## What Changes

- Use release-please simple PR-only preparation from fix/feat titles; delete fragments and custom release preparation.
- Build and test native bytes once on the owner tag; seal with standard Actions artifacts and publish with standard GitHub/npm/Homebrew tools.
- Keep native agent launch, channel install/upgrade and shipped security checks; remove signed-in authorization and duplicate source/browser release gates.
- Use stable Homebrew service paths and automatically migrate a running old keg service during upgrade.
- Run required PR checks once on Linux with one failed-test retry inside the job; main only reports PR evidence. Keep one aggregate, nightly native signal and main-red issues without automatic reverts.
- Make pre-push formatting/privacy only and remove the broken Help/archive bots and filter noisy side workflows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `distribution-boundaries`: reviewed release identity, tested channel bytes, recovery and stable managed-service upgrades.

## Impact

GitHub Actions, release/installer/service tooling, distribution notes, contributor runbooks and Q41/Q36 evidence. No new production data store, runtime ownership or tag authority. Signing, notarization, product test coverage changes and the Town release view stay out of scope. Hosted publication and native upgrades require CI and the owner's RC rehearsal; local tests cannot claim those outcomes.
