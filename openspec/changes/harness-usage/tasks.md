## Delivery state

Implementation delivered; the November audit retains this change because
later limits/context/tap acceptance is not established by base PR #642 alone,
and the audit found a stale-lock violation of the window-maxima contract.
Issue #1086 repairs publication ownership; Q55 now records positive model and
consumer conformance with the original 20 → 23 → 22 trace retained as a fault
control. Broader limits/context/tap acceptance remains unfinished.

Delivered requirements are synchronized into [the current contract](../../specs/world-usage/spec.md).
No unsynchronized requirement delta remains in this record; unfinished tasks
and acceptance above keep the change active.

## Contract

- [x] Define one shared usage read API, numeric privacy, exact attribution, UTC windows, estimates and OTel reconciliation.
- [x] Document supported source formats, host requirements, limits and health states.

## Implementation

- [x] Project bounded Claude, Codex, Pi and Gemini numeric usage on the owning local/SSH host.
- [x] Retain bounded host-local per-file offsets/parser state, favor newest files and scan older Codex metadata for activity without inventing unique identity.
- [x] Restrict bound files to harness roots/extensions and pass remote paths over stdin.
- [x] Derive stable entity IDs without durable allocations; expose windows, rollups and optional price estimates through `world.usage.get`.
- [x] Check attribution once after collection and fence generations, cancellation, deadlines and shutdown with owned exit/reap receipts.

## Verification

- [x] Verify counted-once tokens, high-water recovery, copied preambles, ambiguous/incomplete claims, incremental reads and bounded cache eviction.
- [x] Verify local/SSH adapters, source health, UTC windows, estimates, telemetry exclusion and frame admission.
- [x] Verify descriptor containment, growing-rewrite samples/daily rebuilds, line-budget retry, multi-session budget recovery, active old-date discovery and idle/numeric reader failure teardown.
- [x] Update contract docs and direct consumer mappings.

## Audit follow-up

- [x] Repair #1086's stale-owner commit protocol and replace Q55's expected
  counterexample with positive model/consumer conformance.
- [ ] Reconcile independent acceptance of later subscription/context/tap
  consumers (#717, #727, #750, #853); #642's numeric-reader review is narrower.
