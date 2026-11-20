## Delivery state

Implementation delivered; the November audit retains this change because
later limits/context/tap acceptance is not established by base PR #642 alone,
and the new stale-lock counterexample violates the window-maxima contract.
Q55 and issue #1086 record the actual 20 → 23 → 22 trace; this is unfinished
repair/acceptance, not an unsynchronized delivered requirement.

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

- [ ] Repair #1086's stale-owner commit protocol and replace Q55's expected
  counterexample with positive model/consumer conformance.
- [ ] Reconcile independent acceptance of later subscription/context/tap
  consumers (#717, #727, #750, #853); #642's numeric-reader review is narrower.
