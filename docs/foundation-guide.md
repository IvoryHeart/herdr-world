# Foundation source guide

This guide maps the implemented service and browser foundation. Start with the
[knowledge map](knowledge-map.md) for a task-specific contract and test, then use
this guide when a change crosses modules. [Architecture](ARCHITECTURE.md) records
the detailed system boundaries; [deployment](DEPLOYMENT.md) records operator
configuration. The application source is [derived from Roamgate](../UPSTREAM.md),
with Herdr TUI and herdr-core as external runtimes. Git history and `UPSTREAM.md` establish source
lineage; a file's directory alone does not identify its origin. The current focused
client lives in [App.tsx](../web/src/App.tsx) and [store.ts](../web/src/store.ts).
The active service-side Herdr socket adapter lives in [server/src/bridge/](../server/src/bridge/).
The retired browser-federated/Rust bridge and remote bridge URL are separate from
this active adapter; browser traffic stays on the one World origin.

The agent History/session resolver owns Codex binding.
[Conversation binding](../server/src/agent/conversation-binding.ts) derives
reported/title fingerprints and session labels for the Herdr source.
[Daemon observation](../server/src/agent/codex-app-server.ts) implements bounded
read-only JSON-RPC on the selected runtime, and
[inference](../server/src/agent/codex-daemon-binding.ts) checks unique panes and
threads, unchanged evidence and recent matching activity. A
runtime-owned [discovery cache](../server/src/agent/codex-discovery-cache.ts)
shares in-flight reads and backs off failures; quest batches retain successful
metadata only until their final pane check and snapshot finish. Recent unloaded
threads remain competitors, and unseen daemon clients remain an explicit limit.
The
[protocol tests](../server/src/agent/codex-app-server.test.ts) and
[binding tests](../server/src/agent/codex-daemon-binding.test.ts) cover transport
failure, collisions, connection isolation and refusal of inferred input authority.

