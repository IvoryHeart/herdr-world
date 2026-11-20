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

## Why

Expenses currently depend on configured OTel aggregates with no reliable pane attribution.
Issue #213 requires default harness-log usage as World data before Town and Board build their boards.

## What Changes

- Collect numeric usage from Claude, Codex, Pi and Gemini session files on each qualified local or SSH runtime; retain no conversation content.
- Expose one service-owned `world.usage.get` read verb with daily usage entities, host/workspace/tab/pane rollups, source health and bounded UTC windows.
- Keep sessions without unique current pane evidence at host level as unattributed.
- Deduplicate repeated responses and Codex cumulative counts, estimate USD only with an explicit versioned local price table, and distinguish missing data from zero.
- Keep optional unqualified OTel aggregates as labelled comparison observations; admit OTel into totals only with evidence of a disjoint scope or matching event identity (logs win).

## Capabilities

### New Capabilities

- `world-usage`: View-neutral, private, bounded harness usage, attribution, aggregation and optional telemetry reconciliation.

### Modified Capabilities

None. Existing runtime leases, World identity and verb admission remain binding.

## Impact

Service composition, qualified connection runtime helpers, a numeric host collector, shared response types, RPC registry, focused consumers and current usage documentation. No boards, shell actions, billing integration, transcript database or new runtime dependency. Owner and firstmate-2 authorized the design before implementation; independent PR review remains required.
