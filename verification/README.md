# Behavioral evidence

[`coverage/`](coverage/) maintains the original 43 areas identified by the
[reviewed spike](../docs/quint-adoption-spike.md) and later additions. Each area has
one `<id>.json` file; the existing Q01–Q58 IDs remain stable (Q44 covers adapter
conformance). Shared fields live in `_meta.json`, which contains no area list.
New areas use descriptive lower-case, hyphen-separated slug IDs and matching
filenames, such as `ask-recovery.json`; do not allocate another Q number or edit
a shared index. [`scripts/coverage.ts`](../scripts/coverage.ts) reads the files in
ID order into the same merged inventory shape, including Git baselines before
the split. Source ownership,
current requirements, real tests, accepted source-delivery PRs and the uncovered
transition or evidence boundary are recorded before choosing additional models.
An accepted source PR establishes delivery history, not a proof of every property
in the area. No model does not mean untested; examples do not enumerate every
schedule. Live/platform-dependent tests retain their actual prerequisites.

PR #188 contains the spike at `5d73319b` and its implementation, with
functional commits, bounded review checkpoints and a new final review. This does not carry spike acceptance forward
as approval of expanded models, changed assumptions or activation of the policy.

The baseline references executed CI on the accepted spike. The inventory now has a concrete model, shared-model consumer or justified
alternative for all 43 areas; their bounded contracts and individual mappings are accepted in [review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); accepted PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
[Consumer decisions](consumer-evidence.md) record the rationale and limits. Existing
delivered product changes are not reopened solely to add a formal-model label.

## Coverage decisions

### Three questions before choosing a model

1. Can two writers or independently completing operations affect the same state?
2. Must a unique owner, identity or authority survive reordering, replacement or retry?
3. Can interruption leave ambiguous effects that recovery must distinguish from work never sent?

Derive allowed and forbidden scenarios from the requirements first. Any yes
needs an explicit evidence decision: model the meaningful state space, or name
a cheaper check that exhausts every relevant interleaving and its limits.
Example tests alone are not an exhaustive alternative. Map the real consumers
in `coverage/`; run the complete gate when changing a model-backed owner.
Changing an area's owner also requires the complete gate. The inventory test
validates IDs, filenames and referenced paths, models and tests. For a mechanical
migration, set `COVERAGE_MIGRATION_BASELINE` to a JSON file exported from the
pre-migration Git revision when running
`bun run test scripts/verification-coverage.test.ts` to prove merged-view equality.
This opt-in proof avoids a second maintained inventory or shared checksum.

The [November audit](architecture-audit-2026-11.md) found two instructive cases.
CLI and Settings share a catalogue, so Q54 adds writer/save/failure/retry
exploration and 48 actual service schedules; ordinary runtime leases did not
cover lost updates. By contrast, Q56's immutable settings files have equal
content for equal names: concurrent publication commutes, so real atomic-file
and before/after-failure retry checks cover that preparation boundary cheaply.
Q57 models runtime moves in both directions against source changes, dropped or
reconnected hosts and lost replies, and replays them through the real controller;
the model found two faults, fixed and kept as witnesses
([audit](contracts/agent-move-audit.md)).
The `world-write-path` area models World's one publication and its commands
(room rename first): one revision for every published value, the per-host epoch
fence, compare-and-set, settling only on a read after the acknowledgement, and
browser replicas that hold pending values
([contract](contracts/world-write-path.md)).

