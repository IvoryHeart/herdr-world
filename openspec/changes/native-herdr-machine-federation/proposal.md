## Why

Herdr World currently federates one independently exposed World bridge per Herdr runtime in the
browser. Every additional host therefore requires another bridge installation, reachable URL,
browser profile, reciprocal Origin/CSP policy, restart path, and often separate authentication.
Herdr already owns saved machine profiles and native multi-machine connectivity, so the clean
product boundary is one World gateway consuming a supported Herdr multihost interface.

The first implementation spike proved that recreating Herdr's remote path in World is the wrong
boundary. A World-owned OpenSSH forwarding supervisor duplicated Herdr policy, depended on private
bootstrap details, and did not prove the complete saved-machine path end to end. The product
requirements remain valid, but implementation now depends on a supported, machine-qualified Herdr
transport rather than World filling that gap.

## What Changes

- Make a supported Herdr machine-qualified multihost transport the prerequisite and authoritative
  connectivity boundary for native federation.
- Require that Herdr interface to expose bounded machine identity and state, authoritative session
  snapshots and subscriptions, structural commands and launchers, terminal-ID streams, connection
  generations, and a remote byte-delivery capability for World uploads.
- Keep saved-profile selection, SSH behavior, authentication and host-key handling, remote Herdr
  discovery and bootstrap, reconnection, and transport error classification inside Herdr.
- Require an end-to-end Herdr conformance proof for Local and a saved machine before World runtime
  integration starts.
- Make one World bridge adapt the proven Herdr interface into the existing machine-qualified model
  and same-origin browser gateway, with independent runtime failure and reconnect boundaries.
- Feed Local, native saved-machine, and direct compatibility sources through the same qualified
  `WorldModel` ingestion path rather than adding a native-machine presentation model.
- Preserve World ownership of runtime qualification, notes, pins, observed activity, upload policy,
  browser sessions, bounds, and allow-listed command exposure.
- Preserve direct World bridge profiles as an explicit compatibility path while native federation
  is unavailable or during migration.
- Remove the World-owned OpenSSH Unix-socket forwarder, remote shell staging, and copied private
  Herdr bootstrap helpers from the accepted design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: Move normal desktop federation from multiple browser-selected World bridges
  to one World gateway that consumes a supported Herdr multihost transport while preserving
  unified `WorldModel` ingestion, qualified identity, full topology, commands and launchers,
  terminal isolation, World-owned data, failure isolation, and stale-generation fencing.
- `bridge-access`: Keep native machine traffic behind the serving gateway's same-origin browser
  boundary while retaining explicit access policy for the gateway and compatibility-mode direct
  bridge URLs.

## Impact

The change first requires a supported Herdr multihost interface and a pinned release or commit that
passes the documented conformance fixture. World integration then affects the Rust bridge runtime
provider, browser runtime discovery and settings, bridge startup and supervision, terminal session
ownership, World-owned persisted data, uploads, federation tests, security tests, operational
documentation, and the current federation and bridge-access specifications.

World will not implement SSH, remote shell execution, Herdr executable discovery, or server
bootstrap for native federation. Saved remote machines will not need a World installation or HTTP
listener. Until the Herdr contract is available and proven, current direct bridge profiles remain
the supported multihost path.
