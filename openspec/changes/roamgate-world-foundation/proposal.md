## Why

Herdr World's browser-federated Herdr Web foundation makes every additional host a separately
installed and configured web bridge, while Roamgate already provides a cohesive Herdr client with
server-managed local and SSH connections, terminals, files, changes and session inspection. World
should adopt that stronger foundation and make its visual control plane a native part of one
installable application instead of rebuilding the same capabilities beside it. The first complete
visual experience SHALL be a deep Pixel Office that brings Roamgate's terminal, Files, Changes and
Agent History context to the selected agent. Office is the first implementation milestone, but the
foundation replacement is complete only after Tree, Graph and qualified multi-host conversations
are migrated over the same seam.

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
- Project all managed Herdr connections into a shared, host-qualified World hierarchy and migrate
  Spaces, the mature Pixel Office, connected Tree and spatial Graph as complete first-class views
  with guarded, connection-qualified actions.
- Keep Office visible while one selected, generation-qualified agent or workspace uses the shell's
  existing terminal and Inspector ownership. Files, Changes and Agent History SHALL open as the
  focused Office context rather than navigating away to a separately implemented resource UI.
- Retain the useful Roamgate-derived operational surfaces and extend the Office context with
  authoritative agent status, a supported bounded task-summary workflow, ancestry and qualified
  agent/pane pinning.
- Preserve Roamgate's one-selected-connection model for Spaces and the focused Inspector, while a
  shell-owned conversation registry retains explicitly qualified terminal sessions from several
  ready hosts over the existing one WebSocket. The Office milestone SHALL prove the focused context
  first; retained cross-host conversations remain required before this replacement is complete and
  SHALL NOT add parallel transports or hidden application instances.
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
  Graph, focused Inspector and qualified multi-host conversations native surfaces of the
  Roamgate-derived shell and its managed connection runtimes.
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
  connection-scoped snapshots, one focused Inspector and one shell-owned terminal registry. The
  current minimal Office cards, list-primary Tree and static branch Graph are implementation
  checkpoints, not accepted parity, and the PR remains incomplete until qualified simultaneous
  local/SSH conversations and all three view migrations pass acceptance.
- Records the exact Roamgate synchronization point and retains required MIT attribution and
  third-party notices.
