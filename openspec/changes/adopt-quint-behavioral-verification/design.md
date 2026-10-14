## Context

See [proposal.md](proposal.md) for motivation and [the analysis](../../../docs/quint-adoption-spike.md)
for the 43-area inventory, measured results, limitations and reviewer questions.
Three bounded models passed TLC and 300 traces replayed 7,222 transitions against
real code. Three model faults and three implementation mutations were detected.
No production defect was found within that historical scope. At spike time it was
not a maintained verification contract: tooling has unlocked transitive dependencies, refresh
completion is coarse, important runtime transitions are omitted, and replay
coverage is narrower than finite-model coverage.

## Goals / Non-Goals

**Goals:** make invariant assessment systematic across the repository; carefully
select and review models; establish reproducible, implementation-connected checks;
extend coverage by contract without hiding critical omissions.

**Non-Goals:** a model per source file, a monolithic whole-system proof, replacing
existing tests, changing product contracts to fit a model, or claiming to verify
OpenSSH, browser internals, filesystem durability or external Herdr implementation.
The owner subsequently authorized implementation in the same PR. Candidate guidance
and checks are implemented; independent promotion and final acceptance remain
pending. The [implementation report](../../../docs/quint-adoption-implementation.md)
records current evidence without rewriting the historical spike results.

## Decisions

### 1. Assess every behavior change; select evidence by contract

The proposed guidance requires authors to identify affected requirements and
invariants for behavioral changes. Identity, authority, concurrent ownership,
retry/replay, cancellation, persistence, recovery, scheduling and protocol changes
require adequate executable evidence. Quint is the normal choice where exploring
event orderings adds value, connected to actual implementation.

If a different technique establishes the needed property, the change records
that evidence and obtains independent review of the justification. Human effort
or a green example test alone cannot justify excluding a critical transition.
Mechanical changes that do not alter behavior need no new model. Existing unmodeled
areas are classified as pending with their limits stated; they are not automatically
held to an unfinished gate or treated as formally covered.

Populate coverage from existing tests and PR acceptance evidence before adding
models. Distinguish executed scenarios, uncovered orderings and selected additional
evidence. Reconcile completed or partially recorded OpenSpec deliveries against
their actual PR evidence; do not reopen delivered product work merely to relabel
it formal adoption. No Quint model does not mean untested, and existing tests do
not establish every relevant ordering. Routine repairs need no new product specs.

This combines broad applicability with the owner's requirement for meticulous,
selective implementation. Blanket opt-in permits important gaps; blanket per-file
modeling follows implementation structure instead of the behavioral contract.

### 2. Requirements are reviewed before modeling the implementation

Each maintained model has a companion contract record with:

- Intended properties derived from current requirements and approved decisions,
  including concrete allowed and forbidden scenarios.
- State variables, transition boundaries, input/environment domains, initial
  states, assumptions, excluded behavior and the meaning of each invariant.
- A source/adapter mapping explaining how abstract inputs and observations relate
  to real operations, plus model dependencies and consumer assumptions.
- Named ownership, independently reviewed properties and reviewed changes to
  assumptions, boundaries, requirements or conformance assertions.

Independent reviewers assess intended behavior using contracts and scenarios, not
only whether the model matches current code. Unspecified behavior is resolved as a
requirement decision before encoding it. Code can inform transition fidelity, but
does not define whether the observed behavior is correct. A single author or agent
producing model, implementation and tests cannot self-certify requirement validity.

### 3. Check for wrong, incomplete and vacuously passing models

Promotion requires reachability witnesses for meaningful initial/operating states,
the targeted failure orderings and recovery where relevant. Witnesses are measured
on replayed traces as well as simulations. A property that passes only because its
precondition is unreachable is not accepted as evidence.

Review assumptions adversarially: request completion cannot be assumed when proving
behavior during disconnect, valid permissions cannot be assumed when checking
revocation, and fairness must not assume the outcome being claimed. Async boundaries
are split wherever lifecycle changes can alter authority. Broader bounds, host
orderings and seeds are varied where they can expose a missing case; finite bounds
are accompanied by a rationale rather than silently generalized.

Negative controls deliberately weaken model and implementation guards. Reviewers
verify that the expected property kills each control and that the failure is an
assertion about behavior, not a parser/tool/cleanup error. These controls demonstrate
sensitivity, not that the property is the right requirement or that all bugs are
detectable. Known specification conflicts and forbidden scenarios are reviewed
separately from mutation detection.

