## Why

Issue #1382 authorizes one automated release path with three owner steps. Manual authorization and duplicate platform builds delay delivery while failing to test the bytes installed by users.

## What Changes

- Build and seal all release channels on the merged version commit; tags wait and publish that seal, with complete contract checks on expired-seal recovery.
- Keep native agent launch, channel install/upgrade and shipped security checks; remove signed-in authorization and duplicate source/browser release gates.
- Use stable Homebrew service paths and automatically migrate a running old keg service during upgrade.
- Narrow PR native selection, keep one aggregate, reuse identical trees on main, report nightly native failures, retry infrastructure once and retain red-main issues without automatic reverts.
- Make pre-push formatting/privacy only and remove the broken Help/archive bots and filter noisy side workflows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `distribution-boundaries`: reviewed release identity, tested channel bytes, recovery and stable managed-service upgrades.

## Impact

GitHub Actions, release/installer/service tooling, distribution notes, contributor runbooks and Q41/Q36 evidence. No new production data store, runtime ownership or tag authority. Signing, notarization, product test coverage changes and the Town release view stay out of scope. Hosted publication and native upgrades require CI and the owner's RC rehearsal; local tests cannot claim those outcomes.
