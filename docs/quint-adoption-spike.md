# Quint adoption spike

## Analysis summary and decision status

**Recommendation: assess behavioral evidence repository-wide and adopt Quint
selectively where exploring event orderings adds value, with independently
reviewed model boundaries and implementation evidence.**
Promote executable models into required checks as their implementation connections
and assumptions become reviewable. The spike itself remains experimental; this
report proposes a policy and does not enact it. The
[adoption proposal](../openspec/changes/adopt-quint-behavioral-verification/proposal.md)
and its design/tasks define the reviewable implementation plan.

Broad adoption requires careful, selective modeling and review before promotion.
An incorrectly specified requirement, copied implementation bug or omitted
transition can pass verification. The proposal makes those risks explicit and
requires independent property review, assumption scrutiny, non-vacuous witnesses
and implementation evidence; fault sensitivity alone cannot establish intended
behavior.

The original recommendation of “selective and opt-in” conflated two decisions:
whether the repository should use Quint systematically, and whether every module
should have a model or every change should run a checker. There is no technical
reason to restrict Quint to the three areas tested here. Its applicability extends
to ownership, permissions, persistence, cancellation, protocol states, resource
limits, structural invariants and some pure algorithms. What should vary is the
model boundary and evidence required, not whether a subsystem is eligible.

The evidence supports feasibility: three different models verified, generated
traces matched real code, and those traces detected deliberate implementation
faults. It does not yet establish repository-wide coverage, reduced production
defects, long-term resistance to model drift, or the appropriate gate for every
area. Review should address those distinctions before making a universal mandate.

This is an experiment, not a new product contract or a mandatory development gate.
The inventory covers maintained service, browser, shared protocol and delivery
ownership in the knowledge map and foundation guide. It lists plausible modeling
boundaries rather than every individual function. A high rank means a valuable
state/order property exists; it does not establish a defect or justify modeling
the whole subsystem.

## Inventory before selection

Use **A** for strong candidates, **B** for selective candidates, and **C** where
ordinary tests currently look more direct. Safety means a bad state is unreachable;
progress requires explicit environment and fairness assumptions.

