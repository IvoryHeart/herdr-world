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
