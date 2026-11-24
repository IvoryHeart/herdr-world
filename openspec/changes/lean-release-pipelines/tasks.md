## 1. Release pipeline
- [x] Replace manual Prepare/Publish dispatches with one release PR and automatic owner-tag publication.
- [x] Build native packages once, consume exact bytes through channel checks and walk, then seal.
- [x] Add automatic wait, expired-seal contract fallback, idempotent publishers and independent Pages.
- [x] Remove signed-in walk and receipt authorization.

## 2. Merge pipeline and service upgrades
- [x] Narrow native selection, remove shim reports, reuse identical main trees and retain Linux gates.
- [x] Add nightly signal and one infrastructure retry; remove automatic revert PRs.
- [x] Reduce hooks and side-workflow noise.
- [x] Persist stable service executable paths and verify running channel upgrades.
- [x] Reconcile the eight audited flaky cases with current fixes and focused evidence.

## 3. Delivery evidence
- [x] Update current release/contributor docs and consumer mappings.
- [x] Add focused recovery/service/policy regressions and map native platform evidence.
- [x] Prepare ready PR handoff against crew/1373.
- [ ] Owner acceptance: independent review, hosted RC rehearsal and week-long measurements.