| Area and source owner | Candidate properties | Rank and boundary |
| --- | --- | --- |
| Runtime lifecycle: `server/src/connections/manager.ts` | Retired leases never recover; stop/start work coalesces; shutdown prevents peer restarts; removal drains before forgetting | A: async state machine; model transport and cleanup separately |
| Profile service and persistence: `server/src/connections/profile-service.ts`, `profiles.ts` | Replacement uses the new factory; retries are host-local; persisted catalogue and default remain consistent | A/B: transitions valuable; JSON validation belongs in tests |
| SSH supervision: `server/src/connections/ssh-profile-runtime.ts` | Late process exits cannot retire a replacement; cancellation drains owned processes; bounded retries | A: abstract OpenSSH, do not model cryptography or OS process internals |
| Subscriptions: `server/src/connections/subscription-loop.ts` | Single owned subscription; cancellation prevents old events; recovery does not overlap owners | A: ordering and resource lifetime |
| RPC/HTTP routing: `server/src/connections/rpc-routing.ts`, `http-routing.ts` | Captured host/generation remains the dispatch owner; no fallback after explicit rejection | A: separate explicit qualified routes from legacy omission semantics |
| Terminal attachment: `server/src/bridge/terminal-bridge.ts`, `endpoint-terminal-session.ts` | Colliding IDs remain isolated; detach/reuse cannot cross owners; retired frames ignored | A: protocol states, not terminal pixels |
| Terminal input/reconnect: `web/src/terminalConnection.ts`, `api.ts` | Uncertain input/mutations are not replayed; response IDs and connection epochs remain isolated | A: record uncertainty, not pretend to guarantee exactly-once delivery |
| Terminal composition/touch/clipboard: `web/src/terminalComposition.ts`, `terminalInput.ts`, selection and clipboard modules | Composition commits once; selection gestures cannot also dispatch input; clipboard completion stays with its captured terminal | B: event-order model; native IME and browser gestures still need platform tests |
| Terminal composer and shortcuts: `web/src/terminalComposer.ts`, `terminalComposerCommands.ts`, shortcut bindings | Preview, submit and cancellation preserve the owning pane; repeated input cannot accidentally duplicate dispatch | B: input state machine, not shell-command correctness |
| Aggregate observation: `server/src/world/snapshot.ts` | Four-slot bound; deadline yields full catalogue; late result requires current lease; requests coalesce | A: logical deadline model; wall-clock responsiveness still needs real tests |
| Observation scheduling: `server/src/world/snapshot.ts` | Priority hosts cannot permanently displace background hosts | A: progress only under stated slot-completion/fairness assumptions |
| Snapshot chunk credits: `server/src/bridge/world-snapshot-admission.ts` | Two transfers per socket; one pending credit per transfer; wrong socket/index cannot release it; retirement rejects waiters | A: small independently replayable protocol |
| Chunk assembly: `web/src/worldSnapshotDecode.ts`, `shared/worldSnapshotChunks.ts` | Mixed batches cannot assemble; resource bounds; duplicate/missing/out-of-order chunks are handled safely | A/B: protocol sequences plus parser fuzzing |
| Browser aggregate refresh: `web/src/world/runtimeStore.ts` | One request in flight; invalidations coalesce; old epoch cannot publish; disconnect revokes actionability | A: independently drive request completion and lifecycle |
| Focused operational contexts: `web/src/store.ts`, `useConnectionClient.ts` | Host focus/filter changes do not retarget operations; retirement affects only its owner; global disconnect retires all | A: isolate a slice rather than model the entire store |
| Resource caches: `web/src/workspaceResource.ts`, Inspector resources | Cached results cannot cross connection/checkout/generation; old fetch cannot repopulate replacement cache | A/B: worthwhile for shared invalidation protocols |
| Creation coordination: `web/src/creationRequests.ts`, `worldCreation.test.ts` | Preparation/readiness/completion stay qualified; duplicate triggers and delayed replies do not select another terminal | A: saga-like transitions; actual creation remains external |
| Watchlists: `server/src/world/watchlist.ts`, `web/src/world/watchlistStore.ts` | Qualified watches remain distinct; bounded admission; removed owners do not reappear via old replies | A/B: service/browser reconciliation |
| Presentation capacity: `web/src/world/spaceAdmission.ts`, Tree/Graph projection | Relevant ancestry reserved; bounded unique output; ordinary hosts receive round-robin capacity | B: finite combinatorics; good comparison with property-based tests |
| Shared entity identity: `web/src/world/worldObject.ts` | Same native ID on different hosts never aliases; child ancestry and omission counts stay consistent | B: algebraic model; projection tests still needed |
| Window arrangements: `web/src/world/windows/windowManager.ts` | Focus references a live window; minimize/restore preserves geometry; closed windows cannot regain focus | B: finite UI state machine; DOM focus needs browser evidence |
| Tab/pane layout, pins and reorder: `web/src/tabLayout.ts`, `visibleTabLayout.ts`, `tabPins.ts`, `tabReorder.ts` | Every live pane has one valid position; pin/reorder/close preserve membership and qualified identity | B: structural invariants; geometry needs ordinary tests |
| Inspector intent and navigation: `web/src/world/worldInspectorSelection.ts`, `browserNavigation.ts` | Selection survives only for exact owners; delayed opens cannot override later intent | B: navigation races, not visual appearance |
| Desk receipts and review marks: `web/src/world/handoffs.ts`, `server/src/agent/turn-receipt.ts` | New turns invalidate old review marks; dedup and bounded observation; receipts remain session-qualified | B: receipt lifecycle; summarization accuracy stays outside model |
| History/task/checkout reports: `server/src/agent/`, `server/src/herdr/` | Atomic publication and session identity; old reports cannot overwrite newer state | B: abstract publication; content parsing needs fixtures |
| Ranger turns and recovery: `server/src/assistant/service.ts`, `durable-storage.ts` | Accepted turns persist before execution; cancellation/recovery cannot double-run; context stays captured | A: persistence/crash transitions; model actual durability assumptions |
| Assistant task scheduling: `server/src/assistant/tasks.ts`, `task-schedule.ts` | One active run; pause/delete blocks future dispatch; missed runs and restart have defined semantics | A/B: lifecycle model; timezone/DST math better tested against calendar cases |
| Assistant tool actions: `server/src/assistant/actions.ts`, `context.ts` | Approval/context validity checked at dispatch; cancellation cannot redirect tool effects | A/B: admission states, not model reasoning quality |
| Task notifications and Web Push: `server/src/notifications/`, `web/src/taskPush.ts` | Session ownership and dedup; unsubscribe/auth retirement stops later delivery; deep link remains qualified | B: delivery cannot promise exactly once without external guarantees |
| Browser authentication: `server/src/http/auth.ts`, `browser-admission.ts` | Expiry/revocation blocks later admission; PIN retry limits; policy modes have no accidental bypass | B: finite policy model; do not claim cryptographic or exploit proof |
| Files/uploads/previews: `server/src/workspace/files.ts`, `file-paths.ts` | Captured roots/owners survive async work; partial upload cleanup; preview admission has no authority escalation | B/C: path and symlink semantics need filesystem tests/fuzzing |
| File search and annotation drafts: `web/src/fileSearch.ts`, `annotations.ts`, file/diff resource stores | Superseded queries cannot publish; draft edits survive unrelated refresh; host/checkout changes cannot misapply edits | B: stale-result and draft lifecycle slices |
| Git actions/auto-sync: `server/src/workspace/git-actions.ts`, `auto-sync.ts` | Per-repository serialization; cancellation preserves user changes; late status cannot cross checkout | B: abstract Git transitions; real Git behavior needs integration tests |
| Worktree create/remove/hooks: `server/src/worktree/` | Partial failure leaves recoverable state; removal cannot target another checkout; hooks run only at valid stages | B: transactional workflow; test actual filesystem and Git effects |
| Settings/private-file publication: `server/src/config/` | Readers see old or new complete state; interrupted writes preserve valid state | B: crash model only if storage guarantees are made explicit |
| Herdr setup/service/update: `server/src/herdr/`, `server/src/http/update.ts` | Single installation owner; validation precedes replacement; failure preserves runnable installation | B: workflow model; platform installer tests indispensable |
| Whole-service startup/shutdown: `server/src/index.ts`, connection startup/shutdown modules | Listener and background resources have one owner; shutdown blocks admission before draining; partial startup releases resources | B: process lifecycle; real signal/process behavior needs integration evidence |
| Optional metrics/cache work: `server/src/world/observability.ts` | Concurrent callers share bounded work; obsolete results cannot repopulate retired caches; failures do not change action authority | B: concurrency only; numerical metrics need unit tests |
| Renderer and lazy-module lifetime: `web/src/world/officeRenderer.ts`, `web/src/lazyWithReload.ts` | Unmount disposes one renderer; late initialization cannot resurrect it; reload attempts stay bounded | B: ownership protocol; actual GPU/DOM behavior stays in browser tests |
| Binary/control protocol parsing: `server/src/bridge/endpoint-client.ts`, `thin-client.ts`, `herdr-client.ts` | Framing and negotiation reject unsupported states; partial messages never dispatch prematurely | B/C: sequencing can be modeled; byte-level parser fuzzing is more direct |
| Release/package/CI orchestration: `scripts/`, `.github/workflows/` | Publication follows verified merged commit; artifact matrix complete; duplicate jobs cannot publish conflicting versions | B: useful if orchestration grows; platform artifacts require actual checks |
| Preferences/filters/shortcuts: `web/src/browserStorage.ts`, preferences | Persistence round trip; filters grant no authority | C: existing validation/unit tests usually sufficient |
| Rendering/layout/search/metrics/site | Deterministic geometry/counts; renderer lifetime; bounded metric/cache work | C, except resource-lifetime races: browser/performance tests more direct |

