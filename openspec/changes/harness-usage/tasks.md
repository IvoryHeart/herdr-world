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
