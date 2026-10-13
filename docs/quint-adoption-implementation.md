# Quint adoption implementation candidate

PR #188 remains the implementation PR built on the independently reviewed spike
at `5d73319b`. The owner authorized repository-wide assessment and maintained
models wherever useful ordering, ownership, authority or recovery exploration
warrants them. Spike acceptance does not approve this expanded implementation.

## Delivered evidence

All 43 stable inventory entries now have explicit requirements, owners, accepted
source delivery, existing tests and a model/shared-consumer/alternative decision.
[Coverage](../verification/coverage.json), [contracts](../verification/contracts/)
and [consumer decisions](../verification/consumer-evidence.md) preserve each
scope and exclusion. Status describes evidence, not independent acceptance.

Eleven models cover runtime leases, administrative lifecycle, delayed drain,
browser refresh/preparation, allocation, socket credits, chunk assembly,
creation/attachment/conditional focus, Ranger captured action authority and
SQLite durable identity recovery. Replay invokes real implementations over owned
synthetic transports/directories. Separate identities remain explicit in the
[composition record](../verification/composition.md).

The complete candidate run passes finite TLC checking, 6,900 baseline generated
production replays across three seeds and 3,900 larger-bound replays. Allocation
also executes all 5,103 configurations for each of six asymmetric host orders.
Per-seed actual witnesses are measured separately from simulator witnesses.
Required model and compiled implementation faults fail at named observations;
unrelated parsing, adapter, timeout or cleanup failures abort the run.
These counts describe bounded executions, not unique production schedules or
whole-system correctness. Successful witnesses do not prove temporal progress.

The 62-case direct drain matrix, stage-interruption/priority tests, actual
sender/admission/Bridge/store composition and real creation/handoff browser tests
retain consumer evidence. Window command orderings use a documented direct
exhaustive two-owner reducer alternative through five commands, with an
independent property oracle and a deliberately wrong peer-hide control.

Ranger focused replay and its 17 direct tests pass. Six real context/action/task/
storage/service/durable-storage suites pass 385 tests. The interrupted-recovery
integration suite passes five tests, including SIGKILL/SIGTERM recovery, independent
scheduled runs and cancellation across restart. SQLite rollback/reopen is real;
it is not a power-cut proof. Recovered running rows do not themselves authorize
execution, and external side effects do not acquire exactly-once semantics.

## Actual-delivery audit

The four referenced deliveries were checked as merged, not inferred from open
planning documents. Their existing requirements/fixtures/regressions supply the
starting evidence; adoption does not reopen their product work just for a label.

| Delivery | Contract assessed | Evidence correction or remaining boundary |
| --- | --- | --- |
| [#145 simultaneous multi-host operations](https://github.com/IvoryHeart/herdr-world/pull/145) | Runtime generation, explicit routing, observation and concurrent contexts | Runtime, browser epoch, transport epoch and resource identity must stay distinct. Model expansion caught an incorrect abstraction: stopping after failed cleanup with no runtime clears state without the extra generation increment initially assumed. The model was corrected to the actual required transition; no production defect was claimed. |
| [#175 creation across World views](https://github.com/IvoryHeart/herdr-world/pull/175) | Ownership preparation, colliding IDs, qualified mutation and result/focus admission | Mutation success cannot override newer Inspector/navigation intent. Real browser consumer tests remain mandatory alongside the creation model; attachment advertisement alone is insufficient. |
| [#182 Ranger and World ownership](https://github.com/IvoryHeart/herdr-world/pull/182) | Captured task/workspace permission and durable identity | Runtime readiness is insufficient for writes; restored identity is insufficient for permission. SQL rollback and actual killed-process recovery remain separate evidence with explicit local-storage assumptions. |
| [#186 upstream synchronization](https://github.com/IvoryHeart/herdr-world/pull/186) | SSH/platform supervision, protocol compatibility and supported distribution | Abstract runtime models do not prove Windows/OpenSSH behavior or release artifacts. Existing platform/process/packaging evidence is retained with prerequisites stated. |

Additional gate findings were corrected: 100 exported traces sometimes missed
actual conditional-priority/creation witnesses even when simulator counts were
positive, so those cases replay 500 per seed rather than waiving witness coverage.
The first symmetric credit domain exceeded its bounded checker deadline; the
smaller asymmetric domain and its exclusions are documented, not presented as
the failed larger proof. Compiled creation controls share actual module/class
identities to avoid testing a disconnected singleton. Behavioral-contract Markdown
could bypass full gates; CI and pre-push classification now prevent that shortcut.
These findings demonstrate abstraction/adapter/gate sensitivity, not a measured
reduction in production defects.

## Maintained tooling and CI

The isolated locked Quint 0.33.0 development graph and hash-pinned Apalache 0.62.1
checker do not alter application dependencies. The runner launches the verified
JAR directly and waits for gRPC reflection plus listener ownership before Quint
connects. The repaired failure artifact exposed an early-advertisement startup
race in CI; delayed/failed-readiness tests and a real checker rerun verify the fix. Owned process groups, deadline/abort handling, bounded output,
validated traces and source/input-fingerprinted completion manifests prevent
stale, partial or failed runs being reported as success. Generated artifacts and
local environment data remain ignored.

The unfiltered canonical entry point is `bun run verification:check`; filters are
rejected. Focused development uses `bun experiments/quint/run.ts --case <model>`.
The candidate CI workflow installs locked tools, checks types/notices, runs all
models/controls/sensitivity and retains manifests even on failure. It has no PR
label/path shortcut. Local complete execution takes approximately four minutes;
Fresh Ubuntu candidate CI passed in 7m11s: locked installation 6 seconds and
model/replay/sensitivity 6m46s. Broader supported-runner and peak-memory evidence
remain outside that measurement.
Java heap is bounded to 1 GiB, Node old space to 512 MiB, each checker command to
240 seconds and the complete command to 15 minutes. These are configured limits,
not total peak-memory measurements.

## Review checkpoint and completion boundary

Existing repository/browser/platform checks remain required. All inventory choices
are concrete candidates for independent review, with alternative rationales and
consumer assumptions visible. The candidate formal workflow is deliberately
separate from protected Delivery checks until task 3.4's independent promotion
review accepts requirements, mappings and exclusions. Final activation must wire
accepted checks into local/CI gates; it must not reuse spike approval.

[Contract-specific promotion records](../verification/promotion-review.md) and the
[observation progress assessment](../verification/contracts/observation-progress.md)
now state pending decisions and scheduler assumptions explicitly. Runtime drain
includes both startup await boundaries with independent guard controls. Failed
runs retain bounded sanitized diagnostic artifacts, and an intentional failing
candidate tests that those artifacts reproduce the named mismatch.

Review focus is intended-property validity, abstraction completeness, real replay
fidelity, distinct authority identities, witness coverage, fault controls,
cleanup and the adequacy of alternatives. Ranger storage/consumer assumptions
need their separate acceptance. CI resource evidence and any review findings are
remaining work. The active OpenSpec change is not archived or declared accepted.
Rollback guidance and current policy are in [behavioral evidence](../verification/README.md).