## Selected experiments and acceptance

Three cases deliberately cover different boundaries:

1. **Runtime leases:** two independently owned connections; delayed start,
   stop, generation retirement and obsolete error callbacks. Replay real
   `ConnectionManager` operations with controllable promises.
2. **Browser refresh:** one pending request and a coalesced follow-up, with
   disconnect epochs and late replies. Replay real `WorldRuntimeStore` operations.
3. **Space admission:** a dense and two sparse hosts, relevant-space reservations
   and variable capacity. Compare the real allocator with an independent rank
   specification, rather than duplicating its bucket loop.

For each case require typechecking, seeded simulation, finite-model verification,
generated trace replay against production code, and a deliberately faulty model
that produces a named invariant violation. Record witnesses so a passing run cannot
silently omit the targeted sequence. Preserve synthetic counterexamples and command
metadata locally; do not check generated output into Git.

Keep tooling opt-in and outside the shipped dependency graph. Do not change product
behavior or install a mandatory CI gate during the spike. Full verification of a
finite abstraction is not proof of the production implementation. Trace replay is
sampled conformance evidence; state-space bounds and omitted behavior must be stated.

## Results and evidence

Quint **0.33.0**, its TypeScript simulator and TLC verification backend were used.
The CLI's default Apalache distribution is **0.62.1**; TLC verification uses that
translation/checker tooling. Java 21 and Node 24 were available. Initial replay
used Bun 1.4.1; final validation uses the repository's pinned Bun 1.4.3. The older
system executable could not run the repository's `bun check` stage, so a local
isolated toolchain was installed rather than changing the project's gate.
The source baseline is `6c04e935` (the primary checkout's clean `main` when this
worktree was created); the experiment does not modify production source.

