# Foundation source guide

This guide maps the implemented service and browser foundation. Start with the
[knowledge map](knowledge-map.md) for a task-specific contract and test, then use
this guide when a change crosses modules. [Architecture](ARCHITECTURE.md) records
the detailed system boundaries; [deployment](DEPLOYMENT.md) records operator
configuration. The application source is [derived from Roamgate](../UPSTREAM.md),
with Herdr as an external runtime. Git history and `UPSTREAM.md` establish source
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

## Process and request path

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
closes, every store refuses writes, so a request that outlived the drain cannot
write a folder the service no longer owns. The entry keeps
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
and [Desk requirements](../openspec/specs/world-surfaces/spec.md#requirement-bounded-desk-observation)
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
repeats the root `bun run check` gate. Generated assets and binaries stay out of
Git.

The [site builder](../scripts/build-pages.ts) publishes the landing page and
[tutorial](TUTORIAL.md); [dependency notices](../scripts/dependency-notices.ts)
derive the tracked legal inventory from the resolved dependency graph. The
[worktree helper](../scripts/agent/worktree.mjs) creates isolated agent branches,
and [agent development](agent-development.md) documents the delivery loop. Use
the [site workflow](../.github/workflows/pages.yml), [release workflows](../.github/workflows/)
and their [script tests](../scripts/) when changing those paths.

When behavior changes, update the affected [current OpenSpec contract](../openspec/specs/),
this guide or the [knowledge map](knowledge-map.md) only where its ownership or
navigation changed. Use the OpenSpec change lifecycle for a new product decision;
ordinary source repairs and documentation updates can amend current knowledge in
the same PR. Keep historical specs as rationale.
