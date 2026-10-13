## Why

Herdr World's ownership, permission and asynchronous failure contracts need evidence
across event orderings that example tests can miss. The [Quint spike](../../../docs/quint-adoption-spike.md)
demonstrates feasible model verification and production replay, while also showing
why incorrect requirements or incomplete models can produce misleading confidence.

## What Changes

- Establish repository-wide assessment of behavioral invariants and adequate
  executable evidence, with Quint the normal choice where exploring event
  orderings adds value. Preserve reviewed alternatives and selective,
  meticulous adoption of Quint models by coherent contract. Every area in the
  43-area inventory receives an explicit coverage decision; no subsystem is
  categorically excluded and no per-file model mandate is introduced.
- Define review requirements for intended properties, assumptions, transition
  granularity, non-vacuous coverage and implementation conformance. A checked
  model is not described as verified production code.
- Harden the experimental toolchain and adapters, then promote reviewed models
  into required local/CI checks in stages. Preserve OpenSpec, TDD, integration,
  browser, security and performance evidence.
- Populate coverage from current tests and accepted delivery evidence first.
  Promote runtime admission and browser observation in a concrete first slice,
  then chunk credits and shared-view creation composition. Ranger durability
  receives separate authorization and explicit storage/crash assumptions.
  Reconcile the remaining contract families. The [design](design.md) and
  [tasks](tasks.md) define the rollout.
- Maintain a coverage map linking requirements, models, real-code observations,
  reviewers, bounds and justified alternative evidence. Unmodeled critical
  transitions remain visible work, not silent exemptions.

This PR delivers the proposal, analysis and runnable spike. Merging it does not
enact the proposed policy, modify `AGENTS.md`, install mandatory CI gates, or mark
adoption tasks complete. Implementation follows review and owner authorization.

## Capabilities

### New Capabilities

None. This is development tooling and verification policy; `.openspec.yaml` uses
`skip_specs: true`. Proposed operational acceptance lives in the design and tasks
rather than an invented product capability.

### Modified Capabilities

None. Existing runtime federation, access, assistant and World surface contracts
provide inputs to modeling. Their product requirements are not changed here.

## Impact

Future implementation affects agent/contributor guidance, opt-in and required
development commands, tool dependency management, model/adaptor sources and CI
evidence. Tooling remains outside the shipped application dependency graph and
uses synthetic data. No service/browser API, external Herdr protocol, production
behavior or distribution contract changes are proposed.

Owner direction is to consider adoption across the repository while being careful
and selective about what is modeled and claimed. Review should assess the policy,
model fidelity and rollout; broader adoption is not justified by state counts alone.