All three original models passed typechecking, simulation and TLC verification.
All 300 generated traces conformed to the production implementation. No production
defect was found within these modeled boundaries.

| Case | TLC distinct states | Replayed traces / transitions | Replay time, representative warm run | Implementation mutation detected |
| --- | --- | --- | --- | --- |
| Runtime leases | 3,617 | 100 / 2,500 | 19 ms | Remove generation/runtime comparison from a captured ready lease |
| Browser refresh | 1,107 | 100 / 2,222 | 2.7 s | Bypass observation-epoch checks during asynchronous admission |
| Space admission | 5,103 | 100 / 2,500 | 12 ms | Replace priority/fair allocation with the first input entries |

Verification took approximately four seconds per case in that warm run, including
CLI/checker startup. These timings are observations, not performance guarantees or
statistical benchmarks. Installation and first checker download are additional.
The replay total was **7,222 transitions**. State counts include model event labels
and coverage flags, not just distinct externally visible application states.

The stateless allocator uses every configuration as an initial state and self-loops
for verification. This covers all 7 × 3⁶ = 5,103 combinations of capacity and each
space being absent, ordinary or relevant, without an unnecessary complete graph
between independent calls. Simulation still generates sequences of allocations.

Witnesses were observed in the 500 seeded simulator samples:

| Case | Targeted witnesses and sample counts |
| --- | --- |
| Runtime | Late start after stop: 458; obsolete callback: 335; both hosts ready: 138 |
| Refresh | Late reply: 380; coalesced follow-up: 478; recovery after late reply: 376 |
| Allocation | Mixed relevant/ordinary output: 500; all three hosts admitted: 494 |

These are per-trace occurrence counts; witnesses can overlap. They are not a measure
of exhaustive coverage, and the 100 replayed traces are a selected subset of the
500 simulations. Each deliberately faulty model produced an invariant violation,
and replay of its counterexample was rejected by the real implementation. Each
separately bundled implementation mutation was killed by the original generated
traces. Faulty bundles and checker output remain ignored; application files were
never edited for these controls.

