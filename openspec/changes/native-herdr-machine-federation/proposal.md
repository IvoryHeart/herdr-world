## Why

Herdr World currently federates one independently exposed World bridge per Herdr runtime in the
browser. Every additional host therefore needs another World installation, reachable URL, browser
profile, reciprocal Origin/CSP policy, restart path, and often separate authentication.

The native Herdr client demonstrates a simpler transport shape: an ordinary Herdr client can speak
the same socket protocols to Local or to a local socket backed by SSH and a remote Herdr server. A
live investigation on current Herdr master confirmed that saved-machine SSH authentication and
remote API requests work, but Herdr does not yet expose that relay as a public long-lived client
interface. That is not a server-side protocol limitation. The World bridge is already a pinned
Herdr client and can own a narrow SSH-backed connection mechanism while keeping Herdr authoritative
for topology, commands, agents, and terminal semantics.

The active change therefore moves from waiting for a new Herdr-owned multihost API to defining a
Herdr-specific adapter inside the World bridge. World owns the connection list and runtime
lifecycle; the adapter owns Herdr protocol and capability semantics; local-socket and SSH-backed
connection mechanisms carry the same pinned Herdr protocols. These are responsibility boundaries,
not a generic provider framework or a requirement for separate packages or services.

## What Changes

- Let the World bridge own a bounded connection list, browser access, routing, runtime identity,
  reconnect generations, bounded diagnostics, and World-specific data. Each connection identifies
  one particular Herdr runtime; an SSH-backed connection therefore names a pre-provisioned Herdr
  session rather than only a machine.
- Keep Herdr API requests, snapshot/event ordering, capabilities, native identifiers, command and
  launcher mapping, terminal semantics, compatibility checks, and the pinned relay command inside
  one Herdr-specific adapter boundary.
- Keep local-socket and supervised SSH process mechanics below that adapter. SSH process handling
  carries bounded bytes and lifecycle state without understanding Herdr agents, panes, layouts, or
  World presentation types.
- Require connection CRUD and target/session disclosure to use the existing actual-loopback
  local-management boundary.
- Keep OpenSSH authoritative for host aliases, keys, agents, host verification, proxy jumps, and
  other SSH policy. World stores no passwords or private keys and does not answer interactive SSH
  prompts.
- Require a compatible remote Herdr installation and session. Automatic remote installation,
  replacement, and upgrade are outside this change.
- Pin and probe the remote API relay capability separately from API and terminal protocol
  compatibility; protocol `22` alone does not establish that the relay command exists.
- Preserve Herdr as the authority for session topology, agents, commands, launchers, and terminal
  protocol behavior. The remote Herdr server receives the same compatible client protocols it
  receives from local clients.
- Prove snapshot/subscription ordering, concurrent commands and launchers, and independent
  terminal-ID streams through a real SSH-backed connection before widening browser integration.
- Adapt Local and remote Herdr connections through the Herdr adapter into the existing qualified
  `WorldModel` through one same-origin World gateway, with independent failure and reconnect
  boundaries.
- Give each target/session binding its own persistent runtime identity. Retargeting a connection
  keeps its configuration identity but retires the old runtime binding, detaches viewers, and does
  not silently associate old World data with the new server.
- Keep direct World bridge profiles as a compatibility path and preserve healthy Local operation
  when remote connections or SSH are unavailable.
- Keep the adapter and connection mechanics isolated in upstream-aligned bridge code. Track Herdr
  Web and adopt equivalent upstream work when it satisfies the same contract; upstream adoption is
  not a prerequisite for completing the downstream implementation.
- Keep the Herdr plugin responsible for installing, starting, and opening World without making it
  authoritative over World's connection list or routing remote connections through Local.
- Leave non-Herdr backends, a public provider SDK, and dynamic provider loading outside this
  change. If a second concrete backend arrives, evolve the shared representation from its proven
  differences instead of prebuilding a generic runtime platform.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: Move the normal desktop path from multiple browser-selected World bridges
  to one World gateway with a World-owned connection list, one Herdr adapter, and local-socket or
  SSH-backed connection mechanisms, while preserving unified model ingestion, qualified identity,
  complete topology, terminal isolation, World-owned data, and failure isolation.
- `bridge-access`: Keep remote Herdr traffic behind the serving gateway's same-origin browser
  boundary, add explicit authorization for managing Herdr connections, and retain the existing
  policy for compatibility-mode direct bridge URLs.

## Impact

The change affects the Rust bridge connection layer, connection persistence and settings, plugin
service environment, browser runtime discovery, terminal ownership, uploads, federation tests,
security tests, operational documentation, and the current federation and bridge-access specs.
The first delivery remains Herdr-specific and pinned to a reviewed Herdr compatibility baseline.

Saved remote machines do not need a World installation or HTTP listener. They do need ordinary
OpenSSH access and a compatible Herdr executable/session reachable by the reviewed relay command.
The current direct bridge federation remains supported during migration and as an explicit
alternative.

This active change remains incomplete until the Herdr connection, thin World integration, security
work, and live end-to-end acceptance are implemented and evidenced. Specification validation alone
does not make the pull request ready to merge.
