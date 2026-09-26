# Current repository knowledge

Contracts describe intended behavior; source and tests establish implementation. Read
only the rows relevant to the task. Historical numbered specs are rationale, not current
operational guidance.

| Topic | Maintained contract | Source and runbooks |
| --- | --- | --- |
| Managed local/SSH runtimes, qualification, retries | [Runtime federation](../openspec/specs/runtime-federation/spec.md) | `server/src/connections/`, `server/src/bridge/`, [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) |
| Browser RPC, authentication and same-origin access | [Bridge access](../openspec/specs/bridge-access/spec.md) | `server/src/index.ts`, `server/src/http/`, `web/src/api.ts`, [security](../SECURITY.md) |
| Aggregate WorldObject, Spaces, Office, Tree and Graph | [World surfaces](../openspec/specs/world-surfaces/spec.md) | `server/src/world/snapshot.ts`, `web/src/world/`, `web/src/App.tsx`, [features](../FEATURES.md) |
| Tab layouts and window arrangements | [World surfaces](../openspec/specs/world-surfaces/spec.md) | `web/src/visibleTabLayout.ts`, `web/src/TabTerminalPaneLayout.tsx`, `web/src/world/terminalWindowArrangement.ts`, `web/src/world/terminalWindowArrangementState.ts`, `web/src/world/WorldFoundationApp.tsx` |
| Shared pane watches and shell Actions | [World surfaces](../openspec/specs/world-surfaces/spec.md) | `server/src/world/watchlist.ts`, `web/src/components/CommandCombobox.tsx`, `web/src/world/WorldFoundationApp.tsx`, `web/src/world/visualRouteActions.ts` |
| Terminals, Files, Changes and Agent History | [World surfaces](../openspec/specs/world-surfaces/spec.md) | `server/src/bridge/`, `server/src/workspace/`, `server/src/herdr/agent-checkout.ts`, `server/src/agent/checkout-context.ts`, `web/src/components/`, [architecture](ARCHITECTURE.md) |
| Upstream, packages, plugin and releases | [Distribution boundaries](../openspec/specs/distribution-boundaries/spec.md) | [UPSTREAM](../UPSTREAM.md), [packaging](packaging.md), [release](release.md), `scripts/`, `herdr-plugin.toml` |

## RPC paths

`web/src/api.ts` owns one WebSocket to the World service. Bridge-global methods such as
`connections.*` and `world.snapshot` carry no connection identity. Downstream methods
carry an immutable `connection_id` and runtime `connection_generation`; routing and
lease revalidation live in `server/src/connections/` and `server/src/index.ts`.

The aggregate observation path is read-only: `server/src/world/snapshot.ts` schedules
at most four per-host observations, prioritizes the selected host, and returns a
complete catalogue by its 20-second deadline with unfinished cached hosts stale.
`web/src/world/runtimeStore.ts` rejects late aggregate responses, and
`web/src/world/worldObject.ts` qualifies every node by connection. Mutations and terminal
attachments continue through the focused connection store in `web/src/store.ts`.

Repository workflow lives in [AGENTS.md](../AGENTS.md) and
[agent development](agent-development.md). Use synthetic data in tracked evidence.