### Review repair and stronger evidence

Independent review found that missing connections could bypass the refresh
actionability observation, and arbitrary replay errors could satisfy the model
counterexample control. Those findings concern evidence validity within the spike,
not a production defect. Regression tests reproduced both before the repair.

Refresh replay now requires zero catalogue entries before any admission and exactly
the known synthetic owner and generation after admission, including after disconnect.
It checks actionability whenever an admitted response exists. Tests cover dropped
catalogues, substituted owner/generation and cleanup failure; generated traces kill
an additional dropped-catalogue implementation mutation.

Trace decoding and shape/action validation happen before expected-rejection checks.
Only a dedicated, named observation mismatch from the selected case can establish
conformance rejection. Results record the observation that killed each mutation or
counterexample. Invalid JSON, unsupported/malformed ITF, unknown actions, completion
without pending work, ordinary assertions and adapter/cleanup failures cannot be
credited as successful negative controls.

The allocation sweep additionally replays **all 5,103 distinct configurations**
against TypeScript, beyond the 300 sampled traces and 7,222 transitions. Domain and
uniqueness checks establish complete enumeration of this fixed six-space/three-host
domain. This adds 5,103 transitions, for **12,325 replayed transitions** in total.
The model now independently checks capacity filling, host-local prefix preservation
and round fairness without calling `expected()`. `fairSelection` alone is reference
agreement with the output function, not an independent fairness property. The
additional assertions do not establish correctness for other host layouts or
relevance classifications.

## Adoption assessment

**Runtime leases are the strongest fit.** The model captures interleavings across
owners compactly, and replay is inexpensive. Expand this model to current-runtime
errors, replacement factories, removal, cleanup failure and reentrant observers
before treating it as a maintained check of the manager's full contract. Replay
already checks all captured leases; the abstract model tracks only the latest
captured callback per host.

**Browser refresh is also valuable, with a larger abstraction gap.** Modeling the
epoch and coalescing rules is simple. Bridging cooperative preparation and public
async completion is more work. Add explicit decode/preparation transitions and
per-host retirement before claiming coverage of lifecycle events occurring inside
publication. The tested explicit refresh calls exercise coalescing, but do not
test debounce/fallback timer behavior. Logical single-request safety does not
establish wall-clock responsiveness.

**Allocation is a useful control case, with lower incremental value.** Quint makes
the fairness rule readable and exhaustively checks the small rank specification.
Ordinary TypeScript property tests could cover this pure function with less tooling.
Its maintained role should identify what formal checking contributes beyond direct
implementation tests; this spike did not compare those alternatives. Full
finite-model checking initially did not exhaustively replay all configurations
against TypeScript; the review repair adds that complete 5,103-configuration sweep.

The initial spike favored runtime/observation models. Promote maintained models
when they have named maintainers, scenario-to-transition mappings, documented
environment assumptions, bounds-sensitivity checks and a stable implementation
adapter. Expand safety coverage first; scheduling fairness and durable task
recovery would be good subsequent, distinct cases. Liveness needs explicit fairness
and crash/durability assumptions and was not verified in this spike.

The practical maintenance cost is concentrated in the implementation adapters and
runner, not the small models: initially about 156 model lines versus 320 replay-adapter lines,
plus orchestration and fault injection. This is not a general-purpose framework;
the spike deliberately handles only the ITF types and three APIs it needs. Quint's
effect checker helped reject inconsistent transition updates during development.
Learning its action/boolean distinction and update precedence is still necessary;
TypeScript-like syntax alone does not make the semantics familiar. Java/checker
installation, an independently pinned npm tool and a separate experiment typecheck
are additional operational costs. A maintained adoption should lock transitive
tool dependencies and pin the checker distribution explicitly.

