## Why

Herdr World's browser-federated Herdr Web foundation makes every additional host a separately
installed and configured web bridge, while Roamgate already provides a cohesive Herdr client with
server-managed local and SSH connections, terminals, files, changes and session inspection. World
should adopt that stronger foundation and make its visual control plane a native part of one
installable application instead of rebuilding the same capabilities beside it. That replacement is
not complete if it removes the Pixel Office, live visual-view terminals or spatial Graph that define
the product; those views must be migrated deliberately over the stronger foundation.

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
  Spaces, Office, Tree and Graph as complete first-class native views with guarded,
  connection-qualified actions. The mature Pixel Office, live conversation windows and interactive
  Graph are product behavior, not optional polish, and SHALL be restored over the new foundation
  before this replacement is complete.
- Retain the useful Roamgate-derived selected-entity detail drawer and operational Inspector flows,
  extending them with authoritative agent status, task summary and ancestry instead of discarding
  them while the visual views are migrated.
- Adopt the connected host-space-agent branch presentation currently implemented as Graph as the
  canonical Tree direction. Restore the prior force-directed canvas as Graph; keep a bounded
  semantic hierarchy for accessibility and compact use rather than treating the list as the main
  desktop Tree experience.
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
- Re-establishes the World model and the complete defining Office, Tree and Graph experience over
  connection-scoped snapshots and one terminal owner. The current minimal Office cards,
  list-primary Tree and static branch Graph are an implementation checkpoint, not accepted parity.
- Records the exact Roamgate synchronization point and retains required MIT attribution and
  third-party notices.
