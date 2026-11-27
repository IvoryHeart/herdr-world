## 1. Recovery

- [x] 1.1 Add scoped retry runner and real subprocess regressions for recovered, permanent and missing-evidence failures.
- [x] 1.2 Replace whole-step retries and remove model retries; validate workflow wiring.

## 2. Accountability

- [x] 2.1 Add Delivery summary, issue-ledger tracking and seven-day enforcement with deduplication, boundary and quarantine tests.
- [x] 2.2 Add trusted serialized tracker workflow and test its authority boundary, including fork/missing source identity rejection before downloads and repository writes.
- [x] 2.3 Separate optional Flaky accounting from required Delivery checks and reconcile missed/interrupted retained runs using durable attempt receipts (#1454); bound API work using a rebuildable issue receipt cache and short-page regressions.

## 3. Delivery

- [x] 3.1 Update pipeline guidance, capability notes and verification consumer mapping; validate OpenSpec and focused checks.
- [ ] 3.2 Owner acceptance: independent review, then inspect two real PRs after merge for immediate merge eligibility after Delivery succeeds, no pending Delivery commit status, and history recording both runs.