The audit also found a **real counterexample**: Q55's stale tap owner can publish
after its ownership check was superseded (#1086). The repaired canonical case requires
positive TLC exploration and actual filesystem conformance; live-owner stealing
remains a rejected fault control. Q55 records that repaired evidence separately
from independent acceptance. Q54's offline CLI witness now requires preservation;
[registry ownership](contracts/connection-registry.md#saved-connection-registry-ownership)
adds independent-process and startup consumers for #1084. A completed gate does
not approve known failures.

- `pending`: assessed but additional executable evidence or its mapping is unfinished.
- `modeled`: a maintained model has a real implementation adapter and explicit scope.
- `shared-model`: a named model's guarantees are connected to this consumer; real
  integration/platform evidence still checks the consumer's additional behavior.
- `alternative-evidence`: direct exhaustive, property, integration, browser or
  platform checks are the selected evidence; the rationale and limits are explicit.

These statuses describe evidence, not independent acceptance. Checkpoint records
separately identify review status and checks required on the candidate branch.
Required checks are not a substitute for review of intended properties.

## Contract and review record

Use [the contract template](contract-template.md) for each coherent model. The
[runtime](contracts/runtime-leases.md), [observation](contracts/browser-refresh.md)
and [allocation](contracts/space-admission.md) foundation contracts instantiate it;
[requirement validity](contracts/requirement-review.md) exercises an intentionally
incorrect requirement. Derive
properties from intended requirements and allowed/forbidden scenarios before using
code to establish transition fidelity. Record separate runtime-generation,
observation-epoch, socket/batch and intent identities where relevant.

Review can conclude that a requirement is unclear, a model is wrong, or code is
wrong. Never weaken a property merely to obtain a green check. Model verification
does not prove code correctness; implementation replay is scoped conformance
evidence. Negative controls establish sensitivity, not requirement validity.

The three accepted spike examples illustrate the template: lifecycle forbids a
retired start restoring readiness; refresh forbids an old observation epoch
publishing; allocation reserves relevant spaces before fair ordinary capacity.
A deliberately wrong lifecycle requirement, “retired starts may make replacement
runtimes ready,” conflicts with runtime federation even if code and tests copy it.
Review rejects that requirement against the qualified-admission scenarios before
accepting a model. Reachability witnesses and the late-start negative control then
check that the intended prohibition is exercised, rather than assumed away.

The [Claude tap ownership contract](contracts/claude-tap-lock.md) adds a bounded
publication/recovery case for issue #1086. Its positive TLC invariant and all
eight actual-filesystem suspension schedules must pass. Age-based live-owner
stealing remains an expected-rejected fault control, rather than a diagnostic
counterexample counted as a safety pass. Unknown process liveness fails closed;
filesystem/platform behavior and numeric privacy retain direct consumer checks.

## Implementation checkpoints

1. Baseline: all 43 areas assessed against existing evidence; every bounded
   model/consumer mapping is independently accepted. Existing repository checks remain required.
2. Tooling: locked inputs, validated traces, bounded processes, reliable drain and
   manifests. No claim of expanded behavioral coverage from installing tools.
3. Lifecycle/observation: expanded transitions and actual replay witnesses; new
   model checks become candidate requirements after their technical criteria pass.
4. Composition/recovery: chunk, terminal/creation and separately scoped Ranger
   evidence; caller authority and user intent remain distinct.
5. Reconciliation: remaining modeled/alternative evidence, contributor/CI policy,
   declared limitations and independent final review of the expanded implementation.

Record concrete coverage, pending work, required commands and acceptance boundaries
with each functional checkpoint. The adoption change is archived after independent final acceptance and owner
approval. Future contract/gate changes require their own applicable review.

## Candidate commands and promotion

The Behavioral verification workflow runs the inventory in
[`quint/models.ts`](../quint/models.ts), including the herdr-core composed and
shared-seen cases, actual replay, required per-seed witnesses, model/implementation fault controls
and larger-bound/host-order sensitivity. It installs locked tooling and the
hash-validated checker, records exact tool/input identities and retains manifests
on success or failure. Missing artifacts, missing witnesses, divergence, checker
errors, timeouts and cleanup failures fail the candidate command. A cancelled run
cannot report success. Evidence from focused `--case` runs cannot substitute for
the unfiltered canonical command.

CI pins Eclipse Temurin JDK 21.0.13+9 for Linux x64 in every shard and the
aggregate, using commit-pinned `actions/setup-java` and its runner tool cache.
Node is pinned to 24.19.0. Java selection is independent of runner image updates;
use that exact distribution and build locally when reproducing CI. Aggregation
continues to require identical full tool identities, including Java patch
versions, across all model evidence.

The canonical run has a 15-minute outer deadline; checker commands have a
240-second deadline. Real SQLite effect replay has a separate 480-second command
deadline; other replay workers retain 30 seconds. Java has a 1 GiB heap and Node has a 512 MiB old-space cap.
These per-process limits are not a measurement of total peak memory. Local complete
execution passed in approximately four minutes after the Ranger additions; Fresh Ubuntu candidate CI passed in 7m11s, with installation taking 6 seconds
and complete model/replay/sensitivity execution 6m46s. These are observed wall
times, not peak-memory or all-platform measurements.
No supplemental exploration substitutes for real consumer/platform/browser checks.

CI calls the maintained behavioral workflow as a protected Delivery checks
dependency whenever the shared scope selects verification: verification/tooling
and OpenSpec inputs, a model-backed inventory owner, an unknown path or a full
main push. Model-free alternative-evidence owners retain consumer tests and the
cheap coverage inventory check instead of every model. Coverage edits affecting
model mappings or schema metadata retain verification; unavailable baseline
information fails closed.
The explicit agent-tooling exception and unrelated ordinary docs skip it. See
[the CI guide](../docs/ci-pipelines.md#shared-suite-plan-and-sharding). Local
pre-push uses the same complete-PR classification for non-browser units only;
browser suites and behavioral verification run in CI. The explicit local
`check:delivery` always runs the complete `verification:gate`.

CI partitions all accepted models across three runners by measured work
(`scripts/verification-timings.json`), retaining the same model inventory and bounds.
The core runtime and IDE lifecycle models each own a runner and run their
independent exhaustive checks two at a time; the third runner takes the rest. Every model still runs
its maintained bounds, replay and sensitivity checks. Partial `ci-shard` artifacts
are not canonical evidence. The final aggregate requires all groups and every
model exactly once, current source/revision and matching tool identities, plus
successful enforced accounting for each group. On a rerun it selects each newest
group attempt; missing, incomplete, duplicate, foreign or mismatched evidence
fails. Only that aggregate publishes canonical success; late cancellation
invalidates publication. The diagnostic, OOM and cancellation controls remain
mandatory on every group runner. Local canonical commands remain unfiltered.

Each Linux CI group executes in an isolated cgroup with hard 4 GiB memory,
zero swap and two CPUs of quota. The explicit local `verification:resources`
command retains one such envelope; ordinary local canonical execution is unchanged.
The CI aggregate preserves all three per-runner accounting records rather than
claiming a single global peak across separate machines. The payload subtree's `memory.peak`, enforced
limits and OOM events are retained, bound to the canonical manifest. An actual
64 MiB over-budget control must be OOM-killed and an actual cancellation control
must drain its worker and descendant before the complete run is accepted.
The service delegates sibling `payload` and `supervisor` cgroups. The hard memory
limit, zero swap and measured peak cover the payload and all its descendants;
the supervisor sits outside that memory envelope so payload-wide OOM kills
cannot destroy its exit notification or accounting. Both siblings share the
service's two-CPU quota. The live OOM regression checks their separate membership,
requires a real OOM kill and retains accounting after the whole payload dies.
`bun run verification:resources` exercises this through a local systemd user manager;
CI uses `--system` and its existing passwordless sudo. Missing cgroup accounting or
unsupported tooling fails rather than silently skipping limits. This establishes
Linux evidence; macOS checker ownership and application/platform tests retain their
own prerequisites. An isolated subtree peak includes the pool and descendants,
unlike per-worker RSS or the runner's lifetime cgroup peak.

Rollback means reverting a reviewed gate/tooling change through normal delivery,
with the affected evidence decision and limitation recorded. Never make checker
errors soft-success, disable a consumer regression or weaken an intended property
to recover a green build. Tool caches and generated traces are ignored and may
be recreated through `verification:setup`; production code does not depend on Quint.

## Content-matched CI evidence

Applicable PR model groups may reuse a complete passing result with the exact
model/adapter/production import closure, tool/lock/workflow and seed hash. Main,
nightly and release executions remain fresh; model inventories, bounds, witnesses,
mutations and replay are unchanged. The shared runner's adapter imports widen
the closure conservatively. Cache misses and invalid evidence execute the entire
group. Original manifests and enforced resource records are retained, and the
aggregate records each group's `ran` or `reused` mode, hash and origin revision/run
while binding the current complete source inventory. Reused evidence never claims
execution on that current revision. See [the CI guide](../docs/ci-pipelines.md#content-reuse-and-test-placement)
for provenance validation, cache visibility and negative/round-trip tests.

## Failure diagnostics and progress review

Node, Java and Git identity probes have a bounded 30-second startup allowance,
share their worker's cancellation, and name the failed command in diagnostics.
This tolerates cold tooling under the enforced two-CPU quota without changing
model deadlines, the complete-run deadline or the hard memory/CPU limits.

The resource preflight's live cgroup tests use the isolated test wrapper without
Chrome warmup. Only selections that can run browser suites warm Chrome in CI;
an unrelated browser startup must not consume the preflight's 45-second budget.

Failed runs retain completed command progress and the failing model/phase in the
incomplete manifest. A curated diagnostic directory contains failure metadata,
checker/replay log tails, the selected request and relevant counterexample/trace.
Logs are capped at 64 KiB each, diagnostic payload at 512 KiB per run, absolute
checkout/home paths and credential-style log values are redacted, and oversized
structured files are omitted explicitly rather than truncated into invalid JSON.
Tools, temporary directories, unrelated traces, symlinks and mutant bundles are
excluded. Source-bound manifests and this diagnostic set are uploaded on failure.

`bun run verification:diagnostic-control` deliberately runs a valid refresh
counterexample as a positive candidate replay, requires the subprocess to fail,
then validates its retained metadata and replays the exported trace to reproduce
`refresh.status`. It runs after the normal unfiltered CI check and cannot replace
it. Downloaded artifacts can be validated with
`bun scripts/verification-diagnostic-control.ts --validate <diagnostic-directory>`.
Rerunning `bun quint/run.ts --case <model>` rebuilds excluded fault
bundles from the tracked sources and locked tools.

[Promotion decisions](promotion-review.md) record independently accepted bounds,
mandatory consumers and excluded claims; Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); accepted PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
The [observation progress assessment](contracts/observation-progress.md) separates
controlled scheduler/deadline evidence from model reachability witnesses and states
the required event-loop, slot-availability and transport-settlement assumptions.

Checker startup now waits for the actual gRPC reflection endpoint and verifies
that the listener belongs to the owned daemon PID before running Quint. The
startup advertisement alone is insufficient: CI reproduced an early-advertisement
race in which Quint tried to launch a second server on the occupied port. Its
downloaded logs identified that failure; delayed-readiness and failed-readiness
regressions preserve the corrected startup and cleanup boundary.

## Bounded parallel execution

The canonical gate schedules the 11 independent cases in a bounded process pool,
starting longer allocation/preparation cases first. `tools/quint/execution.json`
defaults to two workers, capped by available CPUs. This follows the repository's
parallel test-file approach while accounting for JVM-backed checker work. Each
case owns a fresh process, private checker endpoint, generated models, replay
workers and artifact directory; shared fixture/module state stays within a case.
Each case's sensitivity/host-order checks and negative controls remain required.

A case failure stops further admission, cancels active peers, waits for their
owned process cleanup, and leaves an incomplete aggregate with case progress and
diagnostics. The 15-minute overall deadline and 10-second case termination grace
remain bounded. Canonical arguments still reject filtering. Changing the tracked
worker/deadline configuration is an execution-policy change requiring full checks.

Focused worker manifests are explicitly scoped. The complete aggregate requires
exactly one successful result for every canonical model, identical source/tool
identities and current input fingerprints. Missing, duplicate, mislabeled, stale
or incomplete worker evidence cannot become a successful full run. The shared
model registry must match the runner's cases, preventing silent inventory drift.

The first local two-worker run passed in 141.5 seconds, compared with the earlier
complete local run at approximately 243 seconds (about 42% less wall time). This
is a measured comparison of complete executions, not a universal speedup guarantee.
Manifests record actual workers, wall/case times and reported case-process max RSS.
The latter is not simultaneous total memory. Where available, the Linux cgroup
lifetime peak is recorded separately and includes other job/setup processes.
All configured JVM/Node caps and finite/consumer evidence limits remain unchanged.

Three workers with three CPUs of quota did not shorten hosted CI (measured
2026-10-21). Two workers took 293 seconds and three took 295: space-admission,
which bounds the pool, slowed from about 198 to 294 seconds, and every other case
slowed by 30-45%. The cases are CPU-bound on the four-CPU hosted runner, so more
workers only divide the same CPU; peak memory rose from about 1.36 to 1.70 GB.

The first complete constrained local run measured 1,149,575,168 bytes of aggregate
peak memory (approximately 1.07 GiB), with zero OOM kills under the hard 4 GiB limit.
The actual 64 MiB memory control and cancellation/descendant control also passed.
CI repeats the full envelope and controls; future model growth must remain within
those bounds or justify a reviewed envelope change. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); accepted PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.

Resource acceptance rechecks cancellation after accounting, service drain and the
final diagnostic write. Successful child exit is not successful wrapper execution.
The required resource command runs deterministic real-cgroup regressions that abort
a zero-exit child at the accounting and cleanup boundaries; both must reject only
after retaining accounting and draining the service. Running-child/descendant
cancellation and OOM controls remain required. For a local focused regression, run
`HERDR_RESOURCE_MANAGER=user bun run test --live scripts/verification-resources.live.test.ts`;
CI explicitly selects its system manager. Ordinary unit runs report the missing
manager prerequisite rather than claiming live cgroup coverage.

Canonical and focused commands accept evidence only after the final manifest
write and an external cancellation recheck. Cancellation during aggregate
validation/accounting/publication rewrites the manifest as incomplete and retains
failure diagnostics. Focused success output follows publication. Private checker
teardown similarly drains first and checks the external signal before returning.
Deterministic regressions use completed synthetic worker records to isolate
finalization; they do not claim a fresh checker exploration.

## Herdr-core composed contract (Q52)

[herdr-core-runtime](../openspec/changes/archive/2026-11-17-herdr-core-runtime/model.md)
checks bounded ordering, lease and opaque-recovery transitions. Run
`bun quint/run.ts --case herdr-core-runtime` during development; the complete
`bun run verification:gate` retains every case in
[`quint/models.ts`](../quint/models.ts). Required faults, replay witnesses and
production controls are inventoried in
[`quint/herdr-core-cases.ts`](../quint/herdr-core-cases.ts), not a fixed count here.

Replay drives the production `CoreMirror`, World read model, kill plans/refusals,
watch admission/grid adoption, typing session/seat and recipient comparison.
Model faults must violate safety and diverge on correct replay; production fault
controls must be rejected. Capture/dispatch/deliver still has a design seam:
the model compares the source occupant at dispatch, while World can compare only
its observation. Checkout removal and native brief readiness retain the seams
and Bun/live-release consumers described in Q52 of [`coverage/`](coverage/).

Q52 records remaining design/model review, harness/browser/platform acceptance,
and excluded claims, including vendor credentials and Windows transcript reading.
Production replay is scoped conformance evidence; foundation delivery or archiving
the feature does not grant independent model/mapping promotion.

## Herdr-core shared seen (Q53)

[herdr-core-seen](../openspec/changes/archive/2026-11-17-herdr-core-runtime/model.md#shared-seen-issue-868)
models World's share of Herdr's `herdr.seen` label with another client. Run
`bun quint/run.ts --case herdr-core-seen` during development. TLC explores the
whole bounded graph; three seeds replay through the production browser
(`CoreSeenSharer`) and service (`seenToShare`) rules; five model faults must
violate safety and diverge and four production faults must be rejected by a
valid trace. Core's missing compare-and-set (upstream Q7) is the declared
residual. Coverage stays pending independent review and real-device step B.
