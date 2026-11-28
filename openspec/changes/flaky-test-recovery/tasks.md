## 1. Recovery

- [x] 1.1 Preserve scoped in-job retry and positive JUnit/isolation proof; record all attempted retries, including persistent failures.
- [x] 1.2 Keep model/static/privacy/description checks outside retry recovery.

## 2. Revised accountability (#1454)

- [x] 2.1 Replace frequency/history gate with informational summaries and small flaky.json artifacts inside existing jobs; make every reporting step non-blocking.
- [x] 2.2 Replace workflow_run triggers and all commit statuses with one daily schedule and default-branch manual dispatch, coalescing concurrent reports.
- [x] 2.3 Update one Flaky tests issue from the last 24-hour same-repository run artifacts; deduplicate attempts, preserve owner prose, exclude cancelled/skipped/fork/unidentified sources, continue short pages and show incomplete evidence.

## 3. Delivery

- [x] 3.1 Update CI docs/ruleset notes, capability Code paths and verification mapping; validate OpenSpec and focused checks. Local delivery additionally requires the full unit inventory, quick typecheck and complete verification gate.
- [ ] 3.2 Independent review and owner acceptance after merge: two real PRs become mergeable when Delivery succeeds without pending Delivery commit statuses or per-run Flaky test tracking runs; the daily report lists retried tests and run links.

## 4. Combined execution (#1484)

- [x] 4.1 Combine the sixteen-job base, shared browser and demand-rendered fixtures with three-way core model controls and memory-bounded packing.
- [x] 4.2 Migrate fixed fixture waits, explain remaining real-runtime absence checks, and add stopped-clock file watchdog regressions plus phase summaries.
- [ ] 4.3 Complete local delivery and record timing, assertion/skip inventory, threshold changes and unresolved performance limits in the PR.
- [ ] 4.4 FirstMate independently verifies green hosted execution, literal job start offsets and the six-minute wall target before merge.
