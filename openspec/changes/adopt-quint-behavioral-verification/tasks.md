## 1. Review and establish the baseline

- [ ] 1.1 Obtain independent review of the spike's requirements, abstractions, adapters and negative controls; record resolved findings and the owner-authorized adoption scope in review evidence.
- [ ] 1.2 Reconcile all 43 inventory areas into a coverage map with stable IDs, owners, properties, intended stage, evidence technique and pending gaps; verify every inventory entry has an explicit decision.
- [ ] 1.3 Write model contract/review templates covering allowed and forbidden scenarios, assumptions, async boundaries, implementation observations and claim limits; validate them against all three spike cases and a deliberately incorrect requirement.

## 2. Make development tooling reproducible

- [ ] 2.1 Create the dedicated development-only tooling package with locked Quint/transitive dependencies and explicit checker versions; document the root-lockfile exception and verify a fresh isolated install without changing application resolutions.
- [ ] 2.2 Harden ITF parsing and run isolation; test malformed/unsupported traces, incomplete output and stale artifacts, and record source/model/adapter/tool identifiers in evidence manifests.
- [ ] 2.3 Add process and adapter cancellation/drain behavior; verify timeout and assertion-failure controls leave no owned checker descendants, pending promises or timers.
- [ ] 2.4 Add the local entry point and experiment typecheck with bounded output; verify repeatable seeded results and review any separate tooling notices required by the resolved dependency graph.

## 3. Promote runtime admission and browser observation

- [ ] 3.1 Expand the runtime model for current errors, factory replacement, removal, failed cleanup, duplicate starts/stops, reentrant observers and shutdown; verify real-manager replay and witnesses for each relevant ordering.
- [ ] 3.2 Split browser refresh completion into preparation/admission stages and cover per-host retirement, request failure and priority changes; verify disconnect/retirement during each authority-sensitive stage and preserve real browser timer evidence.
- [ ] 3.3 Add larger-bound, host-order and multiple-seed checks plus replayed-witness accounting; verify each named target is reached in real-code replay and all intended fault controls fail for the correct assertion.
- [ ] 3.4 Independently review both model contracts and implementation mappings; record promotion decisions and exact excluded claims before enabling required checks.

## 4. Exercise distinct protocol and durability boundaries

- [ ] 4.1 Model and replay socket-local chunk credits/assembly, wrong socket/index, capacity, duplicate messages and retirement; verify bounded ownership and fault-control sensitivity against the real protocol implementation.
- [ ] 4.2 Model Ranger task admission, captured identity, permission revocation, cancellation/drain and crash/recovery; verify replay or trace validation with explicit storage assumptions and retained integration tests.
- [ ] 4.3 Review composition between runtime admission, chunk ownership and task authority; verify consumer assumptions have evidence and individual model success is not presented as a system-wide proof.

## 5. Integrate policy and required checks

- [ ] 5.1 Update agent/contributor guidance and the PR template for invariant assessment, reviewed evidence exceptions and synchronized contract/model/test changes; verify the workflow on a modeled change, an unmodeled critical change and a mechanical change.
- [ ] 5.2 Add required local/CI checks for promoted models, with deterministic replay and explicit checker failure handling; verify invariant violations, missing witnesses, divergence and timeouts block success.
- [ ] 5.3 Validate applicability across models, contracts, adapters, tool configuration and consumer changes; demonstrate no bypass through untrusted labels/prose, and use all promoted fast checks until selective scheduling is independently verified.
- [ ] 5.4 Measure supported CI resource needs and broader exploration runs; record justified limits and verify supplemental exploration never substitutes for required pre-delivery evidence.

## 6. Extend the remaining contract families

- [ ] 6.1 Extend shared authority/observation coverage to profile/SSH/subscription lifecycle, RPC/HTTP, terminals/input/reconnect, contexts, creation, aggregate scheduling and watchlists; verify each relevant coverage-map entry and cross-model consumer mapping before promotion.
- [ ] 6.2 Cover state/persistence families: windows/tabs/Inspector intent, resources/drafts, receipts/history, notifications/auth, files/Git/worktrees/private state and setup/service lifecycle; deliver reviewed models or justified executed alternatives with platform/crash/UI boundaries stated for every entry.
- [ ] 6.3 Reconcile pure allocation, composition/shortcuts, parsing, metrics/render lifetime, preferences, rendering/site and release/CI families; verify every remaining entry has evidence and no critical omission is silently classified away.
- [ ] 6.4 Add temporal progress properties only where required, with reviewed fairness/failure/durability assumptions; verify progress separately from safety and do not treat successful witnesses as a liveness proof.

## 7. Consolidate and close adoption

- [ ] 7.1 Audit several actual deliveries for wrong-property findings, drift, detected regressions and gate reliability; publish evidence and corrections without claiming an unmeasured reduction in production defects.
- [ ] 7.2 Reconcile the knowledge map, adoption analysis and operational guidance with implemented coverage and rollback procedures; verify all 43 entries are resolved or explicitly owned and no required critical gap remains pending.
- [ ] 7.3 Run applicable project and model gates, obtain independent acceptance and owner approval of completed adoption, and archive this change only after all authorized implementation and knowledge work is verified.
