# Current repository knowledge

Use this map to locate ownership, then read the relevant contract, source and focused
test. For end-to-end module and data-flow navigation, use the
[foundation source guide](foundation-guide.md); for visual and terminal tasks,
use the [World component routes](../web/src/world/README.md).
[Current OpenSpec specs](../openspec/specs/) describe maintained product
behavior; source and tests show its implementation. [Active changes](../openspec/changes/)
hold deltas and decisions at different delivery stages. Check their task state with
`bun run spec -- list --json`; a completed task list alone does not replace a current
spec or prove verification. [Historical numbered specs](specs/) explain earlier
decisions and are not current operational guidance.

| When changing | Current contract | Start in source | Focused evidence or runbook |
| --- | --- | --- | --- |
| Saved local/SSH profiles, runtime leases, reconnects | [Runtime federation](../openspec/specs/runtime-federation/spec.md) | [Connection manager](../server/src/connections/manager.ts), [runtime](../server/src/connections/runtime.ts), [SSH runtime](../server/src/connections/ssh-profile-runtime.ts), [Windows bridge](../server/src/bridge/ssh-windows.ts) | [Manager tests](../server/src/connections/manager.test.ts), [SSH tests](../server/src/connections/ssh-profile-runtime.test.ts), [Windows bridge tests](../server/src/bridge/ssh-windows.test.ts), [deployment](DEPLOYMENT.md) |
| Browser RPC admission, origin, login, HTTP resources | [Bridge access](../openspec/specs/bridge-access/spec.md) | [Service entry](../server/src/index.ts), [management CLI](../server/src/cli/index.ts), [browser admission](../server/src/http/browser-admission.ts), [auth](../server/src/http/auth.ts), [private signing state](../server/src/config/session-secret.ts), [browser API](../web/src/api.ts) | [Admission tests](../server/src/http/browser-admission.test.ts), [PIN tests](../server/src/http/auth-pin.test.ts), [signing-state tests](../server/src/config/session-secret.test.ts), [API tests](../web/src/api.test.ts), [security](../SECURITY.md) |
| World snapshots, aggregate filters and fair projection | [Runtime federation](../openspec/specs/runtime-federation/spec.md), [shared presentation](../openspec/specs/world-surfaces/spec.md#requirement-shared-presentation) | [Snapshot service](../server/src/world/snapshot.ts), [runtime store](../web/src/world/runtimeStore.ts), [snapshot decoder](../web/src/worldSnapshotDecode.ts), [WorldObject](../web/src/world/worldObject.ts) | [Snapshot tests](../server/src/world/snapshot.test.ts), [decoder tests](../web/src/worldSnapshotDecode.test.ts), [runtime-store tests](../web/src/world/runtimeStore.test.ts), [WorldObject tests](../web/src/world/worldObject.test.ts), [production responsiveness](../web/src/world/testing/productionContextAcceptance.ts), [World browser shards](../scripts/world-browser-suites.ts) |
| Shared shell, view selection and Inspector routing | [World shell](../openspec/specs/world-surfaces/spec.md#requirement-native-world-shell), [shared detail](../openspec/specs/world-surfaces/spec.md#requirement-shared-entity-detail-drawer) | [World shell](../web/src/world/WorldFoundationApp.tsx), [view composition](../web/src/world/WorldControlPlane.tsx), [qualified Inspector selection](../web/src/world/worldInspectorSelection.ts), [focused Spaces App](../web/src/App.tsx), [Inspector presentation](../web/src/world/worldTerminalPresentation.ts) | [Shell tests](../web/src/world/WorldFoundationApp.test.ts), [Inspector routes](../web/src/world/README.md#inspector-and-windows) |
| Desk triage and turn receipts | [Desk change](../openspec/changes/archive/2026-10-03-desk-attention-triage/specs/world-surfaces/spec.md), [handoffs proposal](https://github.com/IvoryHeart/herdr-world/issues/151) | [Desk view](../web/src/world/DeskView.tsx), [receipts, review marks and polling bounds](../web/src/world/handoffs.ts), [screen excerpts](../web/src/world/paneScreen.ts), [turn receipt](../server/src/agent/turn-receipt.ts), [`agent_turn.get`](../server/src/agent/agent-sessions.ts) | [Desk tests](../web/src/world/DeskView.test.ts), [receipt tests](../server/src/agent/turn-receipt.test.ts), [Desk routes](../web/src/world/README.md#desk) |
| Arranged Inspector pointer and keyboard focus | [Window arrangement](../openspec/specs/world-surfaces/spec.md#requirement-fit-and-restore-window-arrangements) | [Inspector window coordination](../web/src/world/useWorldInspectorWindows.ts), [shared frame](../web/src/world/windows/WindowFrame.tsx), [window state](../web/src/world/windows/windowManager.ts) | [Terminal handoff browser test](../web/src/world/WorldTerminalHandoff.test.ts) |
| Office layout and optional metrics | [Office](../openspec/specs/world-surfaces/spec.md#requirement-pixel-office-scene), [optional observations](../openspec/specs/world-surfaces/spec.md#requirement-optional-observations) | [Office view](../web/src/world/PixelOfficeView.tsx), [Office projection](../web/src/world/herdrOfficeProjection.ts), [renderer lifetime](../web/src/world/officeRenderer.ts), [room drawing](../web/src/world/officeRoomDrawing.ts), [metrics service](../server/src/world/observability.ts) | [Office routes and tests](../web/src/world/README.md#office), [metrics setup](DEPLOYMENT.md#optional-office-metrics) |
| Town view | [World surfaces: Town](../openspec/specs/world-surfaces/spec.md#requirement-town-scene) | [Town view](../web/src/world/TownView.tsx), [town layout](../web/src/world/town/townLayout.ts), [town renderer](../web/src/world/town/townRenderer.ts), [peek and chat](../web/src/world/town/townChat.ts), [desk and agent moves](../server/src/world/desk-move.ts) | [Town routes and tests](../web/src/world/README.md#town), [asset provenance](world-assets.md) |
| Tree hierarchy, search and managed Inspectors | [Tree](../openspec/specs/world-surfaces/spec.md#requirement-connected-tree-presentation) | [Tree view](../web/src/world/ConnectedTreeView.tsx), [projection](../web/src/world/treeProjection.ts), [styles](../web/src/world/world-tree.css) | [Tree routes and tests](../web/src/world/README.md#tree) |
| Graph toolbar, projection, canvas and layout | [Graph](../openspec/specs/world-surfaces/spec.md#requirement-spatial-graph-presentation) | [Graph view](../web/src/world/SpatialGraphView.tsx), [canvas](../web/src/world/graph/GraphCanvas.tsx), [projection](../web/src/world/graph/graphProjection.ts), [layout](../web/src/world/graph/graphLayout.ts), [styles](../web/src/world/world-graph.css) | [Graph routes and tests](../web/src/world/README.md#graph) |
| Actions and shared pane watches | [Visual Actions](../openspec/specs/world-surfaces/spec.md#requirement-visual-route-actions), [watchlist](../openspec/specs/world-surfaces/spec.md#requirement-shared-qualified-pane-watchlist) | [Action resolver](../web/src/world/visualRouteActions.ts), [watchlist service](../server/src/world/watchlist.ts), [watchlist store](../web/src/world/watchlistStore.ts) | [Action tests](../web/src/world/visualRouteActions.test.ts), [watchlist tests](../server/src/world/watchlist.test.ts) |
| Terminal protocol, attachment and presentation | [Live conversations](../openspec/specs/world-surfaces/spec.md#requirement-shared-live-terminal-conversations), [qualified admission](../openspec/specs/runtime-federation/spec.md#requirement-qualified-admission) | [Terminal bridge](../server/src/bridge/terminal-bridge.ts), [endpoint session](../server/src/bridge/endpoint-terminal-session.ts), [terminal view](../web/src/components/TerminalView.tsx), [handoff fixture](../web/src/world/WorldTerminalHandoff.browser.tsx) | [Bridge tests](../server/src/bridge/terminal-bridge.test.ts), [handoff browser regression](../web/src/world/WorldTerminalHandoff.test.ts), [presentation routes and tests](../web/src/world/README.md#terminal-presentation), [architecture](ARCHITECTURE.md#terminal-endpoints) |
| Phone app bar, bottom navigation and system Back | [World shell](../openspec/specs/world-surfaces/spec.md#requirement-native-world-shell) | [Mobile terminal controls](../web/src/components/MobileControls.tsx), [system Back layers](../web/src/systemBack.ts), [bottom navigation](../web/src/world/WorldMobileNav.tsx), [World shell](../web/src/world/WorldFoundationApp.tsx) | [System Back browser fixture](../web/src/systemBack.browser.tsx), [mobile terminal browser tests](../web/src/mobileTerminal.test.ts), [handoff browser regression](../web/src/world/WorldTerminalHandoff.test.ts) |
| Workspace/tab creation in all views | [Shared creation](../openspec/specs/world-surfaces/spec.md#requirement-creation-from-the-current-world-view), [readiness](../openspec/specs/world-surfaces/spec.md#requirement-qualified-creation-preparation-and-readiness) | [Creation coordination](../web/src/creationRequests.ts), qualified creation in [store](../web/src/store.ts), [shared completion](../web/src/world/useWorldCreatedTerminal.ts) | [Creation store tests](../web/src/worldCreation.test.ts), [browser matrix](../web/src/world/SharedViewCreation.test.ts), [source routes](../web/src/world/README.md#shared-creation) |
| Tab layouts and window arrangements | [Arrangements](../openspec/specs/world-surfaces/spec.md#requirement-arrange-existing-terminal-windows-from-the-shared-tab-bar) | [Tab layout](../web/src/visibleTabLayout.ts), [pane presenter](../web/src/TabTerminalPaneLayout.tsx), [window manager](../web/src/world/windows/windowManager.ts), [shared frame](../web/src/world/windows/WindowFrame.tsx) | [Layout tests](../web/src/visibleTabLayout.test.ts), [window model tests](../web/src/world/windows/windowManager.test.ts), [frame browser tests](../web/src/world/windows/WindowFrame.test.ts) |
| Files, Git changes and worktrees | [Shared detail](../openspec/specs/world-surfaces/spec.md#requirement-shared-entity-detail-drawer) | [Workspace files](../server/src/workspace/files.ts), [Git actions](../server/src/workspace/git-actions.ts), [worktree creation](../server/src/worktree/create.ts), [File Explorer](../web/src/components/FileExplorerDialog.tsx) | [File tests](../server/src/workspace/files.test.ts), [Git tests](../server/src/workspace/git-actions.test.ts), [worktree tests](../server/src/worktree/create.test.ts) |
| Agent history, task summaries and checkout reports | [Task summaries](../openspec/specs/world-surfaces/spec.md#requirement-session-qualified-task-summaries), [checkout context](../openspec/specs/world-surfaces/spec.md#requirement-agent-checkout-source-control-context) | [Session history](../server/src/agent/session-history.ts), [task producer](../server/src/herdr/task-summary.ts), [checkout producer](../server/src/herdr/agent-checkout.ts), [checkout reader](../server/src/agent/checkout-context.ts) | [History tests](../server/src/agent/session-history.test.ts), [producer tests](../server/src/herdr/task-summary.test.ts), [checkout tests](../server/src/agent/checkout-context.test.ts), [harness commands](development.md#harness-task-summaries) |
| Ranger workspace assistant | [Contract](../openspec/specs/workspace-assistant/spec.md), [service](../server/src/assistant/service.ts), [captured context](../server/src/assistant/context.ts), [browser client](../web/src/assistant.ts) | [Context tests](../server/src/assistant/context.test.ts), [service tests](../server/src/assistant/service.test.ts), [recovery tests](../server/src/assistant-recovery.integration.test.ts), [setup](DEPLOYMENT.md#ranger-workspace-assistant) |
| Task notifications, browser alerts and Web Push | [Runtime authority](../openspec/specs/runtime-federation/spec.md#requirement-runtime-authority), [access boundary](../openspec/specs/bridge-access/spec.md#requirement-explicit-access-policy) | [Runtime listener](../server/src/notifications/herdr-notification-listener.ts), [push service](../server/src/notifications/web-push.ts), [browser push](../web/src/taskPush.ts), [service worker](../web/public/task-notifications-sw.js) | [Push tests](../server/src/notifications/web-push.test.ts), [browser tests](../web/src/taskPush.browser.tsx), [foundation route](foundation-guide.md#follow-a-request-across-the-boundary) |
| Herdr setup, service management and updates | [Access boundary](../openspec/specs/bridge-access/spec.md), [distribution](../openspec/specs/distribution-boundaries/spec.md) | [Herdr CLI](../server/src/herdr/cli.ts), [setup](../server/src/http/herdr-setup.ts), [service manager](../server/src/config/service-manager.ts), [update handler](../server/src/http/update.ts) | [Setup tests](../server/src/http/herdr-setup.test.ts), [update tests](../server/src/http/update.test.ts), [deployment](DEPLOYMENT.md) |
| Installer, plugin, upstream sync and releases | [Distribution boundaries](../openspec/specs/distribution-boundaries/spec.md) | [Release tooling](../scripts/prepare-release.ts), [plugin tooling](../scripts/world-plugin.ts), [native plugin dispatch](../server/src/config/plugin-command.ts), [Unix installer](../scripts/install-plugin.sh), [Windows installer](../scripts/install-plugin.ps1), [plugin manifest](../herdr-plugin.toml) | [Release tests](../scripts/prepare-release.test.ts), [native compatibility](../scripts/plugin-native.test.ts), [Windows installation](../scripts/install-plugin.windows.test.ts), [upstream record](../UPSTREAM.md), [adoption policy](upstream-policy.md), [disposition ledger](../upstream/dispositions.json), [packaging](packaging.md), [release](release.md), [screenshot capture](SCREENSHOTS.md) |

Desktop shortcut discovery lives in [the read-only cheat sheet](../web/src/components/ShortcutCheatSheet.tsx)
and [its preset-derived rows and filtering](../web/src/shortcutCheatSheet.ts), with
[preset/filter regressions](../web/src/shortcutCheatSheet.test.ts). Workspace and
worktree naming uses [the lazy generator](../web/src/luckyName.ts) and
[the suggestion lifecycle hook](../web/src/components/useSuggestedName.ts);
[dialog regressions](../web/src/components/ModalDialogs.test.ts) cover late suggestions.

## CI and release validation

[Upstream automation](upstream-automation.md) covers Roamgate release detection,
frozen integration PRs, independent Codex review, credentials and recovery.
[Installer upgrade CI](release.md#pre-merge-installer-upgrades) builds proposed merges
and checks fresh installation and upgrade from a frozen latest stable release on
all six native platforms. Start with [the harness](../scripts/installer-upgrade.ts),
[gate regressions](../scripts/installer-upgrade.test.ts) and
[the reusable workflow](../.github/workflows/installer-upgrade.yml).
Start with [the synchronization helper](../scripts/upstream-sync.ts) and its
[regressions](../scripts/upstream-sync.test.ts) for automation changes.
The [local worker launcher](../scripts/upstream-local.ts) uses cached Codex
subscription sign-in and serializes scheduled runs on the user's machine.

[Development verification](development.md#verification) describes local and CI
runner settings. [PR CI](../.github/workflows/ci.yml) and
[Release](../.github/workflows/release.yml) call the same
[World browser workflow](../.github/workflows/world-browser.yml).
[Prepare Release](../.github/workflows/prepare-release.yml) validates generated
files in its own checkout. Start with [CI workflow tests](../scripts/ci-workflow.test.ts)
and [release validation tests](../scripts/release-validation.test.ts) when changing
concurrency, shard coverage or publication dependencies.
For first-case browser timeouts, use the opt-in lifecycle comparison described in
[development verification](development.md#verification), the
[diagnostic adapter](../scripts/browser-diagnostics.ts) and its
[regression tests](../scripts/browser-diagnostics.test.ts). Keep baseline and
candidate evidence together before diagnosing a runner or fixture defect.
World harnesses separate bounded Chrome startup from fixture execution using
[the browser deadline helper](../web/src/browserChrome.ts) and its
[regression tests](../web/src/browserChrome.test.ts). The fixture clock starts at
the main HTML request, before loading assets or initializing the application;
responsiveness and operation limits remain unchanged.

## RPC paths

`web/src/api.ts` owns one WebSocket to the World service. Bridge-global methods such as
`connections.*` and `world.snapshot` carry no connection identity. New downstream
browser methods carry an immutable `connection_id` and runtime
`connection_generation`; routing and lease revalidation live in
`server/src/connections/` and `server/src/index.ts`. The retained compatibility
route accepts an omitted connection ID by selecting the process default, and
compares generation only when supplied. Legacy HTTP paths have the same default
route; do not use either omission for new browser work.

The aggregate observation path is read-only: `server/src/world/snapshot.ts` schedules
at most four per-host observations, rotates open-context priorities with background
progress, and returns a
complete catalogue by its 20-second deadline with unfinished cached hosts stale.
`web/src/world/runtimeStore.ts` rejects late aggregate responses, and
negotiated [snapshot admission](../server/src/bridge/world-snapshot-admission.ts)
bounds unadmitted chunk batches on each browser socket independently of terminal
replies. Old transports retain the ordinary chunk protocol.
`web/src/world/worldObject.ts` qualifies every node by connection. Mutations and terminal
attachments use captured operational contexts and independently addressable sessions
in `web/src/store.ts`. The persisted `hostsFilter.ts` affects visibility only;
`spaceAdmission.ts` shares Tree/Graph capacity fairly and `WorldSearchResults.tsx`
pages full-observation matches beyond renderer bounds.

Repository workflow lives in [AGENTS.md](../AGENTS.md) and
[agent development](agent-development.md). The optional visible-team recipe is
under [`.hwf/workflows/`](../.hwf/workflows/). Use synthetic data in tracked evidence.
The optional [Quint adoption spike](quint-adoption-spike.md) inventories formal
modeling candidates and records bounded model/replay experiments; it is not a CI gate.
The [Quint adoption proposal](../openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/proposal.md)
defines the planned policy, promotion criteria and staged repository-wide coverage.
The [maintained behavioral evidence](../verification/README.md) maps all 43 areas to
current requirements, existing tests, accepted delivery and concrete model/consumer
or alternative evidence decisions. The [implementation report](quint-adoption-implementation.md)
records maintained checks, actual-delivery audit, claim limits and completed acceptance.
[Consumer evidence](../verification/consumer-evidence.md) explains shared guarantees
and implementation/browser/platform alternatives.

[Promotion review](../verification/promotion-review.md) tracks each contract's bounds,
accepted consumer obligations and exclusions. [Observation progress](../verification/contracts/observation-progress.md)
records scheduler/deadline assumptions separately from model reachability.

Canonical Quint execution uses the tracked [bounded worker configuration](../tools/quint/execution.json)
and produces an aggregate requiring all isolated model-case manifests; see the
[parallel execution contract](../verification/README.md#bounded-parallel-execution).

Maintained models and replay adapters live in top-level [`quint/`](../quint/README.md).
Protected delivery includes the [behavioral workflow](../.github/workflows/behavioral-verification.yml),
[local delivery command](../package.json), [aggregate resource runner](../scripts/verification-resources.ts)
and [hard Linux envelope](../tools/quint/resources.json); final approval remains separate.

Evidence publication uses [the shared acceptance boundary](../scripts/verification-publication.ts).
[Canonical finalization regressions](../scripts/verification-parallel.test.ts)
verify late cancellation invalidates aggregates and retains diagnostics;
[checker regressions](../scripts/verification-checker.test.ts) cover owned teardown.
Authoritative [agent guidance](../AGENTS.md#behavioral-verification) describes the
implemented protected gate and completed final acceptance.

Quint adoption is accepted and merged in PR #188; [archived completion](../openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/tasks.md#accepted-completion-and-archival) records final reviews, owner approval, source-bound CI and the no-op spec synchronization. Current evidence remains maintained under `verification/` and `quint/`.
