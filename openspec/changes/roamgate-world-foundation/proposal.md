## Why

Herdr World's browser-federated Herdr Web foundation makes every additional host a separately
installed and configured web bridge, while Roamgate already provides a cohesive Herdr client with
server-managed local and SSH connections, terminals, files, changes and session inspection. World
should adopt that stronger foundation and make its visual control plane a native part of one
installable application instead of rebuilding the same capabilities beside it. The first complete
visual experience SHALL be a deep Pixel Office that brings Roamgate's terminal, Files, Changes and
Agent History context to the selected agent. Office is World's primary default surface; Roamgate's
current terminal workspace remains available as the first-class Spaces surface. Office is the first
implementation milestone, but the
foundation replacement is complete only after Tree, Graph and qualified selected-host
conversations are migrated over the same seam. The established Pixel Office implementation at
World commit `9c8f650853ad2d598d476dac1eecdeaea16716c6` is retained source, not a design reference
for a replacement scene. Completion means the replacement contract defined below; departures from
the former Herdr Web-based application are limited to the explicit runtime and product retirements
recorded by this change rather than unexplained presentation rewrites.

## What Changes

- **BREAKING** Replace the Herdr Web/Rust bridge foundation with source derived from Roamgate main,
  distributed solely under Herdr World executable, service, package and plugin identities.
- Move connection ownership into the World service: users add, test, connect, disconnect, edit and
  remove local or SSH Herdr profiles from the UI while the browser talks only to the World origin.
- Remove browser-to-bridge federation and its multi-host/multi-origin allow-list and cross-origin
  CSP configuration. Adopt the Roamgate trusted-single-user access model: loopback by default,
  automatic same-authority admission for privileged browser traffic, one optional exact public
  origin for an authenticated reverse proxy, and token/password protection for managed
  non-loopback service installs.
- Make Roamgate's workspace terminal, Inspector, Files, Changes, Agent History and connection
  surfaces native World capabilities rather than a separately installed Roamgate application.
  Present Pixel Office as the primary World surface while retaining that workspace as Spaces.
- Project all managed Herdr connections into a shared, host-qualified World hierarchy and migrate
  Spaces, the mature Pixel Office, connected Tree and spatial Graph as complete first-class views
  with all-host observation and guarded selected-host actions. Port the established Pixel Office
  projection contract, Pixi renderer, geometry, layout publication, semantic targets, assets and
  tests directly; adapt their data and action boundaries to Roamgate rather than recreating the
  scene in DOM/CSS.
- Keep Office at its full stage size while one selected, generation-qualified agent opens a
  connected intent overlay backed by the shell's existing Inspector ownership. Files, Changes,
  Agent History and a docked Terminal SHALL remain available in that overlay; a desk click SHALL
  open the same shell-owned terminal in the retained floating conversation presentation rather
  than navigating away or creating a separately implemented resource or terminal UI.
- Retain the useful Roamgate-derived operational surfaces and extend the Office context with a
  compact agent identity, authoritative qualified status and optional per-agent observations, a
  supported bounded task-summary workflow, ancestry and qualified agent/pane pinning.
- **BREAKING** Replace the former World's simultaneous cross-host terminal-conversation behavior
  with Roamgate's one-selected-connection model for every operational surface. The shared
  WorldObject SHALL continue to present all managed hosts, including ready-inactive and retained
  stale topology, while terminal, Files, Changes, Agent History, room and launcher actions remain
  disabled outside the explicitly selected host. Up to five conversations from that host SHALL use
  the existing one WebSocket and terminal owner; selecting an entity SHALL never switch hosts, and
  explicitly activating another host SHALL retire the outgoing terminal and Inspector contexts.
- Use Office as the first deep migration milestone, then promote the connected branch checkpoint to
  Tree and restore the prior spatial Graph. Checkpoint implementations SHALL NOT be represented as
  complete primary product views before their acceptance passes.
- Preserve Herdr as an external runtime. World neither bundles Herdr nor introduces a generic
  provider/plugin SDK in this change.
- Start the new foundation with fresh World connection and presentation settings. Existing
  browser bridge URLs, Android preferences and Roamgate settings are not migrated. The former
  free-form World notes store remains explicitly retired; review annotations do not masquerade as
  migrated notes.
- Use the Roamgate PWA/mobile web experience for this foundation change; native Capacitor Android
  packaging is deferred rather than maintaining two application foundations during cutover.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: Replace browser federation across one-runtime bridges with one World-owned
  connection manager containing isolated local and SSH Herdr runtimes.
- `bridge-access`: Replace cross-origin bridge admission with one same-origin World service and its
  trusted-single-user authentication boundary.
- `world-surfaces`: Make the shared World projection, deep Pixel Office, connected Tree, spatial
  Graph, focused Inspector and qualified selected-host conversations native surfaces of the
  Roamgate-derived shell while retaining aggregate observation of its managed connection runtimes.
- `distribution-boundaries`: Change upstream lineage, implementation stack, artifacts and plugin
  lifecycle from Herdr Web/Rust to the Roamgate-derived World application.

## Impact

- Replaces the current React/Rust/Capacitor source foundation with Roamgate's React/Bun Web/PWA
  application and compiled standalone server.
- Changes the runtime API, connection persistence, service management, release assets and
  development commands.
- Retires the current remote-bridge settings, browser federation, vendored `herdr-compat` crate and
  native Android build from the active product tree.
- Re-establishes the World model and the complete defining Office, Tree and Graph experience over
  connection-scoped snapshots, one selected operational host, one focused Inspector and one
  shell-owned terminal registry. The current minimal Office cards, list-primary Tree and static
  branch Graph are implementation checkpoints, not accepted complete views, and the PR remains
  incomplete until selected-host conversations and all three view migrations pass acceptance.
- Does not preserve obsolete shell chrome or behavior explicitly retired by this change.
  Simultaneous cross-host terminal and Inspector contexts are an approved breaking retirement;
  the established Pixel Office presentation, aggregate multi-host observation, selected-host
  multi-window conversations and the explicitly listed view behavior remain required.
- Records the exact Roamgate synchronization point and retains required MIT attribution and
  third-party notices.