OpenSpec remains the product contract; Quint models selected operational rules;
replay and existing integration/browser tests connect those rules to implementation.
Require model/adapter review when those rules change. Neither a passing simulation
nor successful finite-model verification proves production correctness.

## Why repository-wide adoption is possible

Quint is useful wherever intended behavior can be expressed as states, allowed
transitions and properties. Distributed deployment is not a prerequisite. Local
permission revocation, window focus, pending requests, durable task recovery and
allocation can all have meaningful models. The inventory should therefore be used
to schedule coverage, not to declare the lower-ranked areas permanently excluded.

The allocator's lower incremental value is a judgment, not an experimental result.
This spike did not compare Quint against a TypeScript property-testing approach.
Its small domain made exhaustive model verification possible, and the generated
traces caught a real-code mutation. That is positive evidence for applicability.
Whether maintaining both forms of testing is justified depends on the independent
properties each checks and the model's role in the larger system.

Human effort alone is not grounds to omit required correctness work. If a critical
behavior needs formal analysis, adapter complexity is a problem to solve. Conversely,
requiring a new formal artifact for a color change or copied constant would invent
scope without identifying a behavioral property. Repository-wide adoption should
make the needed analysis reliable, rather than require the same artifact everywhere.

## Relationship to OpenSpec and TDD

These practices answer different questions and can be applied together:

| Practice | Primary question | Evidence and remaining gap |
| --- | --- | --- |
| OpenSpec | What behavior should the product promise, and under which scenarios? | Reviewable requirements and decisions; prose does not enumerate every event ordering |
| Quint | Are the modeled transitions consistent with those promises under the stated assumptions? | Counterexamples or checked properties; model validity does not establish implementation conformance |
| TDD and implementation testing | Does real code meet the intended behavior and prevent regressions? | Executed checks of actual code; example tests do not automatically cover every state or schedule |

OpenSpec describes the contract, Quint makes suitable parts executable, and tests
connect that model to real behavior. These are complementary evidence sources.
Where possible, a counterexample becomes a regression test and a clarified scenario.
A model should not be derived solely from current code, because that can formalize
an implementation bug as the intended behavior.

Our repository already scopes its practices: OpenSpec is required for a genuinely
new product/API contract or an owner-requested change, while ordinary fixes need
not create a proposal. Tests should address cohesive behavior rather than mirror
every statement. Applying Quint across the board can follow the same principle:
every relevant change is assessed, and meaningful behavior receives appropriate
executable evidence. It need not mean one `.qnt` file for every TypeScript module.

## Adoption options

| Option | Meaning | Assessment |
| --- | --- | --- |
| Optional experiments only | Authors decide whether to use Quint, with no shared coverage expectation | Appropriate for the current spike; weak as a long-term policy because important transitions can remain unexamined |
| Repository-wide practice with scoped models | Changes identify affected invariants; models span coherent behavior; maintained model checks are required where applicable | Recommended target: broad adoption with explicit, auditable coverage |
| Model every module and run all verification for every change | Formal artifacts follow implementation files regardless of behavioral relevance | Technically possible for many modules, but file boundaries are often poor model boundaries and irrelevant models add no evidence |
| One complete whole-system model | Model service, browser, persistence, transports, OS and external Herdr together | Not established by this spike; abstraction and state-space growth make compositional modeling a better starting architecture |

Broad adoption does not require a monolithic model. A runtime admission model can
serve RPC, HTTP, terminals and assistant actions if their assumptions and connections
to that contract are explicit. Separate models for scheduling and durable recovery
can capture properties that runtime admission cannot. Composition must document
which guarantees each model assumes from the others; merely collecting individually
passing models does not establish a system-wide guarantee.

## Proposed repository-wide policy

The following is a proposal for review, not a change to `AGENTS.md`, CI or product
contracts in this branch:

1. Every behavior change identifies its affected contract and invariants. Consider
   identity, ownership, ordering, cancellation, permission, resource bounds,
   persistence and structural consistency. A mechanical change can state that no
   behavioral invariant changes without producing a new model.
