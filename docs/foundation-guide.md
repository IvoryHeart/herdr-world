# Foundation source guide

This guide maps the implemented service and browser foundation. Start with the
[knowledge map](knowledge-map.md) for a task-specific contract and test, then use
this guide when a change crosses modules. [Architecture](ARCHITECTURE.md) records
the detailed system boundaries; [deployment](DEPLOYMENT.md) records operator
configuration. The application source is [derived from Roamgate](../UPSTREAM.md),
with Herdr as an external runtime. Git history and `UPSTREAM.md` establish source
lineage; a file's directory alone does not identify its origin.

## Process and request path

```text
server/src/index.ts
  -> service, harness, or Herdr CLI command (when requested)
  -> server configuration and World-owned persistence
  -> Bun HTTP/WebSocket listener
      -> origin and authentication admission
      -> bridge-global RPC/HTTP or qualified connection route
      -> one ConnectionRuntime -> Herdr control/render sockets

web/src/main.tsx -> WorldFoundationApp -> mounted Spaces App
                          |                 -> focused connection store
                          -> aggregate runtime store -> WorldObject -> visual views
```

The [service entry](../server/src/index.ts) dispatches service and harness commands
before starting the listener. It composes authentication, profile management, Web
Push, optional Office metrics, World snapshots and per-connection runtimes. The
[browser entry](../web/src/main.tsx) initializes preferences and mounts the World
shell; [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) keeps the
[Spaces application](../web/src/App.tsx) mounted while Office, Tree or Graph is
visible. Build and development commands are in the [root](../package.json),
[server](../server/package.json) and [web](../web/package.json) manifests.

## Service ownership

