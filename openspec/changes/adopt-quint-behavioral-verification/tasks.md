## 1. Review and establish the baseline

- [x] 1.1 Obtain independent review of the spike's requirements, abstractions, adapters and negative controls; record resolved findings and the owner-authorized adoption scope in review evidence.
- [x] 1.2 Populate all 43 coverage-map entries from existing tests and accepted PR/OpenSpec evidence first, with stable IDs, owners, properties, executed scenarios, uncovered orderings, intended stage and selected evidence technique; verify every entry has an explicit decision without reopening delivered product work merely to relabel it.
- [x] 1.3 Write model contract/review templates covering allowed and forbidden scenarios, assumptions, async boundaries, implementation observations and claim limits; validate them against all three spike cases and a deliberately incorrect requirement.

## 2. Make development tooling reproducible

- [x] 2.1 Create the dedicated development-only tooling package with locked Quint/transitive dependencies and explicit checker versions; document the root-lockfile exception and verify a fresh isolated install without changing application resolutions.
- [x] 2.2 Harden ITF parsing and run isolation; test malformed/unsupported traces, incomplete output and stale artifacts, and record source/model/adapter/tool identifiers in evidence manifests.
- [x] 2.3 Add process and adapter cancellation/drain behavior; verify timeout and assertion-failure controls leave no owned checker descendants, pending promises or timers.
- [x] 2.4 Add the local entry point and experiment typecheck with bounded output; verify repeatable seeded results and review any separate tooling notices required by the resolved dependency graph.

## 3. Promote runtime admission and browser observation

- [x] 3.1 Expand the runtime model for current errors, factory replacement, removal, failed cleanup, duplicate starts/stops, reentrant observers and shutdown; verify real-manager replay and witnesses for each relevant ordering.
- [ ] 3.2 Split browser refresh completion into preparation/admission stages and cover per-host retirement, request failure and priority changes; verify disconnect/retirement during each authority-sensitive stage and preserve real browser timer evidence.
- [ ] 3.3 Add larger-bound, host-order and multiple-seed checks plus replayed-witness accounting; verify each named target is reached in real-code replay and all intended fault controls fail for the correct assertion.
- [ ] 3.4 Independently review both model contracts and implementation mappings; record promotion decisions and exact excluded claims before enabling required checks.

## 4. Exercise protocol and workflow composition

- [ ] 4.1 Model and replay socket-local chunk credits/assembly, wrong socket/index, capacity, duplicate messages and retirement; verify bounded ownership and fault-control sensitivity against the real protocol implementation.
- [ ] 4.2 Deliver the shared-view creation integration slice from prepare/attach through source ownership, dispatch, result admission and conditional focus; verify retirement at each boundary, colliding IDs, newer user intent and uncertain dispatch without retry using existing creation/handoff regressions.
- [ ] 4.3 Review composition between runtime admission, observation, chunk ownership and creation intent; verify generation, observation epoch, socket/batch and intent tokens remain distinct and each consumer assumption has evidence, including legacy omitted-ID compatibility.

## 5. Separately authorize Ranger authority and recovery

- [ ] 5.1 Obtain owner authorization of a bounded Ranger permission/persistence/recovery slice and review its storage/crash assumptions; verify its acceptance boundary is independent of first lifecycle/observation promotion.
- [ ] 5.2 Model task admission, captured identity, revocation, cancellation/drain and interrupted recovery; verify implementation replay or trace validation with retained integration tests and intended authority mismatches.
- [ ] 5.3 Independently accept Ranger consumer/composition mappings; verify current-runtime admission cannot bypass task permission, durable identity or cancellation checks.

## 6. Integrate policy and required checks

- [ ] 6.1 Update agent/contributor guidance and the PR template to require adequate executable evidence, with Quint the normal choice for valuable ordering exploration and reviewed alternatives; verify a modeled change, an unmodeled critical change and a mechanical change without requiring new product specs for routine work.
- [ ] 6.2 Add required local/CI checks for promoted models, with deterministic replay and explicit checker failure handling; verify invariant violations, missing witnesses, divergence and timeouts block success.
- [ ] 6.3 Validate applicability across models, contracts, adapters, tool configuration and consumer changes; demonstrate no bypass through untrusted labels/prose, and use all promoted fast checks until selective scheduling is independently verified.
- [ ] 6.4 Measure supported CI resource needs and broader exploration runs; record justified limits and verify supplemental exploration never substitutes for required pre-delivery evidence.

## 7. Extend the remaining contract families

- [ ] 7.1 Extend shared authority/observation coverage to profile/SSH/subscription lifecycle, RPC/HTTP, terminals/input/reconnect, contexts, creation, aggregate scheduling and watchlists; verify each relevant coverage-map entry and cross-model consumer mapping before promotion.
- [ ] 7.2 Cover state/persistence families: windows/tabs/Inspector intent, resources/drafts, receipts/history, notifications/auth, files/Git/worktrees/private state and setup/service lifecycle; deliver reviewed models or justified executed alternatives with platform/crash/UI boundaries stated for every entry.
- [ ] 7.3 Reconcile pure allocation, composition/shortcuts, parsing, metrics/render lifetime, preferences, rendering/site and release/CI families; verify every remaining entry has evidence and no critical omission is silently classified away.
- [ ] 7.4 Add temporal progress properties only where required, with reviewed fairness/failure/durability assumptions; verify progress separately from safety and do not treat successful witnesses as a liveness proof.

## 8. Consolidate and close adoption

- [ ] 8.1 Audit several actual deliveries for wrong-property findings, drift, newly exposed ordering gaps and gate reliability; publish evidence and corrections without claiming an unmeasured reduction in production defects.
- [ ] 8.2 Reconcile the knowledge map, adoption analysis and operational guidance with implemented coverage and rollback procedures; verify all 43 entries are resolved or explicitly owned and no required critical gap remains pending.
- [ ] 8.3 Run applicable project and model gates, obtain independent acceptance and owner approval of completed adoption, and archive this change only after all authorized implementation and knowledge work is verified.