History's Details Chat input is separate from the primary session-bound Chat
composer. [HistoryTerminalComposer](../web/src/components/HistoryTerminalComposer.tsx)
adapts the shared [History composer](../web/src/components/AgentHistoryComposer.tsx)
to World clients and runtime-qualified drafts. The
[mobile agent launcher](../web/src/components/AgentLauncher.tsx) resolves integrations
on the captured connection; [command preferences](../web/src/agentLauncher.ts) use
the World storage namespace per connection and agent. The optional attributed
[Codex shell helper](../scripts/codex-herdr.sh) applies pane-scoped launch flags;
see [History guidance](HISTORY.md#pane-scoped-codex-launches).

## Delivered contracts and remaining work

Delivered [usage](../openspec/specs/world-usage/spec.md),
[local harness integration](../openspec/specs/world-harness-integration/spec.md),
[answer delivery](../openspec/specs/ask-answer-delivery/spec.md),
[profiles and launcher](../openspec/specs/world-surfaces/creation-profiles/spec.md#requirement-agent-profiles),
[chimes](../openspec/specs/world-surfaces/notifications/spec.md#requirement-chimes) and the
[Town Master greeting](../openspec/specs/world-surfaces/town-master/spec.md#requirement-town-master-greeting)
have current requirements. Their active records retain unfinished follow-ups or
explicit acceptance reconciliation; synchronization alone does not accept them.
See the [usage guide](usage.md), [harness integration guide](harness-integrations.md)
and [remaining SSH/update tasks](../openspec/changes/world-harness-integration/tasks.md)
for operational details and remaining scope. Focused acquisition's
[design](../openspec/changes/archive/2026-11-18-shared-acquisition/design.md) is archived;
current contracts cover [focused observation](../openspec/specs/runtime-federation/spec.md#requirement-focused-observation-without-per-client-polling)
and [bounded Desk observation](../openspec/specs/world-surfaces/desk-attention/spec.md#requirement-bounded-desk-observation).

## Process and request path

The [static verb registry](../server/src/verbs/registry.ts) owns browser RPC,
agent CLI and browser forge-action admission. [Actor policies and staged evidence](world-verbs.md)
map the declarations, preserved flags, owner validation and P4 compatibility tests.


```text
server/src/index.ts
  -> service, harness, or Herdr CLI command (when requested)
  -> server configuration and the data folder's paths
  -> createWorldService(deps): instance lock, signing secret, storage
      -> Bun HTTP/WebSocket listener
          -> origin and authentication admission
          -> bridge-global RPC/HTTP or qualified connection route
          -> one ConnectionRuntime -> Herdr control/render sockets

web/src/main.tsx -> WorldFoundationApp -> mounted Spaces App
                          |                 -> focused connection store
                          -> aggregate runtime store -> WorldObject -> visual views
```

The [service entry](../server/src/index.ts) dispatches service and harness commands,
loads the configuration and resolves the data folder's paths once. It owns the
process: the logger level, the CPU profile, signals and exit. The
[composition root](../server/src/service/world-service.ts), `createWorldService(deps)`,
builds the service from explicit dependencies: configuration, data paths, a clock,
a scheduler, storage and adapters (Herdr only). It composes authentication, profile
management, Web Push, optional cost metrics, World snapshots and per-connection
runtimes. `start()` binds the listener, then starts connections and Ranger. `stop()`
admits nothing new (requests get 503 while the port stays bound), stops Ranger and
the connections (failing Herdr calls still waiting), waits for in-flight requests,
closes storage, releases the folder and closes the listener last. Once storage
closes, every store refuses writes and unopened lazy families stay closed, so a
request that outlived the drain cannot rename or write a file in a folder the
service no longer owns. SQLite reads use the committed cache and cannot reopen
the database, import JSON or run migrations after close. The entry keeps
the listener until the process exits, because launchd's restart waits for the
port to free before it starts the next process. The service never resolves a data
path from the environment or the home folder, so tests run several services in one
process. The
[browser entry](../web/src/main.tsx) initializes preferences and mounts the World
shell; [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) keeps the
[Spaces application](../web/src/App.tsx) mounted while Town, Board or Desk is
visible. Build and development commands are in the [root](../package.json),
[server](../server/package.json) and [web](../web/package.json) manifests.

World's shell coordination is downstream-owned: [WorldControlPlane](../web/src/world/WorldControlPlane.tsx)
presents views and Inspectors; [observation](../web/src/world/useWorldObservation.ts),
[Inspector intent](../web/src/world/useWorldInspectorController.ts),
[window coordination](../web/src/world/useWorldInspectorWindows.ts),
[creation completion](../web/src/world/useWorldCreatedTerminal.ts) and
[visual Actions](../web/src/world/useWorldVisualActions.tsx) own separate behaviors.
They share existing connection/session admission and store interfaces.
[Town's renderer](../web/src/world/town/townRenderer.ts) owns Town's drawing
lifetime; Board draws DOM cards from [BoardView](../web/src/world/BoardView.tsx). The [component routes](../web/src/world/README.md#shell-and-source-ownership)
identify each owner and its regression evidence. Shared styles load through the
ordered [World style manifest](../web/src/world/world.css).

Browser RPC admission and routing live in [rpc-dispatch](../server/src/service/rpc-dispatch.ts),
and the [listener](../server/src/service/listener.ts) owns HTTP routes and the browser
socket. After those
checks, [namespace handlers](../server/src/rpc/) handle bridge, connection profile,
World, launcher, Board/Town, agent, file and Git/worktree methods. They receive the
captured request and service dependencies through [context.ts](../server/src/rpc/context.ts);
no handler imports service startup at runtime. The dispatcher retains Windows guards,
workspace/tab creation pre-steps, terminal/settings forwarding and Herdr pass-through.
`rpc/world.ts` reuses the CLI service for asks; `rpc/agent.ts` reuses the conversation
dispatcher. PR actions retain their existing Sources HTTP path. Add RPC branches to
the owning namespace and keep admission, lifetime and response publication in the
dispatcher. Existing [routing tests](../server/src/connections/protocol.test.ts) and
[session-link tests](../server/src/connections/session-link-routing.test.ts) cover
captured connection identity and stale-generation rejection.

## Service ownership

World-owned asks, results and attention use the asynchronous
[SQLite ledger family](../server/src/storage/world-storage.ts). Its sole
[worker](../server/src/storage/world-worker.ts) owns database access and grouped
FULL commits; [the dispatcher](../server/src/world/attention-dispatch.ts) records
dispatch before external effects. The [recovery contract](../verification/contracts/world-storage.md)
maps finite crash schedules, compiled acceptance, import, replay retention and
the effect-specific uncertainty rules. Configuration and secrets stay files;
see [location and backups](DEPLOYMENT.md#durable-questions-results-and-backups).

[Answer delivery without `--wait`](ask-answer-delivery.md) is a planned second
slice. It specifies the original-session binding, Chat send-path reuse, verified
asker acknowledgement, explicit uncertainty and user recovery. Its acceptance
cases are planned work, not evidence of shipped automatic pane delivery.

| Area | Owner and responsibility | Focused evidence |
| --- | --- | --- |
| Service composition | [world-service](../server/src/service/world-service.ts) builds one service and owns its start, stop and drain; [ports](../server/src/service/ports.ts) define the clock, scheduler and adapter ports; [storage](../server/src/service/storage.ts) is the port for World-owned stores, with today's JSON files behind it; [instance-lock](../server/src/config/instance-lock.ts) gives each live service its own folder. | [Service tests](../server/src/service/world-service.test.ts), [lock tests](../server/src/config/instance-lock.test.ts) |
| Configuration and private state | [server-config](../server/src/config/server-config.ts) parses listener, sockets, TLS and auth options; [data-paths](../server/src/config/data-paths.ts) resolves the data folder's paths once and owns private-file publication; [gui-settings](../server/src/config/gui-settings.ts) stores each service's settings. | [Config tests](../server/src/config/server-config.test.ts), [data-path tests](../server/src/config/data-paths.test.ts), [settings tests](../server/src/config/gui-settings.test.ts) |
| Terminal profile settings | [Profile service wiring](../server/src/agent/profile-service.ts) owns publication and builds the reconciler from the service's own profile store and clock; [terminal settings](../server/src/agent/terminal-settings.ts) reconciles shared Herdr tokens, imports legacy assignments once and resolves Town master claims; [token helpers](../server/src/agent/terminal-tokens.ts) enforce the current terminal/lease and preserve settings through moves. Profiles and chimes remain per World. [Snapshot observation admission](../server/src/world/snapshot-observers.ts) supplies complete raw pane lists after clean current reads. | [Settings/convergence](../server/src/agent/terminal-settings.test.ts), [token validation/moves](../server/src/agent/terminal-tokens.test.ts), [disposable Herdr](../server/src/agent/terminal-settings.live.test.ts) |
| Saved connections | [profiles](../server/src/connections/profiles.ts) validates and persists local/SSH profiles; [profile-service](../server/src/connections/profile-service.ts) applies startup overrides, profile operations and retry policy. | [Profile tests](../server/src/connections/profiles.test.ts), [service tests](../server/src/connections/profile-service.test.ts) |
| Runtime lifetime | [manager](../server/src/connections/manager.ts) owns independent runtime generations and ready leases; [runtime](../server/src/connections/runtime.ts) composes one Herdr control client, terminal bridge, file/session handlers, subscriptions and caches per connection. | [Manager tests](../server/src/connections/manager.test.ts), [runtime tests](../server/src/connections/runtime.test.ts), [shutdown tests](../server/src/connections/shutdown.test.ts) |
| SSH transport | [ssh-profile-runtime](../server/src/connections/ssh-profile-runtime.ts), [ssh-tunnel](../server/src/bridge/ssh-tunnel.ts) and [ssh-command](../server/src/bridge/ssh-command.ts) validate one OpenSSH destination and supervise its socket forwarding. | [SSH runtime tests](../server/src/connections/ssh-profile-runtime.test.ts), [tunnel tests](../server/src/bridge/ssh-tunnel.test.ts) |
| RPC and HTTP routing | [protocol](../server/src/connections/protocol.ts), [rpc-routing](../server/src/connections/rpc-routing.ts) and [http-routing](../server/src/connections/http-routing.ts) distinguish bridge-global work from downstream work. Explicit connection IDs are validated; generation is compared when supplied. Legacy RPC without an ID and legacy HTTP paths may use the process default. New browser operations must send both fields. | [Protocol tests](../server/src/connections/protocol.test.ts), [HTTP routing tests](../server/src/connections/http-routing.test.ts) |
| Browser access and static assets | [browser-admission](../server/src/http/browser-admission.ts) checks Origin/Host; [auth](../server/src/http/auth.ts) owns login sessions; [static-files](../server/src/http/static-files.ts) serves the built app and SPA entry. | [Admission tests](../server/src/http/browser-admission.test.ts), [auth tests](../server/src/http/auth.test.ts), [static tests](../server/src/http/static-files.test.ts) |
| Herdr wire protocols | [herdr-client](../server/src/bridge/herdr-client.ts) uses the control socket; [thin-client](../server/src/bridge/thin-client.ts), [endpoint-client](../server/src/bridge/endpoint-client.ts), [protocol-compat](../server/src/bridge/protocol-compat.ts) and [terminal-bridge](../server/src/bridge/terminal-bridge.ts) negotiate and relay render/input traffic. | [Control tests](../server/src/bridge/herdr-client.test.ts), [endpoint tests](../server/src/bridge/endpoint-client.test.ts), [terminal tests](../server/src/bridge/terminal-bridge.test.ts) |
| World observation | [snapshot](../server/src/world/snapshot.ts) bounds aggregate read-only topology; [watchlist](../server/src/world/watchlist.ts) holds qualified pane watches in service memory; [observability](../server/src/world/observability.ts) queries the optional metrics provider. | [Snapshot tests](../server/src/world/snapshot.test.ts), [watchlist tests](../server/src/world/watchlist.test.ts), [metrics tests](../server/src/world/observability.test.ts) |
| Files and repositories | [files](../server/src/workspace/files.ts) dispatches checkout-scoped and explicit filesystem browsing; [file-paths](../server/src/workspace/file-paths.ts), [local-files](../server/src/workspace/local-files.ts) and [remote-files](../server/src/workspace/remote-files.ts) enforce path and host boundaries. [git-diff](../server/src/workspace/git-diff.ts), [git-actions](../server/src/workspace/git-actions.ts) and [auto-sync](../server/src/workspace/auto-sync.ts) own repository operations. | [File tests](../server/src/workspace/files.test.ts), [remote-file tests](../server/src/workspace/remote-files.test.ts), [Git tests](../server/src/workspace/git-actions.test.ts) |
| Worktree lifecycle | [create](../server/src/worktree/create.ts), [remove](../server/src/worktree/remove.ts), [parents](../server/src/worktree/parents.ts) and [hooks](../server/src/worktree/worktree-hooks.ts) coordinate checkout changes and trusted hooks. | [Create tests](../server/src/worktree/create.test.ts), [remove tests](../server/src/worktree/remove.test.ts), [hook tests](../server/src/worktree/worktree-hooks.test.ts) |
| Agent sessions | [agent-sessions](../server/src/agent/agent-sessions.ts) resolves and projects history; [session-file-access](../server/src/agent/session-file-access.ts) reads local or remote session files; [checkout-context](../server/src/agent/checkout-context.ts) reads session-bound checkout reports. | [Session tests](../server/src/agent/agent-sessions.test.ts), [file-access tests](../server/src/agent/session-file-access.test.ts), [checkout tests](../server/src/agent/checkout-context.test.ts), [history contract](HISTORY.md) |
| Ranger workspace assistant | [Contract](../openspec/specs/workspace-assistant/spec.md), [service](../server/src/assistant/service.ts), [captured context](../server/src/assistant/context.ts), [browser client](../web/src/assistant.ts) | [Context tests](../server/src/assistant/context.test.ts), [service tests](../server/src/assistant/service.test.ts), [recovery tests](../server/src/assistant-recovery.integration.test.ts), [setup](DEPLOYMENT.md#ranger-workspace-assistant) |
| Notifications | [herdr-notification-listener](../server/src/notifications/herdr-notification-listener.ts) and [task-events](../server/src/notifications/task-events.ts) derive runtime task events; [web-push](../server/src/notifications/web-push.ts) manages enrolled browsers and session-bound delivery. | [Notification tests](../server/src/notifications/herdr-notification-listener.test.ts), [push tests](../server/src/notifications/web-push.test.ts) |
| Herdr setup and update | [Herdr CLI](../server/src/herdr/cli.ts), [bootstrap](../server/src/herdr/bootstrap.ts), [setup HTTP](../server/src/http/herdr-setup.ts) and [update HTTP](../server/src/http/update.ts) own installation and update operations. | [CLI tests](../server/src/herdr/cli.test.ts), [setup tests](../server/src/http/herdr-setup.test.ts), [update tests](../server/src/http/update.test.ts) |

The [shared preview classifier](../shared/filePreview.ts) is imported by both
packages. Keep host file access in the service, including previews and uploads.
The browser never talks directly to Herdr sockets or a remote World bridge.

## Browser ownership

| Area | Owner and responsibility | Focused evidence |
| --- | --- | --- |
| Transport and focused runtime | [api](../web/src/api.ts) owns the one World WebSocket and qualified connection clients; [store](../web/src/store.ts) retains independently addressable connection sessions and captured operational contexts with their own topology and control state; [useConnectionClient](../web/src/useConnectionClient.ts) captures a component's connection lease. | [API tests](../web/src/api.test.ts), [store tests](../web/src/store.test.ts), [lease tests](../web/src/useConnectionClient.test.ts) |
| Aggregate model and views | [runtimeStore](../web/src/world/runtimeStore.ts) admits bounded all-host snapshots; [worldObject](../web/src/world/worldObject.ts) builds qualified nodes; [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) applies the persisted Hosts filter to the aggregate for Town, Board and Desk. Context-bound selectors and commands in the existing store admit independent connections; the filter never supplies mutation authority. | [Runtime tests](../web/src/world/runtimeStore.test.ts), [model tests](../web/src/world/worldObject.test.ts), [shell tests](../web/src/world/WorldFoundationApp.test.ts) |
| Terminal UI | [TerminalView](../web/src/components/TerminalView.tsx), [terminalConnection](../web/src/terminalConnection.ts), [terminalEndpointPresentation](../web/src/terminalEndpointPresentation.ts) and [TabTerminalPaneLayout](../web/src/TabTerminalPaneLayout.tsx) handle attachment, frames, input and split-pane presentation. | [Presentation tests](../web/src/terminalEndpointPresentation.test.ts), [layout tests](../web/src/visibleTabLayout.test.ts), [browser terminal suite](../package.json) |
| Workspace and Inspector resources | [workspaceResource](../web/src/workspaceResource.ts) scopes Inspector context; [fileExplorerResources](../web/src/components/fileExplorerResources.ts) and [DiffViewerPanel](../web/src/components/DiffViewerPanel.tsx) own file/diff caches and UI. | [Resource tests](../web/src/workspaceResource.test.ts), [Explorer tests](../web/src/components/FileExplorerDialog.test.ts), [diff tests](../web/src/components/DiffViewerPanel.test.ts) |
| Browser-local behavior | [browserNavigation](../web/src/browserNavigation.ts) projects local tab/pane choices; [browserStorage](../web/src/browserStorage.ts) namespaces World preferences; [layoutPreferences](../web/src/layoutPreferences.ts), [shortcutPreferences](../web/src/shortcutPreferences.ts) and [appearance](../web/src/appearance.ts) validate preferences. | [Navigation tests](../web/src/browserNavigation.test.ts), [storage tests](../web/src/browserStorage.test.ts), [preference tests](../web/src/workspacePreferences.test.ts) |
| Alerts and background delivery | [taskNotifications](../web/src/taskNotifications.ts), [taskPush](../web/src/taskPush.ts) and the [service worker](../web/public/task-notifications-sw.js) render local or pushed task notices and route qualified targets back to the app. | [Task tests](../web/src/taskNotifications.test.ts), [push browser tests](../web/src/taskPush.browser.tsx) |
| Visual presentations | [TownView](../web/src/world/TownView.tsx) with [TownCanvas](../web/src/world/town/TownCanvas.tsx), [BoardView](../web/src/world/BoardView.tsx) with its [model](../web/src/world/board/boardModel.ts), [DeskView](../web/src/world/DeskView.tsx) and [world.css](../web/src/world/world.css) own view-specific presentation. Use the [component routes](../web/src/world/README.md) to pick the owner for a concrete task. | [Town tests](../web/src/world/town/TownCanvas.test.ts), [Board tests](../web/src/world/BoardView.test.ts), [Desk tests](../web/src/world/DeskView.test.ts) |

A transient browser transport outage retires clients and pending operations,
while retaining exact-owner Inspector membership, renderer buffers and validated
split geometry. The [resource presentation client](../web/src/resourcePresentationClient.ts)
keeps cache identity as data while Files/Changes/Commits wait for current
worktree admission; it never substitutes the retained target into RPC or HTTP
operations. Message drafts use the admitted runtime generation, and incomplete
catalogues cannot prune another Inspector's memory scope.
A fresh catalogue may retire a removed owner or replaced runtime;
resource absence needs a newly completed qualified focused list. The
[terminal renderer](../web/src/terminalRenderer.ts) owns xterm and endpoint
presentation independently of client-bound subscriptions, input handlers, resize
synchronization and attach attempts. Rebinding captures each new client; late
callbacks cannot use a newer client's authority. Bounded no-frame retries end in
local recovery controls and never navigate automatically. This preserves the
Q06/Q07/Q08 authority contracts; browser regressions cover renderer identity and
event timing beyond the maintained ownership models. This memory retention does
not restore a page discarded by the browser or OS.

`web/src/components/` contains reusable and feature-specific dialogs, menus and
panes. `web/src/world/` contains the World shell and visual projections. Root
`web/src/` modules hold the transport, focused state, terminal helpers and
preferences; [styles](../web/src/styles/) hold shared design tokens and base
styles. Follow imports from the owning row before editing a similarly named
component.

The service's [focused acquisition owner](../server/src/world/focused-acquisition.ts)
counts socket interest by connection and runtime generation and uses the injected
scheduler for one observer per held runtime. The
[shared list reader](../server/src/world/focused-lists.ts) keeps browser replies
and observer enrichment identical; the dispatcher records only delivered, marked
focused replies. [Direct tests](../server/src/service/focused-acquisition.test.ts)
exercise two sockets through that dispatcher, including unmarked callers and
failed sends. [Registry tests](../server/src/world/focused-acquisition.test.ts)
cover bounded interest traces and in-flight retirement. The service advertises
`world_shared_acquisition`; only older services retain the focused browser timer.
The [activity cache](../server/src/world/agent-activity-cache.ts) shares bounded
session-file readings without caching live agent status. Its publication and
release paths use the same interest and lease fences. The browser's
[recency merge](../web/src/agentRecency.ts) runs after layout acquisition, retaining
any newer [activity push](../web/src/store/controls.ts) in its qualified
connection partition. [Shared activity identities](../shared/agentActivity.ts)
keep sessions from lending timestamps to replacements. Read-only maxima are keyed
by complete identity outside runtime admission state, and survive a World restart
that resets the service generation counter. The
[focused interest controller](../web/src/store/focusedInterest.ts) declares the
visible active host and independently held Inspector owners, releases them on
hide and retries failed declarations without a standing successful timer. The
[Inspector hook](../web/src/world/useFocusedInspectorInterest.ts) holds each
window through the store, so filter/focus changes cannot retarget it. New holds
and return-to-page refresh every eligible owner. The
[catalogue coordinator](../web/src/store/catalogue.ts) coalesces notices into one
fetch and one successor, with failure-only retries including bootstrap. Failed
held re-lists use the same visibility/owner fences. The current hello gates
declarations, notices and activity controls. The
[restart regressions](../web/src/store/recencyReconnect.test.ts),
[capability regressions](../web/src/store/recencyCapability.test.ts) and original
[recency/hide T2 cases](../web/src/store/pollReplacement.test.ts) cover those paths.
The [cache/observer consumer](../server/src/service/agent-activity.test.ts) and
[real Bridge/store race tests](../web/src/store/agentActivity.test.ts) cover those
boundaries.

The [composed acquisition case](../server/src/service/shared-acquisition.test.ts)
connects the real service to a real Bridge/store in a Worker plus a second native
socket on two synthetic hosts. Its independent manual clocks and completion
signals verify shared reads, notices and the focused parity outputs through the
actual listener and composition root, including pending generation replacement.
[Current runtime requirements](../openspec/specs/runtime-federation/spec.md)
and [Desk requirements](../openspec/specs/world-surfaces/desk-attention/spec.md#requirement-bounded-desk-observation)
contain the delivered acquisition contract.

The [Desk watch owner](../server/src/world/desk-watches.ts) shares screen and
receipt reads across socket declarations using the same injected scheduler.
Its [queues](../server/src/world/desk-read-queues.ts) retain one active read per
host and kind until settlement, and its
[native reader](../server/src/world/desk-watch-read.ts) validates session identity
on both sides of a read. Per-holder receipt triggers are captured at read start;
late holders receive actual results with null triggers, followed by one successor.
The [browser declaration controller](../web/src/world/deskWatchClient.ts) unions
Desk hooks, releases on hide/close and fences current owners. The
[hook adapter](../web/src/world/useDeskWatch.ts) enables it only for the shared
capability. Without it, existing Desk polling continues. See [Desk evidence](../verification/contracts/shared-acquisition.md#desk-checkpoint)
for the finite traces, two-browser consumers and real browser fallback checks.

The [focused store](../web/src/store.ts) retains the shared mutable connection
state and public command object. Its [types](../web/src/store/types.ts),
[session transitions](../web/src/store/sessions.ts),
[refresh scheduling](../web/src/store/refresh.ts),
[notifications](../web/src/store/notifications.ts),
[update checks and legacy polling](../web/src/store/updates.ts),
[creation](../web/src/store/creation.ts),
[qualified commands](../web/src/store/operations.ts),
[React bindings](../web/src/store/react.ts) and
[worktree notices](../web/src/store/worktree.ts) live in focused modules.
Consumers continue to import from `web/src/store.ts`. Internal slices read
that module's live bindings only when their functions run; module initialization
must not read or call back into the mutable store.

When focused topology and a pane layout disagree, refresh drops that layout and
retries through the existing 80 ms per-connection, per-generation debounce. Repeated
stale replies therefore yield to browser work while retaining the selected pane.
Explicit refresh requests still run promptly, and a deferred retry keeps its
captured host and runtime lease across focus changes; retirement cancels its work.
The [refresh regression](../web/src/store/refresh.test.ts) covers these boundaries.

## Follow a request across the boundary

1. **Capture an owner.** The [connection selector](../web/src/components/ConnectionSwitcher.tsx)
   manages profile lifecycle separately from Hosts visibility. A workspace or
   Inspector captures its owner in the [store](../web/src/store.ts). [api](../web/src/api.ts)
   creates a client bound to that connection, runtime generation and transport epoch. The service
   resolves it through [RPC routing](../server/src/connections/rpc-routing.ts)
   and [manager](../server/src/connections/manager.ts). A replaced runtime cannot
   publish its old result. [Runtime federation](../openspec/specs/runtime-federation/spec.md)
   defines the admission rule.
2. **Observe World.** The browser [runtime store](../web/src/world/runtimeStore.ts)
   calls bridge-global `world.snapshot`. The [snapshot service](../server/src/world/snapshot.ts)
   reads each managed runtime with bounded concurrency and a deadline. The
   [WorldObject](../web/src/world/worldObject.ts) preserves every qualified host;
   [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) gives visual
   views the same filtered aggregate, with shared fair space admission and paged
   full-observation search. Observation is read-only and stale hosts cannot
   authorize actions.
3. **Open a terminal or resource.** A visual target or Spaces pane resolves an
   exact connection, generation and native ID through [visual actions](../web/src/world/visualRouteActions.ts)
   or the [focused store](../web/src/store.ts). The [terminal bridge](../server/src/bridge/terminal-bridge.ts)
   or [file handlers](../server/src/workspace/files.ts) run inside that runtime.
   HTTP resources use [qualified paths](../server/src/connections/http-routing.ts).
   See [workspace resource ownership](ARCHITECTURE.md#workspace-resource-ownership).
4. **Deliver a task notice.** A runtime [notification listener](../server/src/notifications/herdr-notification-listener.ts)
   produces a qualified event; [Web Push](../server/src/notifications/web-push.ts)
   may deliver it to an enrolled browser. [taskPush](../web/src/taskPush.ts)
   handles browser enrollment, while [taskNotifications](../web/src/taskNotifications.ts)
   handles presentation. Check session binding and runtime generation before
   changing this flow.

## State and distribution boundaries

Service configuration belongs to the World process. [data-paths](../server/src/config/data-paths.ts)
defines its product directory; [profiles](../server/src/connections/profiles.ts)
persists the connection catalogue, [gui-settings](../server/src/config/gui-settings.ts)
persists service settings, and [web-push](../server/src/notifications/web-push.ts)
persists enrolled devices. Browser preferences live behind the
[World storage namespace](../web/src/browserStorage.ts). Resource caches are
qualified by connection and checkout in [workspaceResource](../web/src/workspaceResource.ts)
and feature resource modules. See [architecture](ARCHITECTURE.md#connection-isolation)
for lease and cache retirement rules.

[Vite](../web/vite.config.ts) builds the frontend; [server compile scripts](../server/package.json)
embed those assets in a Bun executable. [Package tooling](../scripts/package-release.sh),
[npm staging](../scripts/stage-npm-release.ts),
[Homebrew Formula generation](../scripts/generate-homebrew-formula.ts),
[installer](../scripts/install-herdr-world.sh), [plugin tooling](../scripts/world-plugin.ts)
and [release preparation](../scripts/prepare-release.ts) form the distribution
path. [Packaging](packaging.md), [release](release.md) and [UPSTREAM](../UPSTREAM.md)
own exact artifacts, versions and source lineage. [CI](../.github/workflows/ci.yml)
runs the selected lanes described in [contributor validation](../CONTRIBUTING.md#validation). Generated assets and binaries stay out of
Git.

The [site builder](../scripts/build-pages.ts) publishes the landing page and
[tutorial](TUTORIAL.md); [dependency notices](../scripts/dependency-notices.ts)
derive the tracked legal inventory from the resolved dependency graph. The
[worktree helper](../scripts/agent/worktree.mjs) creates isolated agent branches,
and [candidate-delivery](../.agents/skills/candidate-delivery/SKILL.md) owns the delivery loop. Use
the [site workflow](../.github/workflows/pages.yml), [release workflows](../.github/workflows/)
and their [script tests](../scripts/) when changing those paths.

When behavior changes, update the affected [current OpenSpec contract](../openspec/specs/),
this guide or the [knowledge map](knowledge-map.md) only where its ownership or
navigation changed. Use the OpenSpec change lifecycle for a new product decision;
ordinary source repairs and documentation updates can amend current knowledge in
the same PR. Keep historical specs as rationale.

## Browser startup and test isolation

React version evidence and the development diagnostic patch are maintained in
[React 19 migration](react-19.md), with deterministic coverage in
[the installed-renderer regression](../web/src/testing/reactPerformanceTracks.test.ts).
Notification wiring is described in the [World startup guide](../web/src/world/README.md#application-startup-and-owner-questions).

Test isolation and tool portability are maintained in the
[test runner](../scripts/run-tests.ts), [startup environment](../scripts/test-isolation.ts),
[process preload](../scripts/test-process-preload.ts), [tripwire](../scripts/test-tripwire.ts)
and [portability lint](../scripts/test-portability.ts). See the
[subprocess, aliased scratch-root, live shell and browser-diagnostics controls](../scripts/test-isolation.test.ts),
[resource-gate live startup](../scripts/verification-resources.test.ts),
[coreutils regressions](../scripts/test-portability.test.ts),
[contributor guide](../CONTRIBUTING.md#validation) and
[development guide](development.md) for isolation, fakes and explicit live opt-out.


## Additional source routes

History terminal input and mobile shell launching are mapped in the
[foundation guide](foundation-guide.md) and [History guide](HISTORY.md#history-terminal-input).
Start with [HistoryTerminalComposer](../web/src/components/HistoryTerminalComposer.tsx),
[AgentLauncher](../web/src/components/AgentLauncher.tsx) and their Q09 consumers in
[the coverage inventory](../verification/coverage/).

Desktop shortcut discovery lives in [the read-only cheat sheet](../web/src/components/ShortcutCheatSheet.tsx)
and [its preset-derived rows and filtering](../web/src/shortcutCheatSheet.ts), with
[preset/filter regressions](../web/src/shortcutCheatSheet.test.ts). Workspace and
worktree naming uses [the lazy generator](../web/src/luckyName.ts) and
[the suggestion lifecycle hook](../web/src/components/useSuggestedName.ts);
[dialog regressions](../web/src/components/ModalDialogs.test.ts) cover late suggestions.

## Mobile resume design and evidence

The [diagnosis](mobile-resume-diagnosis.md) and [L1/L2/L3 proposal](mobile-resume-proposal.md)
record the transport teardown analysis and scope. Current L1 ownership lives in
[the frontend guide](foundation-guide.md#browser-ownership),
[terminal renderer](../web/src/terminalRenderer.ts) and
[resource presentation cache identity](../web/src/resourcePresentationClient.ts).
The [Inspector status row](../web/src/components/WorkspaceInspectorStatus.tsx)
keeps stale notices clear of the retained Message editor.
The [real resource-child regression](../web/src/world/WorldInspectorResourceResume.test.ts)
covers disconnect, delayed worktree readmission and replacement; a
[stale-worktree Chat regression](../web/src/world/WorldInspectorChatWorktree.test.ts)
checks that a worktree being re-read holds only Files, Changes and Commits,
never Chat ([`?worktreeChanged` preview switch](../web/src/agentWorktreeTrial.ts));
the
[World browser regression](../web/src/world/WorldTerminalHandoff.test.ts) covers
window, renderer and Message-draft retention. See the
[visual gallery](reviews/mobile-resume.md) for synthetic viewport evidence.

## CI and release validation

For on-demand performance evidence, use the [synthetic scale harness](scale-harness.md)
and [`scripts/scale/run.ts`](../scripts/scale/run.ts). It measures existing service
and production view behavior under the shared heavy queue; it defines no CI
wall-clock gate. Raw, bounded and rendered counts have separate evidence boundaries.

The advisory [Town golden-image report](SCREENSHOTS.md#town-golden-image-report)
uses the [capture harness](../scripts/town-golden.ts), its
[synthetic production Town fixture](../web/src/world/testing/town-golden/TownGolden.browser.tsx),
[exact comparator and workflow tests](../scripts/town-golden.test.ts), and the
[report-only workflow](../.github/workflows/town-golden.yml).
The [production visual negative control](../scripts/town-golden-negative-control.ts)
and [hosted acceptance procedure](SCREENSHOTS.md#hosted-stability-and-production-visual-negative-control)
exercise the capture/failure/restoration path in the opt-in stability job.
See [initial stability evidence](reviews/town-golden.md) for the reference's bounds.

The website's Town, Board and sharing images come from the
[site capture](../scripts/site-screenshots.ts) of the production Town and Board
with a [synthetic site scene](../web/src/world/testing/site-shots/scene.ts)
([scene tests](../web/src/world/testing/site-shots/scene.test.ts)); see
[the release set](SCREENSHOTS.md#capture-the-shared-release-set).

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

The [file size ratchet](../scripts/file-size-ratchet.ts) with its
[exceptions](../scripts/file-size-exceptions.json) and the
[move-only check](../scripts/move-check.ts) keep big files from regrowing and
splits honest; see their [ratchet](../scripts/file-size-ratchet.test.ts) and
[move](../scripts/move-check.test.ts) tests.

[Development verification](development.md#verification) describes local and CI
runner settings. [CI](../.github/workflows/ci.yml) runs on pull requests and on
every push to main; [Main gate](../.github/workflows/main-gate.yml) turns a red
main run into one `main-red` issue and a prepared revert PR through
[its script](../scripts/main-gate.ts) and [regressions](../scripts/main-gate.test.ts).
[Web asset headroom](../.github/workflows/web-asset-headroom.yml) judges each
PR's asset delta against current main through [its script](../scripts/web-asset-headroom.ts)
and [regressions](../scripts/web-asset-headroom.test.ts).
CI and [Release](../.github/workflows/release.yml) call the same
[World browser workflow](../.github/workflows/world-browser.yml).
[Prepare Release](../.github/workflows/prepare-release.yml) validates generated
files in its own checkout. Start with [CI workflow tests](../scripts/ci-workflow.test.ts)
and [release validation tests](../scripts/release-validation.test.ts) when changing
concurrency, shard coverage or publication dependencies. Release and labeled PR
previews share [package verification](../scripts/verify-release-package.sh) and its
[executable header check](../scripts/check-binary-format.ts).
For first-case browser timeouts, use the opt-in lifecycle comparison described in
[development verification](development.md#verification), the
[diagnostic adapter](../scripts/browser-diagnostics.ts) and its
[regression tests](../scripts/browser-diagnostics.test.ts). Keep baseline and
candidate evidence together before diagnosing a runner or fixture defect.
World harnesses separate bounded Chrome startup from fixture execution using
[the browser deadline helper](../web/src/browserChrome.ts) and its
[regression tests](../web/src/browserChrome.test.ts). The fixture clock starts at
the main HTML request, before loading assets or initializing the application;
responsiveness and operation limits remain unchanged. On CI the test runner
first pays a fresh runner's one-time Chrome launch cost (font cache, cold disk)
through [the Chrome warm-up](../scripts/chrome-warmup.ts) and its
[regression tests](../scripts/chrome-warmup.test.ts), so no test's startup
budget absorbs it.

## RPC paths

`web/src/api.ts` owns one WebSocket to the World service. Bridge-global methods such as
`connections.*` and `world.snapshot` carry no connection identity. New downstream
browser methods carry an immutable `connection_id` and runtime
`connection_generation`; routing and lease revalidation live in
`server/src/connections/` and `server/src/service/rpc-dispatch.ts`. The retained compatibility
route accepts an omitted connection ID by selecting the process default, and
compares generation only when supplied. Legacy HTTP paths have the same default
route; do not use either omission for new browser work.

Runtime operation ownership and the remaining TUI-only callback areas are mapped
in [Runtime adapters](world-adapters.md#typed-runtime-operations). The typed
ports live in `server/src/adapters/runtime-ports.ts`; their TUI translation is in
`server/src/adapters/herdr-runtime.ts`.

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
through the public `web/src/store.ts` entry, with
[qualified commands](../web/src/store/operations.ts),
[session transitions](../web/src/store/sessions.ts) and
[React bindings](../web/src/store/react.ts) in its internal slices.
Every host list and choice (Hosts menu, its filter, New room's destination)
reads [one catalogue of both runtimes](../web/src/worldHosts.ts).
The persisted `hostsFilter.ts` affects visibility only;
`spaceAdmission.ts` shares the navigator's capacity fairly and `WorldSearchResults.tsx`
pages full-observation matches beyond renderer bounds.

Local pre-push runs unqueued static checks and affected non-browser units through
[the lane runner](../scripts/check-delivery.ts); CI owns browser and behavioral
acceptance. [Command regressions](../scripts/gate-commands.test.ts) cover scope,
log reset, disk-guard removal and queue isolation; [queue tests](../scripts/check-lock.test.ts)
cover slot ownership and recovery.

CI selection distinguishes model-backed and model-free owners through
[coverage scope](../scripts/coverage-scope.ts) ([tests](../scripts/coverage-scope.test.ts)).
Metadata reuse requires [source and selection proof](../scripts/ci-validation-proof.ts)
([tests](../scripts/ci-validation-proof.test.ts)). [Measured assignment](../scripts/balance-shards.ts)
([tests](../scripts/balance-shards.test.ts)) partitions World suites and verification
models; [the CI guide](ci-pipelines.md#shared-suite-plan-and-sharding) describes
weights and full-main coverage. Town's 22 browser cases share [one harness](../web/src/world/testing/TownCanvas.ts)
and [one parameter inventory](../web/src/world/town/TownCanvas.cases.ts).

Process-fixture startup and lifetime guidance is in
[development verification](development.md#verification). The
[diagnostics core](../scripts/browser-diagnostics.ts) and
[plugin dispatcher](../server/src/config/plugin-command.ts) expose process seams;
[SSH fixture forwarding](../server/src/connections/testing/inProcessSsh.ts) runs in
the test process while preserving real child PIDs and Unix sockets. Consumer tests
remain beside their owners; launcher and hook tests retain real CLI boundaries.

Repository workflow lives in [AGENTS.md](../AGENTS.md) and
[agent development](agent-development.md). The optional visible-team recipe is
under [`.hwf/workflows/`](../.hwf/workflows/). Agent work is dispatched by the separate herdr-crew dispatcher; this repo only defines how code is built, tested and delivered. The
former usage, readiness-gate and crew-watcher tooling was retired on 2026-11-06;
[the usage guide](agent-usage-audit.md) is historical. The parked
[World primitives research](world-primitives-research.md) generalised the old crew process into
goals, workflows, loops, skills, personas, templates and policies attached at
each level of the world; it is research, not a contract.
The optional [Quint adoption spike](quint-adoption-spike.md) inventories formal
modeling candidates and records bounded model/replay experiments; it is not a CI gate.
The [Quint adoption proposal](../openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/proposal.md)
defines the planned policy, promotion criteria and staged repository-wide coverage.
The [maintained behavioral evidence](../verification/README.md) maps the coverage inventory
to current requirements, existing tests, accepted delivery and concrete model/consumer
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
with its [OOM-isolated supervisor](../scripts/verification-resource-supervisor.ts)
and [hard Linux envelope](../tools/quint/resources.json).

Evidence publication uses [the shared acceptance boundary](../scripts/verification-publication.ts).
[Canonical finalization regressions](../scripts/verification-parallel.test.ts)
verify late cancellation invalidates aggregates and retains diagnostics;
[checker regressions](../scripts/verification-checker.test.ts) cover owned teardown.
The [verification guide](../verification/README.md) describes the protected gate
and its acceptance record. Use the inventory in [`quint/models.ts`](../quint/models.ts)
for current model cases.

Quint adoption is accepted and merged in PR #188; [archived completion](../openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/tasks.md#accepted-completion-and-archival) records final reviews, source-bound CI and the no-op spec synchronization. Current evidence remains maintained under `verification/` and `quint/`.

Roamgate v0.8.6 comparisons use [branch selection](../server/src/workspace/diff-base.ts)
and [its repository-ref tests](../server/src/workspace/diff-base.test.ts), with
[qualified comparison caches](../web/src/components/DiffViewerPanel.test.ts).
[Tab-strip scrolling](../web/src/components/useTabStripScroll.ts) uses
[pure overflow geometry](../web/src/tabStripScroll.ts) and
[geometry regressions](../web/src/tabStripScroll.test.ts). Cross-tab pane dragging
lives in [PaneMoveMenu](../web/src/components/PaneMoveMenu.tsx), whose moves use
[qualified operational commands](../web/src/store.ts) and
[owner-retirement regressions](../web/src/store.test.ts). Mobile input remains in
each terminal; [the shared World app bar](../web/src/components/MobileControls.tsx)
continues to own Tabs and More.

Ranger busy-turn admission, held queue recovery and captured-generation tests live
in [the service](../server/src/assistant/service.ts) and
[its regressions](../server/src/assistant/service.test.ts).
[Queue controls](../web/src/components/AssistantQueue.tsx) and
[bounded Thinking display](../web/src/components/AssistantThinking.tsx) share the
[workspace-assistant contract](../openspec/specs/workspace-assistant/spec.md);
[the tutorial](TUTORIAL.md#ranger) describes their use.

Roamgate transport integration routes through the [service forwarding owner](../server/src/service/forward-service.ts),
[qualified forwarding RPC](../server/src/bridge/forward-rpc.ts),
[SSH command sessions](../server/src/bridge/ssh-sessions.ts),
[private master lifecycle](../server/src/bridge/ssh-master.ts),
[background RPC lanes](../web/src/rpcLanes.ts) and
[checkout status pushes](../web/src/gitStatusPush.ts).
Ownership consumers are [SSH routing](../server/src/bridge/ssh-owner.test.ts),
[forward generations](../server/src/bridge/forward-owner.test.ts),
[dispatch admission](../server/src/service/forward-dispatch.test.ts) and
[inactive-host status reconciliation](../web/src/store/gitStatusPush.test.ts).
The [integration test plan](reviews/roamgate-sync-test-plan.md) keeps whole-system
acceptance separate from the transport part's evidence.

Ranger engine dispatch lives in [ranger-driver](../server/src/assistant/ranger-driver.ts),
[Claude CLI](../server/src/assistant/claude-driver.ts) and its
[owned MCP listener](../server/src/assistant/claude-mcp.ts). Persisted state and task
validation are in [assistant-state](../server/src/assistant/assistant-state.ts) and
[task-validation](../server/src/assistant/task-validation.ts). The
[show adapter](../web/src/world/useAssistantShow.ts) uses shared Inspector admission,
with the Chrome consumer in [shared Inspector checks](../web/src/world/testing/sharedInspectorBrowser.tsx).
Claude transcript projection and common ATIF construction are in
[claude-trajectory](../server/src/agent/claude-trajectory.ts) and
[trajectory-common](../server/src/agent/trajectory-common.ts).

The SSH transport [runner ownership audit](reviews/roamgate-runner-audit.md) maps
required runtime process ports through file/Git/ignore, status, discovery and
forwarding helpers to the shared retirement control.
