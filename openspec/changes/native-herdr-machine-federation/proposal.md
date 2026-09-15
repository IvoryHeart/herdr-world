## Why

Herdr World currently federates one independently exposed World bridge per Herdr runtime in the
browser, which makes every additional host require a bridge installation, reachable URL, browser
profile, reciprocal Origin/CSP policy, restart, and often separate authentication. Herdr v0.9.0 now
owns saved SSH machine profiles and native multi-machine connectivity, and World already pins and
vendors the private Herdr compatibility surface, so World can reuse that native model through one
local bridge instead of maintaining a second normal-path network topology.

## What Changes

- Make Herdr's saved machine catalogue the authoritative source for normal desktop multi-machine
  discovery, identity, labels, enabled state, SSH target, and selected remote session.
- Extend the pinned minimal Herdr compatibility crate with the smallest coherent Herdr remote
  discovery, SSH socket-forwarding, and terminal stdio transport slice required to connect to saved
  machines from the World bridge.
- Make one World bridge aggregate its local Herdr runtime and enabled saved SSH machines into the
  existing host-qualified browser model, with independent failure and reconnect boundaries.
- Keep browser traffic on the serving World origin for native machines. Remote hosts do not need a
  World installation, HTTP listener, password, Host admission, Origin admission, or CSP entry.
- Preserve direct bridge URL profiles as an explicit compatibility path for deployments that
  cannot use the local Herdr machine catalogue; keep remote browser access to the serving bridge as
  a separate concern.
- Preserve World-specific behavior through authoritative remote Herdr JSON API connections and
  dedicated terminal streams, including complete layouts and identity, bounded browser command
  exposure, launcher operations, concurrent terminal viewers, reconnect fencing, pins, activity,
  notes, and remote upload delivery.
- Replace the current normal-path browser profile workflow with machine state derived from Herdr;
  machine setup and interactive SSH approval continue through `herdr machine add` and Herdr's
  foreground recovery guidance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-federation`: Move normal desktop federation from multiple browser-selected World bridges
  to one World bridge that aggregates Herdr-owned local and saved-SSH machine endpoints while
  preserving qualified identity, compatibility admission, failure isolation, terminal ownership,
  and stale-state fencing.
- `bridge-access`: Require native saved machines to remain behind the serving bridge's same-origin
  browser boundary, while retaining explicit access policy for exposing the serving bridge and for
  compatibility-mode direct bridge URLs.

## Impact

The change affects the Rust bridge's runtime provider and connection supervision, the minimal
`vendor/herdr-compat` source set and provenance checks, browser runtime discovery and settings,
bridge startup behavior, terminal session ownership, bridge-owned runtime data, upload routing,
federation tests, security tests, operational documentation, and the current federation and
bridge-access specifications. It requires OpenSSH Unix-socket forwarding for native World access,
adds no Herdr runtime binary to World distributions, does not require a change to Herdr v0.9.0,
and does not install the World plugin or bridge on saved remote machines.
