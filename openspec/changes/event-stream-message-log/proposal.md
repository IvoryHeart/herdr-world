## Why

World needs one evidenced account of source changes and messages so Town,
Board, Chat, Inspector and a coordinator such as FirstMate agree about what
happened, who said it and what remains uncertain. Inspector also needs to
show the agent's actual working tree rather than silently using the workspace
launch directory.

## What Changes

- Organize systems of record by domain, served by provider plugins implementing
  one contract per domain: capabilities, provenance claims, verbs and auth/scopes.
  One provider and its configured instances can serve several domains.
- Propose capture of qualified source events into a bounded durable log with
  resumable cursors and rebuildable read models.
- Propose a message log/outbox with explicit threads, attributed senders,
  conditional recipient bindings and evidence-based delivery receipts.
- Use target-host harness adapters where their capabilities are established;
  preserve user-versus-peer standing and expose unsupported conditions.
- Define an evidenced agent-to-worktree read model and a shared, revalidated
  target for Inspector Files and Changes, including ambiguous candidates.
- Record the bounded relay experiments and their limits, and divide future
  implementation into dependency-ordered pod batches.

This PR contains review documents only. It neither implements the design nor
authorizes implementation, migrates existing storage or changes active APIs.
Current behavior remains governed by the existing specifications until the
approved implementation is delivered and its deltas are synchronized.

## Capabilities

### New Capabilities

- `provider-systems`: scoped systems of record, domain contracts, provider
  instances and the boundary to later plugin/skill marketplaces.
- `event-stream-message-log`: qualified capture/replay, durable message intents,
  conditional delivery, shared read models and evidenced worktree bindings.

### Modified Capabilities

None in this proposal. The new capability preserves the connection/generation,
stale-data and same-origin boundaries in `runtime-federation` and
`bridge-access`; it does not replace their requirements.

## Impact

Future implementation touches service observation and delivery adapters,
World-owned message persistence, browser read models and the agent CLI.
Inspector worktree integration can proceed in its separately authorized Chat
batch without depending on the event log. See [design](design.md) for the
boundary and [tasks](tasks.md) for phased acceptance.

No code, dependencies, migrations, release artifacts or current-spec files
change in this PR. All identifiers in examples are synthetic; no host paths,
session identifiers, credentials or private transcripts are included.
