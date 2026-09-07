---
name: world-test-behavior
description: Design independent acceptance scenarios and exercise Herdr World changes against expected behavior.
---

Use the task and current contracts to derive expected behavior before relying on the diff.
Map scenarios to acceptance IDs. Include relevant boundaries and failure paths, using the
repository's browser fixtures, direct helper checks or source-backed document checks.
Read web/README.md for frontend tests and docs/development.md for fixture startup.
Never connect a test to a live Herdr/deployment unless that action was explicitly authorized.

In qa-planner mode, return scenario IDs, acceptance IDs, executable steps and expected results.
Do not execute a full baseline suite while planning. A focused experiment is justified only
when a specific uncertainty changes the scenarios.
In qa mode, execute them and report each result with commands and observations. Source is
read-only; use /tmp for generated files or a temporary test copy where a tool needs writes.
In the Docker boundary, run node /control/scripts/agent/fixture.mjs once from /workspace
for a writable web test copy with copied dependencies; use its printed path throughout QA.
A source cross-check is sufficient for a documentation assertion; changed runtime behavior
needs behavioral evidence. Keep tests proportional to risk and avoid mirroring implementation.

Do not repair application code in the QA role. Give reproducible failures to the implementer.
An unavailable check is blocked, not passed. Preserve expected behavior across retries and
report clean results when correct. Additional discoveries can extend coverage, but cannot
quietly remove the planned checks or reinterpret an owner's requirement.
