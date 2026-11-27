## Context

The parent pipeline retries entire test steps, including behavioral checks. Bun JUnit reports identify files, nested case names and failures. CI already retains browser reports.

## Goals / Non-Goals

Recover once at the failed file/case boundary, show each recovered test, and retain one GitHub issue per cause. Do not retry models, other checks, or whole shards. No product/UI changes.

## Decisions

- Opt CI test runners into recovery explicitly. Keep the initial batch and shared browser assets; rerun failed unit files or exact browser case names with the same isolation and tripwire guards. Require positive JUnit evidence of recovery; missing recovery reports, crashes and isolation failures stay red. Successful platform-only files with no cases retain their existing passing result.
- Retain per-batch JSON evidence even on failure. Delivery reads all shard artifacts and includes every recovered file/case in its summary.
- Use a trusted default-branch workflow_run consumer for issue writes; never execute candidate code with its write token. Serialize tracking globally. Keep distinct run IDs and timestamps in an issue body ledger, preserve owner prose, and deduplicate reruns. Closed issues represent a fix; an owner-applied flaky-quarantined label exempts the frequency limit, not test execution or double failures.
- Delivery checks the last seven days plus its current occurrence. The trusted serialized consumer also enforces the resulting history on the source commit using the Delivery checks status, closing the race between concurrently finishing runs. A failed source run never receives a passing status.
- Real subprocess fixtures and exhaustive short occurrence histories cover recovery, deduplication, threshold boundaries and quarantine. Workflow tests cover privilege separation and model exclusion. Hosted execution remains CI evidence; no new Quint abstraction of GitHub is needed.

## Risks / Trade-offs

Issue/API or evidence errors fail closed. New trusted workflow code starts tracking after it reaches the default branch. Owner quarantine is explicit and reversible; it never suppresses a real repeated failure.