| Area | Owner and responsibility | Focused evidence |
| --- | --- | --- |
| Configuration and private state | [server-config](../server/src/config/server-config.ts) parses listener, sockets, TLS and auth options; [data-paths](../server/src/config/data-paths.ts) owns World data paths and private-file publication; [gui-settings](../server/src/config/gui-settings.ts) stores service settings. | [Config tests](../server/src/config/server-config.test.ts), [data-path tests](../server/src/config/data-paths.test.ts), [settings tests](../server/src/config/gui-settings.test.ts) |
| Saved connections | [profiles](../server/src/connections/profiles.ts) validates and persists local/SSH profiles; [profile-service](../server/src/connections/profile-service.ts) applies startup overrides, profile operations and retry policy. | [Profile tests](../server/src/connections/profiles.test.ts), [service tests](../server/src/connections/profile-service.test.ts) |
| Runtime lifetime | [manager](../server/src/connections/manager.ts) owns independent runtime generations and ready leases; [runtime](../server/src/connections/runtime.ts) composes one Herdr control client, terminal bridge, file/session handlers, subscriptions and caches per connection. | [Manager tests](../server/src/connections/manager.test.ts), [runtime tests](../server/src/connections/runtime.test.ts), [shutdown tests](../server/src/connections/shutdown.test.ts) |
| SSH transport | [ssh-profile-runtime](../server/src/connections/ssh-profile-runtime.ts), [ssh-tunnel](../server/src/bridge/ssh-tunnel.ts) and [ssh-command](../server/src/bridge/ssh-command.ts) validate one OpenSSH destination and supervise its socket forwarding. | [SSH runtime tests](../server/src/connections/ssh-profile-runtime.test.ts), [tunnel tests](../server/src/bridge/ssh-tunnel.test.ts) |
| RPC and HTTP routing | [protocol](../server/src/connections/protocol.ts), [rpc-routing](../server/src/connections/rpc-routing.ts) and [http-routing](../server/src/connections/http-routing.ts) distinguish bridge-global work from downstream work and revalidate connection identity and generation. | [Protocol tests](../server/src/connections/protocol.test.ts), [HTTP routing tests](../server/src/connections/http-routing.test.ts) |
| Browser access and static assets | [browser-admission](../server/src/http/browser-admission.ts) checks Origin/Host; [auth](../server/src/http/auth.ts) owns login sessions; [static-files](../server/src/http/static-files.ts) serves the built app and SPA entry. | [Admission tests](../server/src/http/browser-admission.test.ts), [auth tests](../server/src/http/auth.test.ts), [static tests](../server/src/http/static-files.test.ts) |
| Herdr wire protocols | [herdr-client](../server/src/bridge/herdr-client.ts) uses the control socket; [thin-client](../server/src/bridge/thin-client.ts), [endpoint-client](../server/src/bridge/endpoint-client.ts), [protocol-compat](../server/src/bridge/protocol-compat.ts) and [terminal-bridge](../server/src/bridge/terminal-bridge.ts) negotiate and relay render/input traffic. | [Control tests](../server/src/bridge/herdr-client.test.ts), [endpoint tests](../server/src/bridge/endpoint-client.test.ts), [terminal tests](../server/src/bridge/terminal-bridge.test.ts) |
| World observation | [snapshot](../server/src/world/snapshot.ts) bounds aggregate read-only topology; [watchlist](../server/src/world/watchlist.ts) holds qualified pane watches in service memory; [observability](../server/src/world/observability.ts) queries the optional metrics provider. | [Snapshot tests](../server/src/world/snapshot.test.ts), [watchlist tests](../server/src/world/watchlist.test.ts), [metrics tests](../server/src/world/observability.test.ts) |
| Files and repositories | [files](../server/src/workspace/files.ts) dispatches checkout-scoped and explicit filesystem browsing; [file-paths](../server/src/workspace/file-paths.ts), [local-files](../server/src/workspace/local-files.ts) and [remote-files](../server/src/workspace/remote-files.ts) enforce path and host boundaries. [git-diff](../server/src/workspace/git-diff.ts), [git-actions](../server/src/workspace/git-actions.ts) and [auto-sync](../server/src/workspace/auto-sync.ts) own repository operations. | [File tests](../server/src/workspace/files.test.ts), [remote-file tests](../server/src/workspace/remote-files.test.ts), [Git tests](../server/src/workspace/git-actions.test.ts) |
| Worktree lifecycle | [create](../server/src/worktree/create.ts), [remove](../server/src/worktree/remove.ts), [parents](../server/src/worktree/parents.ts) and [hooks](../server/src/worktree/worktree-hooks.ts) coordinate checkout changes and trusted hooks. | [Create tests](../server/src/worktree/create.test.ts), [remove tests](../server/src/worktree/remove.test.ts), [hook tests](../server/src/worktree/worktree-hooks.test.ts) |
| Agent sessions | [agent-sessions](../server/src/agent/agent-sessions.ts) resolves and projects history; [session-file-access](../server/src/agent/session-file-access.ts) reads local or remote session files; [checkout-context](../server/src/agent/checkout-context.ts) reads session-bound checkout reports. | [Session tests](../server/src/agent/agent-sessions.test.ts), [file-access tests](../server/src/agent/session-file-access.test.ts), [checkout tests](../server/src/agent/checkout-context.test.ts), [history contract](HISTORY.md) |
| Notifications | [herdr-notification-listener](../server/src/notifications/herdr-notification-listener.ts) and [task-events](../server/src/notifications/task-events.ts) derive runtime task events; [web-push](../server/src/notifications/web-push.ts) manages enrolled browsers and session-bound delivery. | [Notification tests](../server/src/notifications/herdr-notification-listener.test.ts), [push tests](../server/src/notifications/web-push.test.ts) |
| Herdr setup and update | [Herdr CLI](../server/src/herdr/cli.ts), [bootstrap](../server/src/herdr/bootstrap.ts), [setup HTTP](../server/src/http/herdr-setup.ts) and [update HTTP](../server/src/http/update.ts) own installation and update operations. | [CLI tests](../server/src/herdr/cli.test.ts), [setup tests](../server/src/http/herdr-setup.test.ts), [update tests](../server/src/http/update.test.ts) |

The [shared preview classifier](../shared/filePreview.ts) is imported by both
packages. Keep host file access in the service, including previews and uploads.
The browser never talks directly to Herdr sockets or a remote World bridge.

## Browser ownership

