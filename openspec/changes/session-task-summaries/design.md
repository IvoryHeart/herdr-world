## Context

`web/src/world/worldObject.ts` already admits an optional 160-character `task_summary` from pane or agent snapshots; Office, Tree, Graph and Inspector consume it. The current Bun executable dispatches service and Herdr setup commands before starting the web service in `server/src/index.ts`. The former Rust World producer at commit `80e5799` used Herdr pane metadata with source `herdr-world:task-summary` and a default 15-minute TTL. That implementation is reference material, not code to port mechanically. The tagged [Herdr 0.9.0 metadata contract](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/socket-api.mdx) caps token values at 80 characters and says `agent`/`applies_to_source` guards do not apply to token patches. The packaged producer therefore reports at most 80 characters and must check session identity itself; the existing 160-character view bound remains for other optional observations.

## Goals / Non-Goals

**Goals:** Provide a small command suitable for harness hooks, leave Herdr authoritative for token expiry, and make report/clear/expiry visible through existing observation.

**Non-Goals:** Derive task text from terminal output or transcript files, persist a World task database, infer goals, assign work, or start a second World process.

## Decisions

### Use Herdr metadata as the only source of truth

Read the exact pane and its active Herdr `agent_session` (`source`, `agent`, `kind`, `value`) before reporting. Send the `task_summary` token and a `task_summary_session` token containing the lowercase hex SHA-256 of `JSON.stringify([source, agent, kind, value])` in one metadata call under World source `herdr-world:task-summary`, with the same Herdr TTL for both tokens. Reject a missing or malformed session field. On clear, remove exactly those two tokens. Herdr's token guards are insufficient for session binding: the World admission path recomputes the fingerprint from the current pane/agent session and exposes the summary only on an exact match. A replacement session hides old text immediately even before TTL expiry; an absent session never admits it. Confirm token roundtrip, expiry and update events against Herdr 0.9.0 before wiring the views. If those capabilities are absent, stop and revise this proposal rather than writing a World cache that can attach stale text to another agent.

### Dispatch before the web service starts

Add a dedicated command parser and runner alongside `server/src/herdr/cli.ts`, invoked before `main()` or server configuration can start listeners. Accept `--pane` or `HERDR_PANE_ID`, `--session` for the existing Herdr socket namespace, and `--ttl-ms` for reports only. Use the existing local control client and fixed-policy `--ssh-host` transport; do not route the producer through browser RPC or require a remote web service. Keep errors and success output bounded and omit the summary itself.

### Normalize before writing metadata

Collapse Unicode whitespace, reject empty input, redact common credential-shaped assignments and provider-token patterns, then cap to 80 Unicode code points with an ellipsis so Herdr does not silently trim the producer's result. Validate lifetime before any control request. Treat the text as untrusted data in all visual surfaces; display through existing text rendering, never HTML insertion. Tests use synthetic token strings only.

### Reconcile via existing observations

Confirm Herdr emits a pane update for report, clear and expiry. Ensure the service's subscription/invalidation path refreshes `world.snapshot`; the 15-second browser fallback remains a recovery path. Keep `task_summary` absent when missing and verify agent-session matching when pane metadata and `agent.list` disagree. Do not add another browser socket or summary poller.

## Risks / Trade-offs

- [Herdr token guards do not protect session identity] → Store a digest token in the same report and verify it against current `agent_session` before display; prove report, clear, TTL and replacement in a focused Herdr 0.9.0 compatibility check.
- [SSH invocation uses another host's pane ID] → Resolve one explicit target transport, then look up the pane on that transport; never fall back to local or another profile.
- [Redaction cannot identify every secret] → Document the bounded filter as defense in depth and tell harnesses to report short, non-secret summaries; never log raw input.

## Migration Plan

The field is already optional, so existing Herdr and browser snapshots remain valid. The new command can be rolled back without changing stored state; Herdr expires any previously reported token by its TTL.
