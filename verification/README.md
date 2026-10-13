# Behavioral evidence

`coverage.json` is the maintained assessment of the 43 areas identified by the
[reviewed spike](../docs/quint-adoption-spike.md). IDs are stable. Source ownership,
current requirements, real tests, accepted source-delivery PRs and the uncovered
transition or evidence boundary are recorded before choosing additional models.
An accepted source PR establishes delivery history, not a proof of every property
in the area. No model does not mean untested; examples do not enumerate every
schedule. Live/platform-dependent tests retain their actual prerequisites.

The repository owner accepted the spike at `5d73319b` in PR #188. The owner then
authorized implementation in the same PR, with functional commits, bounded review
checkpoints and a new final review. This does not carry spike acceptance forward
as approval of expanded models, changed assumptions or activation of the policy.

The baseline references executed CI on the accepted spike. The inventory now has a concrete model, shared-model consumer or justified
alternative for all 43 areas; their independent acceptance remains pending.
[Consumer decisions](consumer-evidence.md) record the rationale and limits. Existing
delivered product changes are not reopened solely to add a formal-model label.

## Coverage decisions

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

## Implementation checkpoints

1. Baseline: all 43 areas assessed against existing evidence; every additional
   model/consumer mapping is pending. Existing repository checks remain required.
2. Tooling: locked inputs, validated traces, bounded processes, reliable drain and
   manifests. No claim of expanded behavioral coverage from installing tools.
3. Lifecycle/observation: expanded transitions and actual replay witnesses; new
   model checks become candidate requirements after their technical criteria pass.
4. Composition/recovery: chunk, terminal/creation and separately scoped Ranger
   evidence; caller authority and user intent remain distinct.
5. Reconciliation: remaining modeled/alternative evidence, contributor/CI policy,
   declared limitations and independent final review of the expanded implementation.

Record concrete coverage, pending work, required commands and acceptance boundaries
with each functional checkpoint. Do not archive the adoption change or describe
the implementation as accepted until its independent final review is complete.

## Candidate commands and promotion

The separate Behavioral verification candidate CI workflow runs all 11 models,
actual replay, required per-seed witnesses, model/implementation fault controls
and larger-bound/host-order sensitivity. It installs locked tooling and the
hash-validated checker, records exact tool/input identities and retains manifests
on success or failure. Missing artifacts, missing witnesses, divergence, checker
errors, timeouts and cleanup failures fail the candidate command. A cancelled run
cannot report success. Evidence from focused `--case` runs cannot substitute for
the unfiltered canonical command.

The canonical run has a 15-minute outer deadline; checker commands have a
240-second deadline, Java has a 1 GiB heap and Node has a 512 MiB old-space cap.
These per-process limits are not a measurement of total peak memory. Local complete
execution passed in approximately four minutes after the Ranger additions; CI
resource/installation measurements are still pending the first candidate run.
No supplemental exploration substitutes for real consumer/platform/browser checks.

The protected repository delivery check and pre-push gate remain required.
Behavioral contracts and execution policy cannot use the ordinary Markdown-only
shortcut. The candidate formal workflow is not yet a protected dependency: task
3.4 requires independent model/mapping promotion review first. Promotion must
record the accepted domains, consumer obligations and exact excluded claims, then
add the unfiltered checks to applicable local/CI delivery gates. Do not infer that
permission from spike acceptance or from this implementation passing its controls.

Rollback means reverting a reviewed gate/tooling change through normal delivery,
with the affected evidence decision and limitation recorded. Never make checker
errors soft-success, disable a consumer regression or weaken an intended property
to recover a green build. Tool caches and generated traces are ignored and may
be recreated through `verification:setup`; production code does not depend on Quint.
