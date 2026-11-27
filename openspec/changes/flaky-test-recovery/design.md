## Context

The parent pipeline retries entire test steps, including behavioral checks. Bun JUnit reports identify files, nested case names and failures. CI already retains browser reports.

## Goals / Non-Goals

Recover once at the failed file/case boundary, show each recovered test, and retain one GitHub issue per cause. Do not retry models, other checks, or whole shards. No product/UI changes.

## Decisions

- Opt CI test runners into recovery explicitly. Keep the initial batch and shared browser assets; rerun failed unit files or exact browser case names with the same isolation and tripwire guards. Require positive JUnit evidence of recovery; missing recovery reports, crashes and isolation failures stay red. Successful platform-only files with no cases retain their existing passing result.
- Retain per-batch JSON evidence even on failure. Delivery reads all shard artifacts and includes every recovered file/case in its summary.
- Use a trusted default-branch workflow_run consumer for issue writes; never execute candidate code with its write token. Admit only same-repository source runs before downloading artifacts, and independently verify the source head repository using the Actions API before issue/history/status operations; missing identity fails closed. Serialize tracking globally. Keep distinct run IDs and timestamps in an issue body ledger, preserve owner prose, and deduplicate reruns. Closed issues represent a fix; an owner-applied flaky-quarantined label exempts the frequency limit, not test execution or double failures.
- Delivery checks recorded history plus its current occurrence inside the source job. The trusted consumer publishes only the optional Flaky accounting context, which the ruleset must not require. Late accounting never changes a completed merge verdict; concurrent runs may pass before their combined history is recorded, and subsequent Delivery jobs enforce that history. This replaces the same-named asynchronous Delivery status under #1454.
- Every completed event reconciles completed same-repository CI runs within seven-day artifact retention, oldest first. Validate source identity before downloading each run's artifacts as data with GitHub CLI. Final Flaky accounting statuses identify run and attempt and serve as durable receipts after issue writes; interrupted writes have no receipt and idempotently recover on the next completion. Read all retained attempts, deduplicate occurrences by run, paginate runs/statuses/artifacts and continue independent runs after errors. A final advisory failure also acknowledges completed history writes. No new checkpoint store is needed.
- Real subprocess fixtures and exhaustive short occurrence histories cover recovery, deduplication, threshold boundaries and quarantine. Workflow tests cover privilege separation and model exclusion. Hosted execution remains CI evidence; no new Quint abstraction of GitHub is needed.

## Risks / Trade-offs

Issue/API or evidence errors fail their source Delivery job or optional accounting workflow respectively. Accounting retries on the next completion within artifact retention; evidence already expired cannot be reconstructed. New trusted workflow code starts tracking after it reaches the default branch. Owner quarantine is explicit and reversible; it never suppresses a real repeated failure.
