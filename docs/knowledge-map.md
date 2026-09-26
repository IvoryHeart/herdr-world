# Current repository knowledge

Use this map to locate ownership, then read the relevant contract, source and focused
test. For end-to-end module and data-flow navigation, use the
[foundation source guide](foundation-guide.md). [Current OpenSpec specs](../openspec/specs/) describe maintained product
behavior; source and tests show its implementation. [Active changes](../openspec/changes/)
hold deltas and decisions at different delivery stages. Check their task state with
`bun run spec -- list --json`; a completed task list alone does not replace a current
spec or prove verification. [Historical numbered specs](specs/) explain earlier
decisions and are not current operational guidance.

| When changing | Current contract | Start in source | Focused evidence or runbook |
| --- | --- | --- | --- |
| Saved local/SSH profiles, runtime leases, reconnects | [Runtime federation](../openspec/specs/runtime-federation/spec.md) | [Connection manager](../server/src/connections/manager.ts), [runtime](../server/src/connections/runtime.ts), [SSH runtime](../server/src/connections/ssh-profile-runtime.ts) | [Manager tests](../server/src/connections/manager.test.ts), [SSH tests](../server/src/connections/ssh-profile-runtime.test.ts), [deployment](DEPLOYMENT.md) |
| Browser RPC admission, origin, login, HTTP resources | [Bridge access](../openspec/specs/bridge-access/spec.md) | [Service entry](../server/src/index.ts), [browser admission](../server/src/http/browser-admission.ts), [auth](../server/src/http/auth.ts), [browser API](../web/src/api.ts) | [Admission tests](../server/src/http/browser-admission.test.ts), [API tests](../web/src/api.test.ts), [security](../SECURITY.md) |
| World snapshots and selected-host projection | [Runtime federation](../openspec/specs/runtime-federation/spec.md), [shared presentation](../openspec/specs/world-surfaces/spec.md#requirement-shared-presentation) | [Snapshot service](../server/src/world/snapshot.ts), [runtime store](../web/src/world/runtimeStore.ts), [WorldObject](../web/src/world/worldObject.ts) | [Snapshot tests](../server/src/world/snapshot.test.ts), [runtime-store tests](../web/src/world/runtimeStore.test.ts), [WorldObject tests](../web/src/world/worldObject.test.ts) |
| Shared shell, view selection and Inspector routing | [World shell](../openspec/specs/world-surfaces/spec.md#requirement-native-world-shell), [shared detail](../openspec/specs/world-surfaces/spec.md#requirement-shared-entity-detail-drawer) | [App](../web/src/App.tsx), [World shell](../web/src/world/WorldFoundationApp.tsx), [focused store](../web/src/store.ts) | [Shell tests](../web/src/world/WorldFoundationApp.test.ts), [store tests](../web/src/store.test.ts), [features](../FEATURES.md) |
| Office layout and optional metrics | [Office](../openspec/specs/world-surfaces/spec.md#requirement-pixel-office-scene), [optional observations](../openspec/specs/world-surfaces/spec.md#requirement-optional-observations) | [Office view](../web/src/world/PixelOfficeView.tsx), [Office projection](../web/src/world/herdrOfficeProjection.ts), [metrics service](../server/src/world/observability.ts) | [Office projection tests](../web/src/world/herdrOfficeProjection.test.ts), [metrics tests](../server/src/world/observability.test.ts), [metrics setup](DEPLOYMENT.md#optional-office-metrics) |
| Tree and Graph presentation | [Tree](../openspec/specs/world-surfaces/spec.md#requirement-connected-tree-presentation), [Graph](../openspec/specs/world-surfaces/spec.md#requirement-spatial-graph-presentation) | [Tree view](../web/src/world/ConnectedTreeView.tsx), [Graph view](../web/src/world/SpatialGraphView.tsx), [Graph layout](../web/src/world/graph/graphLayout.ts) | [Tree tests](../web/src/world/ConnectedTreeView.test.ts), [Graph layout tests](../web/src/world/graph/graphLayout.test.ts) |
| Actions and shared pane watches | [Visual Actions](../openspec/specs/world-surfaces/spec.md#requirement-visual-route-actions), [watchlist](../openspec/specs/world-surfaces/spec.md#requirement-shared-qualified-pane-watchlist) | [Action resolver](../web/src/world/visualRouteActions.ts), [watchlist service](../server/src/world/watchlist.ts), [watchlist store](../web/src/world/watchlistStore.ts) | [Action tests](../web/src/world/visualRouteActions.test.ts), [watchlist tests](../server/src/world/watchlist.test.ts) |
| Terminal protocol, attachment and presentation | [Live conversations](../openspec/specs/world-surfaces/spec.md#requirement-shared-live-terminal-conversations), [qualified admission](../openspec/specs/runtime-federation/spec.md#requirement-qualified-admission) | [Terminal bridge](../server/src/bridge/terminal-bridge.ts), [endpoint session](../server/src/bridge/endpoint-terminal-session.ts), [terminal view](../web/src/components/TerminalView.tsx) | [Bridge tests](../server/src/bridge/terminal-bridge.test.ts), [endpoint tests](../server/src/bridge/endpoint-terminal-session.test.ts), [architecture](ARCHITECTURE.md#terminal-endpoints) |
| Tab layouts and window arrangements | [Arrangements](../openspec/specs/world-surfaces/spec.md#requirement-arrange-existing-terminal-windows-from-the-shared-tab-bar) | [Tab layout](../web/src/visibleTabLayout.ts), [pane presenter](../web/src/TabTerminalPaneLayout.tsx), [arrangement model](../web/src/world/terminalWindowArrangement.ts) | [Layout tests](../web/src/visibleTabLayout.test.ts), [arrangement tests](../web/src/world/terminalWindowArrangement.test.ts) |
| Files, Git changes and worktrees | [Shared detail](../openspec/specs/world-surfaces/spec.md#requirement-shared-entity-detail-drawer) | [Workspace files](../server/src/workspace/files.ts), [Git actions](../server/src/workspace/git-actions.ts), [worktree creation](../server/src/worktree/create.ts), [File Explorer](../web/src/components/FileExplorerDialog.tsx) | [File tests](../server/src/workspace/files.test.ts), [Git tests](../server/src/workspace/git-actions.test.ts), [worktree tests](../server/src/worktree/create.test.ts) |
| Agent history, task summaries and checkout reports | [Task summaries](../openspec/specs/world-surfaces/spec.md#requirement-session-qualified-task-summaries), [checkout context](../openspec/specs/world-surfaces/spec.md#requirement-agent-checkout-source-control-context) | [Session history](../server/src/agent/session-history.ts), [task producer](../server/src/herdr/task-summary.ts), [checkout producer](../server/src/herdr/agent-checkout.ts), [checkout reader](../server/src/agent/checkout-context.ts) | [History tests](../server/src/agent/session-history.test.ts), [producer tests](../server/src/herdr/task-summary.test.ts), [checkout tests](../server/src/agent/checkout-context.test.ts), [harness commands](development.md#harness-task-summaries) |
| Installer, plugin, upstream sync and releases | [Distribution boundaries](../openspec/specs/distribution-boundaries/spec.md) | [Release tooling](../scripts/prepare-release.ts), [plugin tooling](../scripts/world-plugin.ts), [plugin manifest](../herdr-plugin.toml) | [Release tests](../scripts/prepare-release.test.ts), [upstream record](../UPSTREAM.md), [packaging](packaging.md), [release](release.md) |

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
