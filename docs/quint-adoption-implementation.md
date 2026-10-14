# Accepted Quint adoption implementation

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
rejected. Independent cases now use two isolated workers by default, with
longer cases scheduled first. The first local parallel run passed in 141.5 seconds
versus the earlier approximately 243-second complete run. Complete aggregate
evidence requires all 11 scoped worker results with identical current source/tool
inputs; partial workers cannot satisfy the gate. Cancellation/failure stops queued
work and drains peers. Per-case timings/RSS and available cgroup peak data make
resource assessment explicit without claiming total memory from individual peaks. Focused development uses `bun quint/run.ts --case <model>`.
The maintained models/adapters now live in top-level `quint/`, alongside
`openspec/`. Their locked development dependency package remains in `tools/quint/`.
CI calls the maintained workflow as a protected Delivery checks dependency and
runs all models/controls/sensitivity within a Linux cgroup resource envelope.
Local pre-push runs `check:delivery`, retaining the entire existing repository
suite and requiring locked setup, types/notices, unfiltered verification and the
diagnostic control. Focused evidence cannot replace the aggregate.

## Review checkpoint and completion boundary

[Independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164)
accepts all bounded contracts, every Q01–Q43 consumer/alternative mapping, separate
Ranger storage/recovery assumptions and controlled observation progress. The
[promotion record](../verification/promotion-review.md) retains each mandatory
consumer and excluded claim. Tasks 3.4, 4.3, 5.1 and 5.3 are closed on that basis.

Gate integration, resource limits and subsequent cancellation repairs are independently accepted in reviews 5517392425 and 5517420140, with exact-head CI evidence and owner approval recorded below.
Existing integration, browser, scheduler, persistence and platform checks remain
required. The earlier unexplained browser timing failures remain documented in
PR #188; no limits were weakened. Final expanded approval and merge were separately authorized; archival was subsequently authorized explicitly.

Rollback guidance and current policy are in [behavioral evidence](../verification/README.md).

## Constrained execution checkpoint

The complete relocated pool passed locally under the enforced 4 GiB memory/no-swap
and two-CPU envelope, peaking at 1,149,575,168 bytes (approximately 1.07 GiB)
across the service subtree. No OOM kill occurred. The 64 MiB over-budget control
was actually killed, and cancellation rejected success while draining worker and
descendant. All existing broader-bound and asymmetric host-order checks remain
inside the canonical run. CI repeats this envelope and these controls, retaining
resource JSON linked to its source-bound canonical manifest. These measurements
apply to supported Linux/systemd execution, not every OS or arbitrary model growth.

## Final-review cancellation repair

[Review 5516713547](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516713547)
accepted relocation, gates and normal resource behavior but identified cancellation
after child exit as the remaining blocker. The wrapper now checks cancellation
after mandatory accounting, service drain and diagnostic retention, immediately
before returning. Deterministic real-cgroup regressions cover both accounting and
cleanup windows, requiring zero child exit, retained accounting and cancellation
rejection. Both failed before the fix and pass afterward; the required resource
command runs them in CI. Existing contract acceptance remains intact; final
acceptance of the repaired gate remains separate.

## Accepted delivery and archive

[PR #188](https://github.com/IvoryHeart/herdr-world/pull/188) merged as `481ca1e817bb1fefb7ea1e24fe4adc2a8021333e` after final independent reviews [5517392425](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517392425) and [5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140), owner approval and an explicit merge waiver. [Full CI on reviewed head `4e664ec2`](https://github.com/IvoryHeart/herdr-world/actions/runs/38557803713) passed; its eleven-model/180-command aggregate and retained failure trace were independently validated.

The owner separately authorized [archival](../openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/tasks.md#accepted-completion-and-archival). All rollout tasks are complete. Spec synchronization is a no-op under the approved `skip_specs: true` marker: product capability requirements are unchanged. Earlier checkpoint/repair descriptions document the delivery history, not pending adoption work. Finite bounds, mandatory real consumer/platform tests, storage/crash and conditional-progress assumptions remain binding. Historical unexplained browser timing failures remain documented; passing subsequent runs do not diagnose their cause. Future behavioral/tooling changes require fresh applicable evidence and review.
