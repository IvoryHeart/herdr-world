## Context

The parent pipeline retries entire test steps, including behavioral checks. Bun JUnit reports identify files, nested case names and failures. CI already retains browser reports.

## Goals / Non-Goals

Recover once at the failed file/case boundary, show each recovered test, and retain one GitHub issue per cause. Do not retry models, other checks, or whole shards. No product/UI changes.

## Decisions

- Opt CI test runners into recovery explicitly. Keep the initial batch and shared browser assets; rerun failed unit files or exact browser case names with the same isolation and tripwire guards. Require positive JUnit evidence of recovery; missing recovery reports, crashes and isolation failures stay red. Successful platform-only files with no cases retain their existing passing result.
- Retain per-batch JSON evidence even on failure. Delivery reads all shard artifacts and includes every recovered file/case in its summary.
- Use a trusted default-branch workflow_run consumer for issue writes; never execute candidate code with its write token. Admit only same-repository source runs before downloading artifacts, and independently verify the source head repository using the Actions API before issue/history/status operations; missing identity fails closed. Serialize tracking globally. Keep distinct run IDs and timestamps in an issue body ledger, preserve owner prose, and deduplicate reruns. Closed issues represent a fix; an owner-applied flaky-quarantined label exempts the frequency limit, not test execution or double failures.
- Delivery checks recorded history plus its current occurrence inside the source job. The trusted consumer publishes only the optional Flaky accounting context, which the ruleset must not require. Late accounting never changes a completed merge verdict; concurrent runs may pass before their combined history is recorded, and subsequent Delivery jobs enforce that history. This replaces the same-named asynchronous Delivery status under #1454.
- Every completed event discovers completed same-repository CI runs within seven-day artifact retention using list response metadata, continuing through short pages until an empty page. Validate source identity before downloading artifacts as data. Final Flaky accounting statuses identify run and attempt and acknowledge durable issue writes. A single issue labelled flaky-accounting caches retained run/attempt receipts in the existing trusted GitHub issue store; settled runs require no individual run/status requests. Preserve owner prose, drop only expired cache entries, and keep occurrence ledgers and commit-status receipts untouched. A missing/closed cache rebuilds from durable commit-status receipts before replaying unreceipted evidence; owner-closed causes are not reopened. No application store or new data file is introduced.
- Bound each event to eight unaccounted runs (trigger first, then oldest misses after the saved batch cursor, wrapping for retries) and 80 API requests, including artifact discovery and archive downloads. Decode archive JSON members without extracting candidate paths. Run-list metadata costs one request per page; accounting API work is proportional to newly processed runs rather than retained runs. This avoids consuming the token bucket shared with Delivery. Cold-start backlogs drain over subsequent completions. Lost issue/status/cache replies can replay writes without acknowledging missing history; final advisory frequency failures also populate the receipt cache. Advance the cursor even for failed batches so missing evidence cannot starve later misses. Continue other runs after individual errors within the batch; retry unfinished work later.
- Real subprocess fixtures and exhaustive short occurrence histories cover recovery, deduplication, threshold boundaries and quarantine. Workflow tests cover privilege separation and model exclusion. Hosted execution remains CI evidence; no new Quint abstraction of GitHub is needed.

## Risks / Trade-offs

Issue/API or evidence errors fail their source Delivery job or optional accounting workflow respectively. Accounting retries on the next completion within artifact retention; evidence already expired cannot be reconstructed. New trusted workflow code starts tracking after it reaches the default branch. Owner quarantine is explicit and reversible; it never suppresses a real repeated failure.

Existing pending/failed Delivery commit statuses belong to their original SHA. During rollout a new PR commit is required to leave them behind; a rerun alone keeps that SHA.
