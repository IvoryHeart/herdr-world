## Why

World needs one evidenced account of source changes and messages so Town,
Board, Chat, Inspector and a coordinator such as FirstMate agree about what
happened, who said it and what remains uncertain. Inspector already uses an
evidenced, shared working-tree target for Files and Changes. This proposal adds
event capture around that delivered resolver, without creating a second owner
of its selection and evidence rules.

## What Changes

- Organize systems of record by domain, served by provider plugins implementing
  one contract per domain: capabilities, provenance claims, verbs and auth/scopes.
  One provider and its configured instances can serve several domains; users
  see Connector and Connection with the same lifecycle for built-ins and later
  installations. Owners choose authority per scope.
- Prioritize current Herdr, Claude/Codex and GitHub via `gh`; keep existing Jira
  REST and OTel first-class and unchanged. New connectors require a CLI or
  standard protocol. MCP/marketplace integration stays later.
- Separate neutral skill requirements from per-staffing harness/mode/artifact
  bindings, sourced from native registries with independent evidence claims,
  explicit install effects and verified activation boundaries. Binding-specific
  evals and owner review precede agent-config UI work.
- Propose capture of qualified source events into a bounded durable log with
  resumable cursors and rebuildable read models.
- Propose a message log/outbox with explicit threads, attributed senders,
  bounded admission, scoped idempotency, conditional recipient bindings and
  causally correlated delivery receipts.
- Use target-host harness adapters where their capabilities are established;
  preserve user-versus-peer standing and expose unsupported conditions.
- Capture accepted worktree observations and viewer binding changes from the
  delivered Inspector resolver, preserving the current world-surfaces contract.
- Record the bounded relay experiments and their limits, and divide future
  implementation into dependency-ordered pod batches.

This PR contains review documents only. It neither implements the design nor
authorizes implementation, migrates existing storage or changes active APIs.
Current behavior remains governed by the existing specifications until the
approved implementation is delivered and its deltas are synchronized.

## Capabilities

### New Capabilities

- `provider-systems`: scoped systems of record, domain contracts, provider
  instances, connector lifecycle and harness-specific skill bindings.
- `event-stream-message-log`: qualified capture/replay, durable message intents,
  conditional delivery, shared read models and worktree observation/binding events.

### Modified Capabilities

None: the narrow added event-capture requirement consumes the existing
[Agent worktree source-control context](../../specs/world-surfaces/spec.md#requirement-agent-worktree-source-control-context)
without modifying or restating it. The new capability also preserves the
connection/generation, stale-data and same-origin boundaries in
`runtime-federation` and `bridge-access`.

## Impact

Future implementation touches service observation and delivery adapters,
World-owned message persistence, browser read models and the agent CLI.
The delivered Inspector worktree integration (#338, implementation 55e0b81f)
remains independent of the event log; only its capture interface is proposed
here. See [design](design.md) for the boundary and [tasks](tasks.md) for phased
acceptance.

No code, dependencies, migrations, release artifacts or current-spec files
change in this PR. All identifiers in examples are synthetic; no host paths,
session identifiers, credentials or private transcripts are included.
