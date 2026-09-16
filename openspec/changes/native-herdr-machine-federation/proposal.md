## Why

Herdr World currently federates one independently exposed World bridge per Herdr runtime in the
browser. Every additional host therefore needs another World installation, reachable URL, browser
profile, reciprocal Origin/CSP policy, restart path, and often separate authentication.

The native Herdr client demonstrates a simpler transport shape: an ordinary Herdr client can speak
the same socket protocols to Local or to a local socket backed by SSH and a remote Herdr server. A
live investigation on current Herdr master confirmed that saved-machine SSH authentication and
remote API requests work, but Herdr does not yet expose that relay as a public long-lived client
interface. That is not a server-side protocol limitation. The World bridge is already a pinned
Herdr client and can own a narrow SSH connector while keeping Herdr authoritative for topology,
commands, agents, and terminal semantics.

The active change therefore moves from waiting for a new Herdr-owned multihost API to defining a
Herdr-specific connector seam in the World bridge. The seam supports the existing local socket and
an SSH-backed socket without coupling World presentation code to either transport. It stays small
enough to contribute to or replace with an equivalent Herdr Web implementation later.

## What Changes

- Define one Herdr connector contract that yields compatible API and terminal connections from
  either the existing local socket or a supervised SSH-backed relay.
- Let the World bridge own remote Herdr profiles, connector lifecycle, SSH process supervision,
  reconnect generations, and bounded transport diagnostics.
- Keep OpenSSH authoritative for host aliases, keys, agents, host verification, proxy jumps, and
  other SSH policy. World stores no passwords or private keys and does not answer interactive SSH
  prompts.
- Require a compatible remote Herdr installation and session. Automatic remote installation,
  replacement, and upgrade are outside this change.
- Preserve Herdr as the authority for session topology, agents, commands, launchers, and terminal
  protocol behavior. The remote Herdr server receives the same compatible client protocols it
  receives from local clients.
- Prove snapshot/subscription ordering, concurrent commands and launchers, and independent
  terminal-ID streams through a real SSH connector before widening browser integration.
- Adapt Local and remote Herdr connections into the existing qualified `WorldModel` through one
  same-origin World gateway, with independent failure and reconnect boundaries.
- Keep direct World bridge profiles as a compatibility path and preserve healthy Local operation
  when remote profiles or SSH are unavailable.
- Keep the connector isolated in upstream-aligned bridge code. Track Herdr Web and adopt an
  equivalent upstream connector when it satisfies the same contract; upstream adoption is not a
  prerequisite for completing the downstream implementation.
- Leave provider support for non-Herdr servers outside this change. The connector boundary avoids
  making SSH or Herdr presentation assumptions part of the World model so a later, concrete server
  provider can be added separately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: Move the normal desktop path from multiple browser-selected World bridges
  to one World gateway with local-socket and SSH-backed Herdr connectors, while preserving unified
  model ingestion, qualified identity, complete topology, terminal isolation, World-owned data,
  and failure isolation.
- `bridge-access`: Keep remote Herdr traffic behind the serving gateway's same-origin browser
  boundary, add explicit authorization for managing remote profiles, and retain the existing
  policy for compatibility-mode direct bridge URLs.

## Impact

The change affects the Rust bridge connection layer, profile persistence and settings, plugin
service environment, browser runtime discovery, terminal ownership, uploads, federation tests,
security tests, operational documentation, and the current federation and bridge-access specs.
The first delivery remains Herdr-specific and pinned to a reviewed Herdr compatibility baseline.

Saved remote machines do not need a World installation or HTTP listener. They do need ordinary
OpenSSH access and a compatible Herdr executable/session reachable by the reviewed relay command.
The current direct bridge federation remains supported during migration and as an explicit
alternative.

This active change remains incomplete until the connector, thin World integration, security work,
and live end-to-end acceptance are implemented and evidenced. Specification validation alone does
not make the pull request ready to merge.
