Use world-test-behavior to execute every supervisor-owned QA scenario against this candidate.
The source is read-only; use /tmp for cache/output and, where necessary, a temporary test
copy. Do not fix source or tests. Inspect the actual files and execute relevant checks;
the builder's narrative is not execution evidence. No live Herdr or deployment access.
Return results: [{scenarioId, status, evidence}], one per scenario, with exact commands,
observations and source references where appropriate. status is passed, failed or blocked.
Return qa.passed only if every planned scenario passed; qa.failed for reproducible defects;
task.blocked if the environment or an unresolved requirement prevents a meaningful check.
Use oracle.requested for a specific technical question. Report clean results when correct.
