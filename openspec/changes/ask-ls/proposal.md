## Why

An agent trying `ask list` accidentally created an owner question containing
only “list”. Agents need a discoverable way to recover their question IDs and
states, and command words must never become accidental owner alerts.

## What Changes

- Add caller-scoped `herdr-world ask ls`, shaped like `result ls`, with JSON
  support and no new state filter.
- Refuse command-word-only questions before recording or alerting the owner.
- Update the agent guide, completion actions and installed guide version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ask-answer-delivery`: Caller question discovery and quiet command-word refusal.

## Impact

CLI parsing and guide, the existing authenticated CLI endpoint and verb registry,
and a read-only projection of the existing question ledger. No storage or UI changes.
Issue #1362 authorizes implementation; no decisions remain unresolved.
