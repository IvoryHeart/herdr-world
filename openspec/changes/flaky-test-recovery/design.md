## Context

See proposal.md for the owner's revised #1454 scope. Existing CI test jobs already produce per-batch retry JSON; the existing Delivery job can consolidate their artifacts without starting another workflow.

## Goals / Non-Goals

Keep scoped retry recovery and make every accounting operation informational. Report the latest 24-hour window in one issue. No frequency enforcement, quarantine policy, per-cause issues, receipt cache, per-run trigger or commit status remains.

## Decisions

- Keep the existing JUnit proof and isolation guards. Record attempted retries before executing them, including a second failure. The report retains recovered cases separately. Older reports without the attempted list fall back to their recovered cases during rollout.
- Existing test jobs summarize their runner reports and upload small flaky.json files. Delivery downloads them into separate directories, consolidates the small reports and uploads one artifact per run attempt. All summary/download/upload steps use continue-on-error; there is no token or history lookup in the reporting command. Consolidation avoids daily downloads of every shard.
- The replacement workflow runs once daily at 04:17 UTC or manually on the default branch. Checkout explicitly selects the default branch; no candidate code executes with the issue-write token. Concurrency permits one active and one pending run, coalescing bursts without cancelling the writer. Candidate CI has no issue/status write permissions.
- Discover completed ci.yml runs created within the last 24 hours, continuing through short pages until an empty page. Admit only same-repository head identities with a branch, excluding cancelled/skipped runs before artifact reads. Read only the consolidated delivery artifacts, including retained attempts. Decode only the flaky.json ZIP member without extracting paths; validate test identity, scope and size.
- Recompute a 24-hour snapshot rather than maintaining a mutable occurrence ledger or cursor. Counts deduplicate by test and immutable run/attempt, so replay and discovery order commute. Publish one managed section in a single Flaky tests issue labelled flaky, preserving owner text. Search open and closed issues so lost creation replies cannot cause duplicates; reporting never changes issue closure state. Existing legacy issues and statuses are left intact.
- Artifact read errors do not discard other runs; publish an incomplete-evidence warning and fail only the daily job. A manual rerun recomputes the snapshot. No new application store, table or data file is introduced: reports use existing CI artifacts and the existing GitHub issue store.
- Direct subprocess fixtures cover recovery and ZIP decoding; exhaustive failure subsets cover independent run failures and replay. Workflow tests establish trigger, privilege and non-blocking boundaries. GitHub owns scheduling and merge eligibility, so two hosted PRs and a hosted daily report remain platform acceptance rather than an abstract GitHub model.

## Risks / Trade-offs

- Daily schedule delays or missed days can leave gaps outside the 24-hour window. Seven-day artifacts permit inspection; manual dispatch refreshes the current window. This replaces the former seven-day event catch-up by explicit owner direction.
- A cancelled CI run has no daily accounting; test summaries produced before cancellation remain on its jobs. Reused/docs-only runs have no retry data.
- Rollout activates when the workflow reaches the default branch. Old pending/failed Delivery commit statuses stay on their original SHA; affected PRs need a new commit, since rerunning preserves that SHA.

## Combined execution (#1484)

Keep the sixteen-job graph and browser ownership from #1472. Bring the three-way
core control partition and memory/time packing from #1478 onto the padded
reservations and hard resource envelope. Refill a worker only while its reservation
fits; cancellation stops admission and drains every started part.

A parent-owned file watchdog observes atomic worker markers in the existing run
temporary folder. Native file events and parent timers stay outside fake clocks
and Bun parallel worker contexts. It covers evaluation and all hooks, and names
the file before failing the batch. A regression proves each phase with stopped
clocks in sequential and parallel modes. The watchdog preserves the exact child
command, environment inputs and scheduling arguments; only that wrapper is removed
when comparing scheduling code. No twenty-pair executor or assertion is removed.

Use injected clocks/frames and event completion instead of fixed browser dwells.
Retain the light behaviour renderer and production renderer for pixel/performance
checks. Short polling dwells are also removed. Four real-runtime absence checks remain explicitly explained; no test is
skipped or given a longer timeout to pass. Phase summaries retain native input and
frame work instead of charging unfinished work to a later phase.
