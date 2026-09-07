Use world-test-behavior to execute every supervisor-owned QA scenario against this candidate.
The source is read-only; use /tmp for cache/output and, where necessary, a temporary test
copy. Run `node /control/scripts/agent/fixture.mjs` once from /workspace and use the printed
directory for web tests/browser fixtures. Dependencies are copied, not symlinked, so Vite
can write its temporary configuration. Keep PLAYWRIGHT_BROWSERS_PATH from the prepared
environment. Rust and complete repository checks also run in the independent verifier.
Do not fix source or tests. Inspect the actual files and execute relevant checks;
the builder's narrative is not execution evidence. No live Herdr or deployment access.
Return results: [{scenarioId, status, evidence}], one per scenario, with exact commands,
observations and source references where appropriate. status is passed, failed or blocked.
Return qa.passed only if every planned scenario passed; qa.failed for reproducible defects;
task.blocked if the environment or an unresolved requirement prevents a meaningful check.
Use oracle.requested for a specific technical question. Report clean results when correct.
