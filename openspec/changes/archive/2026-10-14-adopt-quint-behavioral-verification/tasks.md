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
- [x] 3.2 Split browser refresh completion into preparation/admission stages and cover per-host retirement, request failure and priority changes; verify disconnect/retirement during each authority-sensitive stage and preserve real browser timer evidence.
- [x] 3.3 Add larger-bound, host-order and multiple-seed checks plus replayed-witness accounting; verify each named target is reached in real-code replay and all intended fault controls fail for the correct assertion.
- [x] 3.4 Independently review both model contracts and implementation mappings; record promotion decisions and exact excluded claims before enabling required checks.

## 4. Exercise protocol and workflow composition

- [x] 4.1 Model and replay socket-local chunk credits/assembly, wrong socket/index, capacity, duplicate messages and retirement; verify bounded ownership and fault-control sensitivity against the real protocol implementation.
- [x] 4.2 Deliver the shared-view creation integration slice from prepare/attach through source ownership, dispatch, result admission and conditional focus; verify retirement at each boundary, colliding IDs, newer user intent and uncertain dispatch without retry using existing creation/handoff regressions.
- [x] 4.3 Review composition between runtime admission, observation, chunk ownership and creation intent; verify generation, observation epoch, socket/batch and intent tokens remain distinct and each consumer assumption has evidence, including legacy omitted-ID compatibility.

## 5. Implement Ranger authority and recovery with separate acceptance

- [x] 5.1 Owner authorization covers the bounded Ranger permission/persistence/recovery slice. Independently review its documented storage/crash assumptions; verify its acceptance boundary remains separate from lifecycle/observation promotion.
- [x] 5.2 Model captured identity/revocation and durable admission/identity recovery; retain real scheduler/SDK cancellation/drain and killed-process recovery integration evidence with intended authority mismatches. Technical evidence is delivered; independent consumer/storage acceptance remains task 5.3.
- [x] 5.3 Independently accept Ranger consumer/composition mappings; verify current-runtime admission cannot bypass task permission, durable identity or cancellation checks.

## 6. Integrate policy and required checks

- [x] 6.1 Update agent/contributor guidance and the PR template to require adequate executable evidence, with Quint the normal choice for valuable ordering exploration and reviewed alternatives; verify a modeled change, an unmodeled critical change and a mechanical change without requiring new product specs for routine work.
- [x] 6.2 Promote accepted checks into required local/CI delivery gates after independent review 5516249164. Local delivery and protected CI integration are implemented; focused gate regressions and the full pre-push/protected CI checkpoint validate the wiring; independent final review is accepted in reviews 5517392425 and 5517420140.
- [x] 6.3 Validate promoted-check applicability across models, contracts, adapters, tooling and consumers. Candidate CI runs all models without labels/path exclusions and contract/policy Markdown receives full repository gates; model/adapter/consumer/tooling applicability, cancellation and result aggregation must pass the integration checkpoint.
- [x] 6.4 Measure supported CI resource needs and broader exploration runs; record justified limits and verify supplemental exploration never substitutes for required pre-delivery evidence.

## 7. Extend the remaining contract families

- [x] 7.1 Extend shared authority/observation coverage to profile/SSH/subscription lifecycle, RPC/HTTP, terminals/input/reconnect, contexts, creation, aggregate scheduling and watchlists; verify each relevant coverage-map entry and cross-model consumer mapping before promotion.
- [x] 7.2 Cover state/persistence families: windows/tabs/Inspector intent, resources/drafts, receipts/history, notifications/auth, files/Git/worktrees/private state and setup/service lifecycle; deliver reviewed models or justified executed alternatives with platform/crash/UI boundaries stated for every entry.
- [x] 7.3 Reconcile pure allocation, composition/shortcuts, parsing, metrics/render lifetime, preferences, rendering/site and release/CI families; verify every remaining entry has evidence and no critical omission is silently classified away.
- [x] 7.4 Complete the explicit progress assessment: retain controlled real scheduler/deadline evidence for host-local/background progress with event-loop, slot-availability and transport-settlement assumptions. No temporal proof is claimed; independent acceptance of this alternative is complete in review 5516249164 and recorded in 3.4/4.3 and the promotion record. Add temporal properties only if that review requires them.

## 8. Consolidate and close adoption

- [x] 8.1 Audit several actual deliveries for wrong-property findings, drift, newly exposed ordering gaps and gate reliability; publish evidence and corrections without claiming an unmeasured reduction in production defects.
- [x] 8.2 Reconcile the knowledge map, adoption analysis and operational guidance with implemented coverage and rollback procedures; verify all 43 entries have concrete model/consumer/alternative decisions and explicit independent-review ownership. Required formal gates are active and final independent acceptance is complete; evidence statuses remain separate from review decisions.
- [x] 8.3 Run applicable project and model gates, obtain independent acceptance and owner approval of completed adoption, and archive this change only after all authorized implementation and knowledge work is verified.

Independent bounded contract/consumer acceptance: [review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Final implementation/gate/resource acceptance is recorded below, separately from bounded contract acceptance.

Resource checkpoint: the entire pool passed locally with a hard 4 GiB cgroup, no swap and 200% CPU quota, measured aggregate peak 1,149,575,168 bytes and no OOM kills. The 64 MiB control was OOM-killed; actual cancellation drained worker and descendant. CI repeats these controls and the existing broader-bound/host-order exploration. This is Linux/systemd evidence, not macOS/Windows resource certification.

## Accepted completion and archival

Independent final acceptance: [review 5517392425](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517392425) and [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140). Owner explicitly approved merge with a waiver, then separately authorized archival. PR #188 merged as `481ca1e817bb1fefb7ea1e24fe4adc2a8021333e`. The reviewed source head was `4e664ec2`; [exact-head full CI](https://github.com/IvoryHeart/herdr-world/actions/runs/38557803713) passed, including eleven models/180 commands, protected delivery, browser shards and both macOS lifecycle jobs.

Spec synchronization is a verified no-op: `.openspec.yaml` declares `skip_specs: true`, with no capability deltas. Existing product requirements remain unchanged. Finite bounds, mandatory consumer/platform tests, SQLite/crash assumptions, conditional progress and historical unexplained browser timing failures remain binding. Archival closes implementation planning; it does not expand the accepted claims.
