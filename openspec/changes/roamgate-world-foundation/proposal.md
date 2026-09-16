## Why

Herdr World's browser-federated Herdr Web foundation makes every additional host a separately
installed and configured web bridge, while Roamgate already provides a cohesive Herdr client with
server-managed local and SSH connections, terminals, files, changes and session inspection. World
should adopt that stronger foundation and make its visual control plane a native part of one
installable application instead of rebuilding the same capabilities beside it.

## What Changes

- **BREAKING** Replace the Herdr Web/Rust bridge foundation with source derived from Roamgate main,
  distributed solely under Herdr World executable, service, package and plugin identities.
- Move connection ownership into the World service: users add, test, connect, disconnect, edit and
  remove local or SSH Herdr profiles from the UI while the browser talks only to the World origin.
- Remove browser-to-bridge federation and its World-specific Host, Origin and cross-origin CSP
  configuration. Adopt the Roamgate trusted-single-user access model: loopback by default and
  token/password protection for managed non-loopback service installs.
- Make Roamgate's workspace terminal, Inspector, Files, Changes, Agent History and connection
  surfaces native World capabilities rather than a separately installed Roamgate application.
- Project all managed Herdr connections into the shared, host-qualified World hierarchy and retain
  Spaces, Office, Tree and Graph as first-class views with guarded, connection-qualified actions.
- Preserve Herdr as an external runtime. World neither bundles Herdr nor introduces a generic
  provider/plugin SDK in this change.
- Start the new foundation with fresh World connection and presentation settings. Existing
  browser bridge URLs, Android preferences and Roamgate settings are not migrated.
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
- `world-surfaces`: Make the shared World projection and visual surfaces native views of the
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
- Ports the current World model, Office, Tree and Graph behavior onto Roamgate's connection-scoped
  snapshots and terminal ownership.
- Records the exact Roamgate synchronization point and retains required MIT attribution and
  third-party notices.