### 4. Compose contract models with explicit implementation connections

Use models spanning coherent ownership or protocol boundaries. Runtime admission
can support several consumers if each consumer's qualified dispatch is checked.
Scheduling, browser preparation and durable recovery need their own transitions
and assumptions. Individually passing models do not prove their composition.

Carry runtime generation, browser observation epoch, socket/batch identity and
user-intent version as distinct tokens. Current observation alone does not grant
mutation authority, and a current runtime alone does not authorize late focus.
Make shared-view creation an early composition slice after lifecycle/observation
models stabilize: prepare/attach, acquire source ownership, dispatch, admit the
result and conditionally focus. Verify retirement at every relevant boundary,
colliding IDs, newer user intent and uncertain dispatch without automatic retry.
Use existing shared-creation and Inspector handoff regressions as input; retain
browser checks for actual focus, geometry, mobile input and terminal presentation.
Preserve legacy omitted-ID routing as an explicit compatibility boundary in
consumer mappings, without treating it as the route for new browser work.

Require generated replay, implementation trace validation or a reviewed equivalent
connection for implementation-conformance claims. Retain implementation tests for
actual parsing, filesystem/platform behavior, DOM interaction and responsiveness.
Pure functions may use exhaustive or property-based implementation tests where
those provide the needed evidence; the coverage record explains that choice.

### 5. Reproducible tooling remains development-only

Use a dedicated tooling package and lockfile outside the application workspaces,
with an explicit exception documented to the current root-lockfile convention.
Pin Quint, checker versions and transitive dependencies. Keep root application
dependency notices accurate and provide a separate tooling dependency inventory
where required. Future installation must honor repository trust policy and avoid
uncontrolled checker downloads in a required gate.

The maintained runner records source/model/adapter/tool versions or hashes,
backend, seed, bounds, invariants, witnesses, exit status and artifact locations.
Fresh runs prevent stale traces from satisfying coverage. External commands have
deadlines and clean up their checker descendants on failure or cancellation;
adapter tasks and timers drain without changing production files. Unsupported ITF
data and malformed traces fail explicitly.

Alternative: add Quint to root dependencies. A dedicated package keeps optional
checker tooling out of shipped dependency accounting and allows its own reviewed
lock without changing application resolutions.

### 6. Promote applicable checks in stages

Provide one reproducible local entry point, an explicit experiment typecheck and
fast deterministic conformance checks. A model is promoted only after property and
adapter review, targeted witnesses, successful negative controls, documented limits
and reproducible checker evidence.

Required CI checks fail on a relevant invariant violation, missing required witness,
malformed/incomplete evidence, replay divergence, timeout or tool failure. Scheduled
broader exploration supplements required checks. Check applicability follows model
dependencies and consumers, including changes to models, adapters, contracts,
tooling and workflow selection. A trusted decision selects checks; untrusted PR
labels or prose cannot bypass them. Initially running all promoted fast checks is
safer than an unverified optimization based only on changed paths.

Timing limits are established from supported local/CI runs, not inferred from one
warm spike. Tool failures are not reported as successful verification. Existing
repository checks remain in force throughout promotion.

## Migration Plan

Keep one coherent OpenSpec change through these stages. PR review accepts the
planning artifacts. The owner has authorized implementation through all stages;
model promotion and expanded acceptance retain independent review checkpoints.