2. Changes to asynchronous ownership, authorization, retry/replay, recovery,
  scheduling or multi-stage workflows require adequate executable evidence.
  Quint is the normal choice where exploring event orderings adds value. Reuse or
  extend a maintained model where possible. Alternative evidence must explain
   what evidence establishes the relevant property; an unchecked convenience
   exemption is not sufficient.
3. Pure algorithms and structural UI state receive Quint models when their
   invariants, combinations or interactions warrant formal exploration. If direct
   property or exhaustive implementation tests provide the needed evidence, state
   the boundary and retain that evidence. This is a decision about evidence, not
   a permanent exclusion of UI or pure functions.
4. Each model states assumptions, its domain, omitted behavior, invariant meanings,
   and implementation observations. Important guards need negative controls so
   a passing run cannot be mistaken for a meaningful check without sensitivity.
5. Maintain conformance through replay, trace validation or another reviewed
   implementation connection. Model-only checks are valid design evidence, but
   must be labeled as such. Do not call them production verification.
6. Require applicable maintained checks before delivery. Use fast deterministic
   checks on relevant changes and broader checker runs where they are needed.
   Scope by contract and dependencies, not solely by changed file names. Scheduled
   exploration can add evidence but cannot replace a required pre-delivery check.
7. Changes to a modeled contract update the requirement, model and implementation
   evidence together. Reviewers check assumptions and properties as carefully as
   they check the code. Model generation by an agent does not waive that review.

This policy makes Quint systematic across the repository while keeping the artifact
and checking strategy appropriate to each behavior. If the owner wants a stricter
rule requiring Quint for every behavior change, that is also a possible policy.
Before enforcing it, establish how sequential validation, parsing, rendering and
external-system integration will be represented and what extra claim each model
checks. The spike has not answered those questions for all 43 areas.

## Evidence limits that matter for broad adoption

| Limitation | What the spike establishes | What maintained adoption needs |
| --- | --- | --- |
| Finite bounds | Safety in two-host, bounded-generation/epoch abstractions | Sensitivity to larger bounds, symmetry arguments or inductive invariants where justified; never generalize a small-model result silently |
| Abstract transitions | Correctness of the stated model steps | Transition granularity that exposes relevant asynchronous boundaries; in particular, refresh completion is currently too coarse for mid-preparation events |
| Model/code gap | Sampled production conformance across 300 traces | Stable adapters, checked observations, independent properties and a reviewable mapping from contract to model to code |
| Fault sensitivity | Three model faults and three code mutations were detected | Additional faults at distinct boundaries; three kills are not a mutation score for the repository |
| Coverage | Targeted witnesses occurred during seeded simulation | Witnesses on replayed traces as well as simulated ones, multiple seeds, and explicit trace/state coverage expectations where meaningful |
| Progress properties | Safety was checked; some successful recovery was witnessed | Temporal properties with justified fairness, failure and durability assumptions; witnessing success is not proving eventual progress |
| Tool reproducibility | Top-level Quint version and checker defaults were recorded | Locked transitive tooling, explicitly pinned checker versions, supported toolchains and reproducible source/evidence manifests |
| Long-term value | The toolchain works and detects representative regressions | Evidence across actual changes, independent reviews and model evolution; no claim of fewer incidents is established yet |

Counterexample review must allow three outcomes: a product requirement is ambiguous,
the model is wrong, or the implementation is wrong. Changing the invariant simply
to make the checker pass would destroy the evidence. Review should identify which
outcome occurred and preserve the intended contract.

## Adoption sequence and decision criteria

Populate coverage from existing tests and accepted PR/OpenSpec evidence first:
record current scenarios, uncovered orderings, selected technique and ownership.
Do not retrospectively reopen delivered product work merely to rename it formal
adoption. No model does not mean untested, and existing tests do not demonstrate
every relevant ordering.

