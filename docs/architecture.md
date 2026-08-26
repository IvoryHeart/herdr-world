# Federated client architecture

Herdr is the sole runtime authority. Herdr World does not maintain a competing topology, terminal
multiplexer, fleet database, or central gateway. The browser caches admitted snapshots for display,
routes each action back to the owning host, and treats a failed cache as stale and non-controllable.

## Runtime path

```text
browser
  ├─ host profile A ─HTTP/WebSocket─> bridge A ─local socket─> Herdr A
  ├─ host profile B ─HTTP/WebSocket─> bridge B ─local socket─> Herdr B
  └─ host profile N ─HTTP/WebSocket─> bridge N ─local socket─> Herdr N
```

Every bridge is host-local to exactly one selected Herdr runtime. Federation happens in the
browser. A bridge never discovers, proxies, routes to, or controls another bridge.

## Browser boundaries

- `AppShell` composes the host registry, core navigation, and static surface outlet.
- `SurfaceRegistry` describes statically bundled internal surfaces by stable ID, route, semantic
  icon, host scope, required capabilities, and lazy component loader. This is an internal seam, not
  a public or dynamic plugin SDK. The core `spaces` and downstream `world` surfaces ship in the
  same application.
- `HostRegistryProvider` owns the bridge-profile manager. Profiles have opaque stable IDs, labels,
  base URLs, enablement, and display order; credentials and SSH keys are not profile fields.
- `QualifiedTarget` identifies a Herdr workspace, tab, pane, terminal, or agent as the tuple of host
  profile ID, entity kind, and Herdr-native ID. Browser keys use collision-safe tuple encoding.
- `RuntimeCache` admits snapshots only for the matching host connection generation. It can mark a
  previously admitted snapshot stale, but never invents structural state or treats a mutation as
  authoritative.
- `TerminalSessionDescriptor` qualifies terminal sessions by profile, connection generation, and
  Herdr terminal ID. Read-only attach, input, resize, scroll, and upload-and-insert are admitted
  independently from that generation's advertised features.

## Compatibility and failure state

Before snapshot or control traffic, a host must advertise bridge API `1`, terminal protocol `20`,
Herdr `0.8.2` or newer, and the required web compatibility/feature surface. Unsupported or malformed
capabilities are `incompatible`; network failure is `offline`; a lost host with an admitted snapshot
may be displayed as stale/degraded. These states are local to that profile. There is no fallback to
another host for a qualified action.

Every structural dispatch is routed through its qualified host target and exact advertised command.
Unsupported command entry points remain disabled or absent, and execution rechecks admission so a
stale render cannot race a mutation.

The browser owns display and navigation preferences. Herdr owns workspaces, tabs, panes, layouts,
agent lifecycle, process state, and terminal byte streams. The bridge owns only transport concerns,
the documented bridge-local notes/pins/activity/selection features, request policy, and shared
fanout of one Herdr terminal attach to multiple admitted browser clients.

Optional extension data follows a separate contract boundary. The observability contract and
provider seam are downstream source boundaries, while the bridge mediates bounded descriptor,
snapshot, and event transport to the browser. The Office/World projection is an optional consumer;
core Herdr topology and terminal operation do not require an observability provider. The browser
never connects directly to a provider backend or receives its credentials.

## Security boundary

This increment is trusted-single-user software. An admitted browser has terminal-equivalent control.
Host, Origin, and CSP checks reduce DNS-rebinding, CSRF, and accidental cross-origin exposure; they
are not authentication or authorization. Loopback is the default. Operators own SSH, VPN, firewall,
TLS, and authenticated reverse-proxy policy outside this repository.
