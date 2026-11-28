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

Use measured whole-part durations from run 46155401222 rather than checker-only
estimates, accounting for the diagnostic control in initial placement as well as
refinement. Keep every padded memory reservation. Combined runners publish their
actual lane outcomes independently; Delivery also requires the runner verdicts,
so one web timeout cannot impersonate unit/static/security failures or hide a
setup/artifact failure. The 41-context uiScale file runs in disjoint browser-only
case groups, with a complement for future names and separate JUnit/retry receipts,
under the unchanged file deadline. The unit executor remains unchanged.

Download all attempts' combined-runner receipts into separate artifact directories.
Select the newest whole receipt per shard; reject duplicate shard/attempt pairs,
missing shards and invalid outcomes. This supports partial reruns without filling
a newer missing or failed lane from older evidence. Delivery retains full commit
history with blob filtering; historical source blobs are not needed for its
source-name comparisons and current-tree fingerprints.

Admit all three existing World case workers in CI. Native tracing remains
exclusive across the shared Chrome, while behaviour cases may use the other
slots. Locally retain the CPU-count bound capped at eight: larger batches queue
behind native tracing beyond existing case deadlines. Keep all assertions,
per-case and per-file deadlines, model memory reservations and CI job counts.
Retain raw fixture/context phase records with JUnit. Admission wait is not scene
execution and must not be double-counted when refreshing scheduling estimates.
Standalone capture tools join an existing managed Chrome or own one queued
session, with isolated contexts and explicit disposal. Golden repetitions share
one owner. Smoke, warm-up and hardware probes use the same native launch module.

A parent-owned file watchdog observes atomic worker markers in the existing run
temporary folder. Native file events and parent timers stay outside fake clocks
and Bun parallel worker contexts. It covers evaluation and all hooks, and names
the file before failing the batch. A regression proves each phase with stopped
clocks in sequential and parallel modes. A deadline or cancellation retires the
owned POSIX process group, including nested test and Chrome descendants; a pipe
closure regression verifies that the supervisor cannot exit leaving them alive.
Fixture completion receipts work even when Bun's agent reporter hides pass lines.
The watchdog preserves the exact child
command, environment inputs and scheduling arguments; only that wrapper is removed
when comparing scheduling code. No twenty-pair executor or assertion is removed.

Use injected clocks/frames and event completion instead of fixed browser dwells.
Retain the light behaviour renderer and production renderer for pixel/performance
checks. Short polling dwells are also removed. Four real-runtime absence checks remain explicitly explained; no test is
skipped or given a longer timeout to pass. Phase summaries retain native input and
frame work instead of charging unfinished work to a later phase.

Snapshot projection yields through an injected native task-turn port rather than
the elapsed-time scheduler. Manual fixture time may stay stopped while I/O makes
progress; lease validation still follows the yield. Real snapshot regressions
cover stopped scheduling and retirement during a held construction turn.

## Root-cause testing (#1487)

Checker supervision takes process and time ports. Logic cases use a resistant
fake group with inherited pipes and a manually advanced clock; two native port
sanity cases retain stdout/status and real process-group drain evidence. Runtime
startup is observed before advancing a simulated timeout. Usage inventory fixtures
set timestamps and mtimes explicitly instead of racing file creation against a
module-evaluation timestamp. Test discovery stays within each case's folder unless
peers explicitly select one scratch registry, on every platform.

Chat delivery deadlines likewise use the injected clock/scheduler and await an
observable completion callback instead of a fixed number of IO turns. The shared
scheduler retains optional unref so the production process lifetime is unchanged.

The native Town frame/raster suite moves intact from behaviour shards to the
existing latency workflow's performance lane. Three serial runs must each pass
quiet CPU admission and every original budget; no retry or averaging hides failure.
The workflow remains advisory and adds no runner job. Explicit browser paths must
report the reviewed Chrome version before fixtures start.

The dense production-context reproduction exposed a positive feedback loop:
independent real-time input continues for longer on slower rendering, generating
an increasingly large RPC backlog. Functional production/concurrent runs use 16 ordered native key
pairs per phase through the same CDP/Bridge boundary and retain every assertion,
work ceiling and the 5,000 ms RPC deadline. Unit tests control completion and
failure with promises. Latency/tracing retains the original independent 75 ms
producer; latency CI requires quiet admission. This changes workload scheduling,
without removing the native workload or substituting a product/view workaround.