Start by reviewing this spike and deciding the policy independently of whether the
experimental code is ready for a required gate. Next, strengthen runtime admission
and browser observation to cover the documented missing transitions, then add a
third maintained boundary in socket-local chunk credits and shared-view creation
composition. Carry runtime generations, observation epochs, socket/batch identities
and user-intent versions separately through prepare/attach, ownership, dispatch,
result admission and conditional focus. A current observation does not authorize a
mutation; a current runtime does not authorize a late result to steal focus. Scope
Ranger persistence/permissions/recovery separately with explicit storage and crash
assumptions and its own authorization and acceptance.

Promote a model when its intended properties are independently reviewed, its
assumptions and omissions are explicit, relevant mutations are detected, its
implementation observations are trustworthy, and its results are reproducible.
For important omitted transitions, complete the work rather than classifying them
away. A passing model with no implementation connection can be promoted as a design
check, but cannot satisfy an implementation-conformance requirement.

Extend coverage across the inventory by coherent contract, starting with failure
and authority boundaries. After several real deliveries, reassess drift, regressions
found, review findings and checker behavior. This is a staged route to broad
adoption, not a permanent opt-in end state. No specific wall-clock threshold or
coverage percentage is justified by the present experiment.

## Questions for independent reviewers

- Does the policy identify all behavior that needs executable modeling, or do its
  exceptions leave important contracts unexamined?
- Are the modeled properties independently derived from intended requirements,
  rather than merely reproducing current implementation behavior?
- Do the runtime generations and refresh epochs faithfully represent production
  retirement, and which omitted transitions would most undermine the conclusions?
- Does the refresh adapter's public-entry instrumentation preserve the behavior
  being tested? Is treating completion as atomic acceptable for its stated scope?
- Is the independent allocation rank specification correct, and what additional
  host orderings or relevance classifications are needed?
- Do the implementation mutations fail for the claimed invariant, and are the
  cleanup paths reliable when a replay assertion fails?
- What guarantees depend on external Herdr, filesystem durability, browser events
  or transport delivery, and how should those assumptions be verified?
- Which models should be composed or shared, and which cross-model assumptions
  could leave a gap despite all individual checks passing?
- What changes are required before these experiments become required gates, and
  does a stricter universal-model policy add a checkable claim in each area?

Review source, model and adapter together. Raw state counts and a green checker
are insufficient reasons to accept an adoption policy or a correctness claim.

## Reproduce and validate

The [optional experiment README](../experiments/quint/README.md) gives the exact
installation and runner commands, bounds and omissions. Runs write fresh evidence
directories under `.agents/quint-spike/`, including command arguments, durations,
exit codes, TLC logs, traces, mutants and result summaries. Fresh directories
prevent earlier traces from disguising an incomplete later run. Checker output is
also confined there. Tooling does not change root manifests or `bun.lock`.

Spike TypeScript is checked separately because root TypeScript includes `scripts/`,
not `experiments/`:

```bash
bunx tsc --noEmit -p experiments/quint/tsconfig.json
```

Final validation passed under Bun 1.4.3: the experiment TypeScript check, complete
spike runner, staged formatting, and `bun run check` (dependency notices, formatting,
lint, TypeScript and Bun checks, repository tests, application/site builds and strict
OpenSpec validation). The primary checkout remains clean. The spike and proposal
are review artifacts; no product behavior or mandatory verification policy was changed.
Initial repository test runs reported 4,187 passing tests, four skipped and zero
failures; repair-specific validation is recorded with the PR update.

## Upstream references

- [Quint language and licensing](https://github.com/quint-co/quint)
- [Model checker scope and backends](https://quint.sh/docs/model-checkers)
- [Model-based testing and implementation gap](https://quint.sh/docs/model-based-testing)
- [Properties and fairness](https://quint.sh/docs/checking-properties)

The pinned installed CLI's help was used for actual flags and defaults; documentation
alone was not assumed to describe the installed version exactly.
