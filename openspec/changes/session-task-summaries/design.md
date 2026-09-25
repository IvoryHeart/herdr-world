## Context

`web/src/world/worldObject.ts` already admits an optional 160-character `task_summary` from pane or agent snapshots; Office, Tree, Graph and Inspector consume it. The current Bun executable dispatches service and Herdr setup commands before starting the web service in `server/src/index.ts`. The former Rust World producer at commit `80e5799` used Herdr pane metadata with source `herdr-world:task-summary`, a default 15-minute TTL and session-source binding. That implementation is reference material, not code to port mechanically. Verify the method and session behavior against the Herdr 0.9.0 control API before coding.

## Goals / Non-Goals

**Goals:** Provide a small command suitable for harness hooks, leave Herdr authoritative for token expiry, and make report/clear/expiry visible through existing observation.

**Non-Goals:** Derive task text from terminal output or transcript files, persist a World task database, infer goals, assign work, or start a second World process.

## Decisions

### Use Herdr metadata as the only source of truth

Read the exact pane and its active agent-session/source metadata before reporting. Send only the `task_summary` token under the World-owned source, with Herdr TTL and source binding. On clear, remove only that source/token. This avoids a second lifecycle and lets Herdr expire text. If Herdr 0.9.0 cannot enforce session replacement semantics, stop and revise this proposal rather than writing a World cache that can attach stale text to another agent.

### Dispatch before the web service starts

Add a dedicated command parser and runner alongside `server/src/herdr/cli.ts`, invoked before `main()` or server configuration can start listeners. Accept `--pane` or `HERDR_PANE_ID`, `--session` for the existing Herdr socket namespace, and `--ttl-ms` for reports only. Use the existing local control client and fixed-policy `--ssh-host` transport; do not route the producer through browser RPC or require a remote web service. Keep errors and success output bounded and omit the summary itself.

### Normalize before writing metadata

Collapse Unicode whitespace, reject empty input, redact common credential-shaped assignments and provider-token patterns, then cap to 160 Unicode code points with an ellipsis. Validate lifetime before any control request. Treat the text as untrusted data in all visual surfaces; display through existing text rendering, never HTML insertion. Tests use synthetic token strings only.

### Reconcile via existing observations

Confirm Herdr emits a pane update for report, clear and expiry. Ensure the service's subscription/invalidation path refreshes `world.snapshot`; the 15-second browser fallback remains a recovery path. Keep `task_summary` absent when missing and verify agent-session matching when pane metadata and `agent.list` disagree. Do not add another browser socket or summary poller.

## Risks / Trade-offs

- [Herdr API or semantics differ from the retired Rust bridge] → Prove report, clear, TTL and replacement in a focused Herdr 0.9.0 compatibility check before implementing UI changes; revise the contract if the prerequisite is absent.
- [SSH invocation uses another host's pane ID] → Resolve one explicit target transport, then look up the pane on that transport; never fall back to local or another profile.
- [Redaction cannot identify every secret] → Document the bounded filter as defense in depth and tell harnesses to report short, non-secret summaries; never log raw input.

## Migration Plan

The field is already optional, so existing Herdr and browser snapshots remain valid. The new command can be rolled back without changing stored state; Herdr expires any previously reported token by its TTL.