| Area | Owner and responsibility | Focused evidence |
| --- | --- | --- |
| Transport and focused runtime | [api](../web/src/api.ts) owns the one World WebSocket and qualified connection clients; [store](../web/src/store.ts) retains the selected operational connection, its current topology and control state; [useConnectionClient](../web/src/useConnectionClient.ts) captures a component's connection lease. | [API tests](../web/src/api.test.ts), [store tests](../web/src/store.test.ts), [lease tests](../web/src/useConnectionClient.test.ts) |
| Aggregate model and views | [runtimeStore](../web/src/world/runtimeStore.ts) admits bounded all-host snapshots; [worldObject](../web/src/world/worldObject.ts) builds qualified nodes; [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) projects the selected host into Office, Tree and Graph. | [Runtime tests](../web/src/world/runtimeStore.test.ts), [model tests](../web/src/world/worldObject.test.ts), [shell tests](../web/src/world/WorldFoundationApp.test.ts) |
| Terminal UI | [TerminalView](../web/src/components/TerminalView.tsx), [terminalConnection](../web/src/terminalConnection.ts), [terminalEndpointPresentation](../web/src/terminalEndpointPresentation.ts) and [TabTerminalPaneLayout](../web/src/TabTerminalPaneLayout.tsx) handle attachment, frames, input and split-pane presentation. | [Presentation tests](../web/src/terminalEndpointPresentation.test.ts), [layout tests](../web/src/visibleTabLayout.test.ts), [browser terminal suite](../package.json) |
| Workspace and Inspector resources | [workspaceResource](../web/src/workspaceResource.ts) scopes Inspector context; [fileExplorerResources](../web/src/components/fileExplorerResources.ts) and [DiffViewerPanel](../web/src/components/DiffViewerPanel.tsx) own file/diff caches and UI. | [Resource tests](../web/src/workspaceResource.test.ts), [Explorer tests](../web/src/components/FileExplorerDialog.test.ts), [diff tests](../web/src/components/DiffViewerPanel.test.ts) |
| Browser-local behavior | [browserNavigation](../web/src/browserNavigation.ts) projects local tab/pane choices; [browserStorage](../web/src/browserStorage.ts) namespaces World preferences; [layoutPreferences](../web/src/layoutPreferences.ts), [shortcutPreferences](../web/src/shortcutPreferences.ts) and [appearance](../web/src/appearance.ts) validate preferences. | [Navigation tests](../web/src/browserNavigation.test.ts), [storage tests](../web/src/browserStorage.test.ts), [preference tests](../web/src/workspacePreferences.test.ts) |
| Alerts and background delivery | [taskNotifications](../web/src/taskNotifications.ts), [taskPush](../web/src/taskPush.ts) and the [service worker](../web/public/task-notifications-sw.js) render local or pushed task notices and route qualified targets back to the app. | [Task tests](../web/src/taskNotifications.test.ts), [push browser tests](../web/src/taskPush.browser.tsx) |
| Visual presentations | [PixelOfficeView](../web/src/world/PixelOfficeView.tsx), [ConnectedTreeView](../web/src/world/ConnectedTreeView.tsx), [SpatialGraphView](../web/src/world/SpatialGraphView.tsx), [graph layout](../web/src/world/graph/graphLayout.ts) and [arrangement model](../web/src/world/terminalWindowArrangement.ts) own their view-specific layouts. | [Office tests](../web/src/world/PixelOfficeCanvas.test.ts), [Tree tests](../web/src/world/ConnectedTreeView.test.ts), [Graph tests](../web/src/world/graph/graphLayout.test.ts), [arrangement tests](../web/src/world/terminalWindowArrangement.test.ts) |

`web/src/components/` contains reusable and feature-specific dialogs, menus and
panes. `web/src/world/` contains the World shell and visual projections. Root
`web/src/` modules hold the transport, focused state, terminal helpers and
preferences; [styles](../web/src/styles/) hold shared design tokens and base
styles. Follow imports from the owning row before editing a similarly named
component.

## Follow a request across the boundary

1. **Select a host.** The [connection selector](../web/src/components/ConnectionSwitcher.tsx)
   changes the focused [store](../web/src/store.ts). [api](../web/src/api.ts)
   creates a client bound to that connection and current generation. The service
   resolves it through [RPC routing](../server/src/connections/rpc-routing.ts)
   and [manager](../server/src/connections/manager.ts). A replaced runtime cannot
   publish its old result. [Runtime federation](../openspec/specs/runtime-federation/spec.md)
   defines the admission rule.
2. **Observe World.** The browser [runtime store](../web/src/world/runtimeStore.ts)
   calls bridge-global `world.snapshot`. The [snapshot service](../server/src/world/snapshot.ts)
   reads each managed runtime with bounded concurrency and a deadline. The
   [WorldObject](../web/src/world/worldObject.ts) preserves every qualified host;
   [WorldFoundationApp](../web/src/world/WorldFoundationApp.tsx) gives visual
   views only the selected host. Observation is read-only and stale hosts cannot
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
