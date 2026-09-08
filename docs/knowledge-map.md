# Current repository knowledge

Read only the rows relevant to the task. Contracts describe intended observable behavior;
source and tests establish what is implemented. Reconcile discrepancies in the same change.
Historical delivery notes are evidence, not current rules.

| Topic | Maintained contract | Source and operational entry points |
| --- | --- | --- |
| Runtime ownership, host isolation, terminal identity | [Runtime federation](../openspec/specs/runtime-federation/spec.md) | [Architecture](architecture.md), [federation](federation.md); `web/src/hostRegistry.tsx`, `runtimeClient.ts`, `runtimeConnection.ts`, `terminalSessions.ts` |
| Browser commands and bridge access | [Bridge access](../openspec/specs/bridge-access/spec.md) | `web/src/commands.ts`, `bridgeApi.ts`, `remoteAccess.ts`; `bridge/src/web_bridge.rs`; [development](development.md) |
| Office, Tree, Graph, Spaces and optional observations | [World surfaces](../openspec/specs/world-surfaces/spec.md) | `web/src/world/worldModel.ts`, `worldRuntime.ts`, `herdrOfficeProjection.ts`, `tree/TreeTheme.tsx`, `tree/TreeTheme.css`, `graph/`; `web/src/AppShell.tsx`, `surfaceRegistry.ts`; [observability](observability.md), [assets](world-assets.md) |
| Upstream, vendoring and releases | [Distribution boundaries](../openspec/specs/distribution-boundaries/spec.md) | [UPSTREAM](../UPSTREAM.md), [vendoring](vendoring.md), [packaging](packaging.md), [release](release.md) |
| Agent development and evals | [Development harness](../openspec/specs/agent-development/spec.md) | [Agent development](agent-development.md), [Superpowers trial](superpowers-trial.md), `harness/`, `scripts/agent/`, `evals/` |

## Cross-language command path

For `workspace.rename`, start at `createCommands` in `web/src/commands.ts`.
It POSTs the method and parameters to the owning bridge's `/api/command`.
Qualified dispatch and current capability admission live in
`web/src/federatedRuntime.tsx` and `runtimeClient.ts`.
In `bridge/src/web_bridge.rs`, the route reaches `command_handler`, checks
`ALLOWED_COMMANDS`, deserializes the typed compatibility request, calls
`validate_web_command`, and sends `api.request` to the selected Herdr socket.
Read both ends and their tests. A same-language graph cannot establish this entire path.

## Historical decisions

- Specs 002 and 005–006: observability and optional Office projection.
- Specs 004, 013, 015–017: downstream, protocol and distribution history.
- Specs 001, 003, 007–012 and 018: Office/Graph presentation evolution.
- Spec 014: browser CI scaling.
- Spec 019: remote access and UI-managed network settings.

These capability specs are maintained summaries. Historical files retain rationale and
evidence; their immutable/extension/summary ceremony is retired. Unmapped areas remain
documented by source, tests and relevant runbooks. This map is not exhaustive API coverage.

Change a contract when behavior changes, a runbook when operation changes, and this map
when ownership changes. Unresolved proposals belong in `openspec/changes/`. Ralph
scratchpads, eval output, generated graphs and dated research are not authority.
Use synthetic examples only.
