## 1. Release pipeline
- [x] Replace manual Prepare/Publish dispatches with one release PR and automatic owner-tag publication.
- [x] Build native packages once, consume exact bytes through channel checks and walk, then seal.
- [x] Use standard immutable artifacts, publication actions, retry recovery and independent Pages.
- [x] Remove signed-in walk and receipt authorization.

## 2. Merge pipeline and service upgrades
- [x] Run PR checks on Linux only with one in-job retry; report main evidence, with independent model-cache warming.
- [x] Add nightly signal and one infrastructure retry; remove automatic revert PRs.
- [x] Reduce hooks and side-workflow noise.
- [x] Persist stable service executable paths and verify running channel upgrades.
- [x] Reconcile the eight audited flaky cases with current fixes and focused evidence.

## 3. Delivery evidence
- [x] Update current release/contributor docs and consumer mappings.
- [x] Add focused recovery/service/policy regressions and map native platform evidence.
- [x] Prepare ready PR handoff against crew/1373.
- [x] Repair exact dispatch overrides in manifest mode, regress workflow/config wiring and RC-to-final tag validation (#1404).
- [x] Apply the owner's patch-by-default strategy, scope the tap token to the release environment, and regress workflow/config wiring (#1404 review).
- [x] Run fresh merge-group Linux validation under Delivery checks, audit side workflows, regress trigger/check identity and no-reuse selection, and document the queue flow (#1404 owner feedback).
- [ ] Owner acceptance: independent review, hosted RC rehearsal and week-long measurements.

## 4. Model lane acceleration (#1443)
- [x] Split heavy models, retain all controls, and use per-model content closures with main-only evidence saves.
- [x] Apply four TLC workers and the approved 400% CPU envelope only to model CI, with unchanged memory/OOM/cancellation enforcement.
- [ ] Verify local gates and hosted fresh/reused timings; record two PR run durations against main baselines.