| Stage | Contract families and deliverable | Exit evidence |
| --- | --- | --- |
| 0. Review baseline | Spike, intended properties, proposed policy and fidelity limits | Independent review resolves findings; implementation scope authorized |
| 1. Reproducibility and coverage | Locked tooling, runner hardening, complete 43-area coverage map | Fresh install/run and failure controls; each area has an owner, stage and evidence decision |
| 2. First maintained contracts | Runtime lifecycle/admission and browser aggregate observation | Replacement/removal/error/reentrancy and mid-preparation transitions; reviewed replay and negative controls; scope of required gates explicit |
| 3. Protocol and workflow composition | Socket-local chunk credits/assembly and shared-view creation integration | Wrong socket/index, retirement, dispatch ownership, colliding IDs, newer intent, uncertainty and conditional focus checked against real code |
| 4. Separately scoped Ranger recovery | Task permission, cancellation and durable recovery with explicit storage/crash assumptions | Owner-authorized scope and independent acceptance; revoked permission, changed identity and interrupted recovery cases checked against real code |
| 5. Shared authority and observation | Profiles/SSH/subscriptions, RPC/HTTP, terminals/input/reconnect, focused contexts, snapshots/scheduling and watchlists | Consumer mappings and cross-model assumptions reviewed; safety covered; any temporal progress claim includes fairness evidence |
| 6. State and persistence | Windows/tab layouts/Inspector intent; resources/drafts; receipts/history; notifications/auth; files/Git/worktrees/private state/setup/service lifecycle | Reviewed models or justified alternative implementation evidence; platform, crash and UI limits explicit |
| 7. Remaining inventory and consolidation | Pure allocation, composition/shortcuts, parsing, metrics/render lifetime, preferences, rendering/site and release/CI orchestration | Every inventory area reconciled; no unexplained or silently waived critical gap; change workflow and gates documented |

The coverage map assigns every inventory entry a stable identifier and status:
`pending`, `modeled`, `shared-model` or `alternative-evidence`. A shared-model entry
names its consumer observations; an alternative names the property and executed
evidence. Grouped stages do not count as coverage until those entries are resolved.
An area can contain multiple contracts and evidence techniques. Ranks guide order,
not permission to leave a critical property unverified.

After this experimental PR, the concrete first authorization is stages 1–2:
lock/harden tooling and deliver lifecycle/observation models with replayed witnesses
and the missing transitions. Each promoted contract has an independent acceptance
boundary. Later stages receive their own bounded authorization; the roadmap is not
permission to implement every inventory area at once. Ranger's persistence/permission
slice is independently scoped rather than bundled into first promotion.

Enable policy and checks only for reviewed contracts as they are promoted; report
repository-wide assessment separately from completed model coverage. At completion,
update durable guidance and reconcile every inventory entry. Archive only when the
authorized implementation, knowledge updates and verification are complete.

If a required check is unsound or unusable, record the failure, temporarily replace
its gate with reviewed implementation evidence, retain the coverage gap and repair
it. Do not discard the invariant or product requirement to obtain a green check.

## Acceptance scenarios

| Trigger | Required observable outcome |
| --- | --- |
| Model copies a current implementation behavior conflicting with the intended contract | Independent property review rejects or corrects it before promotion; passing checker output is insufficient |
| Required scenario is unreachable because an assumption excludes it | Missing witness blocks promotion and the assumption or requirement is resolved |
| Disconnect/permission change occurs between modeled async stages | Replay checks captured authority at the relevant boundaries; old work cannot gain replacement authority |
| Deliberately weakened implementation still passes | Promotion fails until the fault or property mapping is corrected; unrelated tool errors do not count as detection |
| Relevant code, contract, adapter or model dependency changes | Applicable required checks execute; any newly unmodeled critical transition remains visible and receives evidence |
| Tool times out or evidence files are incomplete | Check fails, owned resources drain, and no stale output is accepted as current evidence |
| Reviewer challenges a safety result as a liveness guarantee | Report preserves the safety-only scope; progress requires separate temporal assumptions and evidence |
| Inventory area uses another method instead of Quint | Reviewer can trace its property to executed evidence and the reason for that method; no automatic exemption |

## Risks / Trade-offs

- Wrong requirements → independent contract/property review and concrete forbidden
  scenarios; neither TDD nor mutation detection alone resolves intended behavior.
- Abstraction excludes a real race → explicit async boundaries, adversarial
  environment assumptions, witnesses and implementation replay.
- State-space explosion → coherent smaller models and justified bounds/composition;
  record incomplete results instead of weakening the claim invisibly.
- Model/adapter drift → require coordinated updates, coverage ownership and checks
  for relevant consumers and dependencies.
- False confidence from limited mutations → label their scope and review missing
  cases; preserve independent tests and external-system evidence.
- New tooling becomes an unreliable gate → lock inputs, fail explicitly, clean up
  resources and measure supported CI behavior before promotion.

No unresolved choice blocks this proposed approach. Exact checker resource limits
and scheduling of later inventory entries are determined from implementation
evidence; they cannot weaken these promotion and correctness criteria.
